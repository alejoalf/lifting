-- Parte diario conectado con la matriz de riesgos:
--   1. Cada vehículo se vincula con su equipo de la matriz (hidrogrúa, barquilla...).
--   2. El parte guarda dónde se abrió (GPS del teléfono o un tramo de la matriz).
--   3. En izaje y trabajo en altura guarda la evaluación de viento del momento.
--      Si la matriz indica suspender, se avisa a supervisores y administradores.

-- 1. Vehículo ↔ equipo de la matriz (aparece en la ficha de Flota).
alter table public.vehiculos
  add column if not exists riesgo_equipo_id uuid references public.riesgo_equipos(id) on delete set null;

-- Vinculación inicial por el texto del equipo. Se corrige desde Flota si hace falta.
update public.vehiculos v
   set riesgo_equipo_id = (select e.id from public.riesgo_equipos e
                            where e.activo and e.tipo::text = 'izaje' order by e.orden, e.nombre limit 1)
 where v.riesgo_equipo_id is null and v.equipo ~* 'hidrogr';

update public.vehiculos v
   set riesgo_equipo_id = (select e.id from public.riesgo_equipos e
                            where e.activo and e.tipo::text = 'barquilla' order by e.orden, e.nombre limit 1)
 where v.riesgo_equipo_id is null and v.equipo ~* '(hidroelevador|barquilla|canasta)';

-- Equipo de la matriz vinculado a un vehículo (los choferes no leen la tabla vehiculos).
create or replace function public.equipo_riesgo_vehiculo(p_vehiculo_id uuid)
returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return (select v.riesgo_equipo_id from public.vehiculos v where v.id = p_vehiculo_id);
end;
$$;

revoke all on function public.equipo_riesgo_vehiculo(uuid) from public, anon;
grant execute on function public.equipo_riesgo_vehiculo(uuid) to authenticated;

-- 2. Ubicación y evaluación de riesgo del parte.
alter table public.partes_diarios
  add column if not exists latitud numeric(9,6),
  add column if not exists longitud numeric(9,6),
  add column if not exists ubicacion_precision_m numeric(8,1),
  add column if not exists ubicacion_origen text,
  add column if not exists riesgo_tramo_id uuid references public.riesgo_tramos(id) on delete set null,
  add column if not exists riesgo_equipo_id uuid references public.riesgo_equipos(id) on delete set null,
  add column if not exists riesgo_estado text,
  add column if not exists riesgo_motivos text[] not null default '{}',
  add column if not exists clima_momento timestamptz;

