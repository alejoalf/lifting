-- El parte diario agrupa los gerenciamientos (trabajos individuales) del día.
--   1. Cada gerenciamiento se vincula al parte en curso de su vehículo.
--   2. El parte guarda el ATS (peligros y medidas de la matriz) al abrirse.
--   3. resumen_parte(): riesgo, ATS, trabajos, checklist y Strix para el detalle y el PDF.

-- 1. Vínculo parte ↔ gerenciamientos.
alter table public.gerenciamientos
  add column if not exists parte_id uuid references public.partes_diarios(id) on delete set null;

create index if not exists gerenciamientos_parte_idx on public.gerenciamientos (parte_id);
create index if not exists gerenciamientos_checklist_idx on public.gerenciamientos (checklist_id);

-- Parte en curso de un vehículo (para vincular y precargar cliente y contrato).
create or replace function public.parte_abierto_vehiculo(p_vehiculo_id uuid)
returns table (id uuid, nro_parte bigint, operador text, cliente_id uuid, contrato_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query
    select p.id, p.nro_parte, public.nombre_operador(p.operador_id), p.cliente_id, p.contrato_id
      from public.partes_diarios p
     where p.vehiculo_id = p_vehiculo_id and p.estado = 'En Curso'::public.estado_parte
     order by p.created_at desc
     limit 1;
end;
$$;

revoke all on function public.parte_abierto_vehiculo(uuid) from public, anon;
grant execute on function public.parte_abierto_vehiculo(uuid) to authenticated;

create or replace function public.gerenciamientos_antes_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_validacion record;
  v_check record;
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar gerenciamientos.' using errcode = '42501';
  end if;
  new.creado_por_nombre := public.nombre_operador(new.creado_por);
  new.created_at := now();
  new.autorizacion := 'pendiente';
  new.autorizado_por := null;
  new.responsable := null;
  new.autorizado_en := null;
  new.estado := 'abierto';
  new.cerrado_en := null;

  -- Condición de inicio: checklist vehicular apto en las últimas 24 h.
  if new.vehiculo_id is null then
    raise exception 'Elegí un vehículo de la flota: el gerenciamiento necesita su checklist vehicular.';
  end if;
  select c.id, c.apto into v_check
    from public.checklists c
   where c.vehiculo_id = new.vehiculo_id and c.created_at > now() - interval '24 hours'
   order by c.created_at desc
   limit 1;
  if not found then
    raise exception 'El vehículo no tiene checklist en las últimas 24 horas. Completá el checklist vehicular antes de iniciar el gerenciamiento.';
  end if;
  if not v_check.apto then
    raise exception 'El último checklist del vehículo (#%) lo marcó como NO APTO. Resolvé las fallas y hacé un checklist nuevo.', v_check.id;
  end if;
  new.checklist_id := v_check.id;

  -- Parte diario: el indicado (si es del mismo vehículo y está en curso) o el parte en curso del vehículo.
  if new.parte_id is not null and not exists (
    select 1 from public.partes_diarios p
     where p.id = new.parte_id and p.vehiculo_id = new.vehiculo_id and p.estado = 'En Curso'::public.estado_parte
  ) then
    raise exception 'El parte elegido no está en curso o es de otro vehículo.';
  end if;
  if new.parte_id is null then
    select p.id into new.parte_id
      from public.partes_diarios p
     where p.vehiculo_id = new.vehiculo_id and p.estado = 'En Curso'::public.estado_parte
     order by p.created_at desc
     limit 1;
  end if;

  select * into v_validacion
    from public.validar_facturacion_gerenciamiento(new.vehiculo_id, new.cliente_id, new.contrato_id);
  new.cliente_id := v_validacion.p_cliente_id;
  if v_validacion.p_dominio is not null then
    new.vehiculo := v_validacion.p_dominio;
  end if;

  -- Los datos de Strix solo los completa vincular_strix().
  new.strix_recorridos := null;
  new.strix_km := null;
  new.strix_horas_marcha := null;
  new.strix_horas_ralenti := null;
  new.strix_velocidad_maxima := null;
  new.strix_excesos := null;
  new.strix_inicio := null;
  new.strix_fin := null;
  new.strix_vinculado_en := null;
  return new;
end;
$$;

-- 2. Crear parte: además de la evaluación de viento guarda el ATS que arma la app con la matriz.
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
  v_ats text := left(nullif(btrim(p_riesgo ->> 'ats'), ''), 8000);
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
    riesgo_equipo_id, riesgo_estado, riesgo_motivos, viento_kmh, rafaga_kmh, clima_momento, nivel_riesgo, ats_texto
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
    end,
    v_ats
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

-- 3. Resumen del parte: riesgo, ATS, trabajos (gerenciamientos) con su checklist y Strix.
drop function if exists public.riesgo_parte(uuid);

create or replace function public.resumen_parte(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_parte public.partes_diarios%rowtype;
  v_resultado jsonb;
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_parte from public.partes_diarios p
   where p.id = p_id and (p.operador_id = public.operador_actual_id() or public.es_gestor_legajos());
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'riesgo', jsonb_build_object(
      'latitud', v_parte.latitud, 'longitud', v_parte.longitud, 'precision_m', v_parte.ubicacion_precision_m,
      'origen', v_parte.ubicacion_origen,
      'tramo', (select t.nombre from public.riesgo_tramos t where t.id = v_parte.riesgo_tramo_id),
      'equipo', (select e.nombre from public.riesgo_equipos e where e.id = v_parte.riesgo_equipo_id),
      'estado', v_parte.riesgo_estado, 'motivos', to_jsonb(v_parte.riesgo_motivos),
      'viento_kmh', v_parte.viento_kmh, 'rafaga_kmh', v_parte.rafaga_kmh,
      'nivel_riesgo', v_parte.nivel_riesgo, 'clima_momento', v_parte.clima_momento),
    'ats', v_parte.ats_texto,
    'gerenciamientos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'fecha_salida', g.fecha_salida, 'hora_salida', left(g.hora_salida::text, 5),
               'fecha_llegada', g.fecha_llegada, 'hora_llegada', left(g.hora_llegada::text, 5),
               'origen', g.origen, 'destino', g.destino, 'distancia_km', g.distancia_km, 'conductor', g.conductor,
               'autorizacion', g.autorizacion, 'estado', g.estado, 'responsable', g.responsable,
               'strix_recorridos', g.strix_recorridos, 'strix_km', g.strix_km,
               'strix_horas_marcha', g.strix_horas_marcha, 'strix_horas_ralenti', g.strix_horas_ralenti,
               'strix_velocidad_maxima', g.strix_velocidad_maxima, 'strix_excesos', g.strix_excesos,
               'checklist_id', g.checklist_id, 'checklist_apto', c.apto, 'checklist_en', c.created_at,
               'checklist_usuario', c.usuario)
             order by g.fecha_salida, g.hora_salida)
        from public.gerenciamientos g
        left join public.checklists c on c.id = g.checklist_id
       where g.parte_id = p_id), '[]'::jsonb),
    'strix', (
      select jsonb_build_object(
               'vinculados', count(*) filter (where g.strix_vinculado_en is not null),
               'km', sum(g.strix_km), 'horas_marcha', sum(g.strix_horas_marcha),
               'horas_ralenti', sum(g.strix_horas_ralenti), 'velocidad_maxima', max(g.strix_velocidad_maxima),
               'excesos', sum(g.strix_excesos))
        from public.gerenciamientos g where g.parte_id = p_id))
    into v_resultado;
  return v_resultado;
end;
$$;

revoke all on function public.resumen_parte(uuid) from public, anon;
grant execute on function public.resumen_parte(uuid) to authenticated;