do $$ begin
  alter table public.partes_diarios add constraint partes_ubicacion_origen_valido
    check (ubicacion_origen is null or ubicacion_origen in ('gps', 'tramo'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.partes_diarios add constraint partes_riesgo_estado_valido
    check (riesgo_estado is null or riesgo_estado in ('habilitado', 'precaucion', 'suspendido', 'sin-datos'));
exception when duplicate_object then null;
end $$;

-- 3. Crear parte con ubicación y evaluación. Los parámetros nuevos tienen valor por defecto,
--    así que la llamada anterior (8 parámetros) sigue funcionando.
drop function if exists public.crear_parte_diario(uuid, uuid, uuid, public.tipo_tarea, text, text, numeric, text);

create or replace function public.crear_parte_diario(
  p_cliente_id uuid,
  p_contrato_id uuid,
  p_vehiculo_id uuid,
  p_tipo_tarea public.tipo_tarea,
  p_origen text,
  p_destino text,
  p_km_inicial numeric,
  p_observaciones text,
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_precision numeric default null,
  p_tramo_id uuid default null,
  p_riesgo jsonb default null
)
returns table (parte_id uuid, numero bigint)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol public.rol_operador;
  v_operador_id uuid;
  v_dominio text;
  v_equipo_id uuid;
  v_requiere_riesgo boolean := p_tipo_tarea in ('Izaje Hidrogrua'::public.tipo_tarea, 'Altura Barquilla'::public.tipo_tarea);
  v_lat numeric;
  v_lon numeric;
  v_origen text;
  v_estado text;
  v_motivos text[] := '{}';
  v_viento numeric;
  v_rafaga numeric;
  v_momento timestamptz;
begin
  v_rol := public.rol_actual();
  if auth.uid() is null
     or v_rol is null
     or v_rol not in ('Chofer'::public.rol_operador, 'Hidrogrulero'::public.rol_operador) then
    raise exception 'Solo un chofer o hidrogrulero puede crear un parte.'
      using errcode = '42501';
  end if;

  select op.id into v_operador_id
    from public.operadores op
   where op.auth_user_id = auth.uid() and op.activo;
  if v_operador_id is null then
    raise exception 'La cuenta no está vinculada a un operador activo.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.partes_diarios p
     where p.operador_id = v_operador_id
       and p.estado in ('Pendiente'::public.estado_parte, 'Excepcion'::public.estado_parte, 'En Curso'::public.estado_parte)
  ) then
    raise exception 'Ya tenés un parte abierto. Cerralo antes de crear otro.';
  end if;

  if not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
    raise exception 'El cliente seleccionado ya no está disponible.';
  end if;

  select v.dominio::text, v.riesgo_equipo_id into v_dominio, v_equipo_id
    from public.vehiculos v
   where v.id = p_vehiculo_id and v.estado = 'Disponible'::public.estado_vehiculo;
  if not found then
    raise exception 'El vehículo seleccionado no está disponible.';
  end if;

  if p_contrato_id is not null and not exists (
    select 1 from public.contratos co
     where co.id = p_contrato_id and co.cliente_id = p_cliente_id
       and co.vehiculo_id = p_vehiculo_id and co.vigente
  ) then
    raise exception 'El contrato no corresponde al cliente y vehículo seleccionados o no está vigente.';
  end if;

  if nullif(btrim(p_origen), '') is null
     or nullif(btrim(p_destino), '') is null
     or p_km_inicial is null
     or p_km_inicial < 0 then
    raise exception 'Completá origen, destino y un kilometraje inicial válido.';
  end if;

  -- Ubicación: un tramo de la matriz o el GPS del teléfono.
  if p_tramo_id is not null then
    select t.latitud, t.longitud into v_lat, v_lon from public.riesgo_tramos t where t.id = p_tramo_id;
    if not found then
      raise exception 'El tramo elegido no existe.';
    end if;
    v_origen := 'tramo';
  elsif p_latitud is not null and p_longitud is not null then
    if p_latitud not between -90 and 90 or p_longitud not between -180 and 180 then
      raise exception 'La ubicación recibida no es válida.';
    end if;
    v_lat := round(p_latitud, 6);
    v_lon := round(p_longitud, 6);
    v_origen := 'gps';
  end if;

  if v_requiere_riesgo and v_origen is null then
    raise exception 'Para izaje o trabajo en altura indicá la ubicación: activá el GPS o elegí el tramo.';
  end if;

  -- Evaluación de viento (la calcula la app con el clima del momento y los límites del equipo).
  if v_requiere_riesgo then
    if v_equipo_id is null then
      v_estado := 'sin-datos';
      v_motivos := array['El vehículo no tiene equipo vinculado en la matriz de riesgos'];
    elsif p_riesgo is null or coalesce(p_riesgo ->> 'estado', '') not in ('habilitado', 'precaucion', 'suspendido') then
      v_estado := 'sin-datos';
      v_motivos := array['No se pudo consultar el clima al abrir el parte'];
    else
      if (p_riesgo ->> 'equipo_id')::uuid is distinct from v_equipo_id then
        raise exception 'La evaluación de riesgo no corresponde al equipo del vehículo. Volvé a cargar la pantalla.';
      end if;
      v_estado := p_riesgo ->> 'estado';
      v_viento := least(greatest(round((p_riesgo ->> 'viento')::numeric, 1), 0), 9999);
      v_rafaga := least(greatest(round((p_riesgo ->> 'rafaga')::numeric, 1), 0), 9999);
      v_momento := to_timestamp((p_riesgo ->> 'momento')::numeric / 1000);
      select coalesce(array_agg(m), '{}') into v_motivos
        from jsonb_array_elements_text(case when jsonb_typeof(p_riesgo -> 'motivos') = 'array' then p_riesgo -> 'motivos' else '[]'::jsonb end) m;
    end if;
  end if;

  insert into public.partes_diarios (
    cliente_id, contrato_id, vehiculo_id, operador_id, tipo_tarea,
    origen, destino, km_inicial, observaciones, estado,
    latitud, longitud, ubicacion_precision_m, ubicacion_origen, riesgo_tramo_id,
    riesgo_equipo_id, riesgo_estado, riesgo_motivos, viento_kmh, rafaga_kmh, clima_momento, nivel_riesgo
  )
  values (
    p_cliente_id, p_contrato_id, p_vehiculo_id, v_operador_id, p_tipo_tarea,
    btrim(p_origen), btrim(p_destino), p_km_inicial,
    nullif(btrim(p_observaciones), ''), 'Pendiente'::public.estado_parte,
    v_lat, v_lon, case when v_origen = 'gps' then round(p_precision, 1) end, v_origen, p_tramo_id,
    case when v_requiere_riesgo then v_equipo_id end, v_estado, v_motivos, v_viento, v_rafaga, v_momento,
    case v_estado
      when 'habilitado' then 'Bajo'::public.nivel_riesgo
      when 'precaucion' then 'Medio'::public.nivel_riesgo
      when 'suspendido' then 'Suspender'::public.nivel_riesgo
    end
  )
  returning id, nro_parte into parte_id, numero;

  perform public.aplicar_control_parte(parte_id);

  if v_estado = 'suspendido' then
    perform public.notificar_gestores(
      format('Parte N° %s: condiciones para suspender', numero),
      format('%s abrió un parte de %s con %s y la matriz indica suspender: %s.',
             public.nombre_operador(v_operador_id), p_tipo_tarea::text, v_dominio, array_to_string(v_motivos, '; ')),
      format('/partes/%s', parte_id));
  end if;

  return next;
end;
$$;

revoke all on function public.crear_parte_diario(uuid, uuid, uuid, public.tipo_tarea, text, text, numeric, text, numeric, numeric, numeric, uuid, jsonb) from public, anon;
grant execute on function public.crear_parte_diario(uuid, uuid, uuid, public.tipo_tarea, text, text, numeric, text, numeric, numeric, numeric, uuid, jsonb) to authenticated;

-- Ubicación y evaluación de un parte (lo ve el operador del parte, supervisores y administradores).
create or replace function public.riesgo_parte(p_id uuid)
returns table (
  latitud numeric, longitud numeric, precision_m numeric, origen text, tramo text, equipo text,
  estado text, motivos text[], viento_kmh numeric, rafaga_kmh numeric, nivel_riesgo text, clima_momento timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query
    select p.latitud, p.longitud, p.ubicacion_precision_m, p.ubicacion_origen, t.nombre::text, e.nombre::text,
           p.riesgo_estado, p.riesgo_motivos, p.viento_kmh, p.rafaga_kmh, p.nivel_riesgo::text, p.clima_momento
      from public.partes_diarios p
      left join public.riesgo_tramos t on t.id = p.riesgo_tramo_id
      left join public.riesgo_equipos e on e.id = p.riesgo_equipo_id
     where p.id = p_id
       and (p.operador_id = public.operador_actual_id() or public.es_gestor_legajos());
end;
$$;

revoke all on function public.riesgo_parte(uuid) from public, anon;
grant execute on function public.riesgo_parte(uuid) to authenticated;
