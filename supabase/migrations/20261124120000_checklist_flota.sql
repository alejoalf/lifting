-- Checklist vehicular por tipo de flota (pesada / liviana), datos precargados que se renuevan
-- cada 6 meses y checklist apto como condición para iniciar un gerenciamiento.

-- 1. Tipo de flota del vehículo (aparece solo en la ficha de Flota, ver columnas_vehiculos).
do $$ begin
  create type public.tipo_flota as enum ('Pesada', 'Liviana');
exception when duplicate_object then null;
end $$;

alter table public.vehiculos add column if not exists tipo_flota public.tipo_flota;

update public.vehiculos
   set tipo_flota = (case
     when marca_modelo ~* '(ranger|hilux|amarok|s10|frontier|saveiro|strada|toro)' then 'Liviana'
     when marca_modelo ~* 'daily' and equipo is null then 'Liviana'
     else 'Pesada' end)::public.tipo_flota
 where tipo_flota is null;

-- Vehículos disponibles para el checklist, con los datos que autocompletan la precarga.
create or replace function public.vehiculos_checklist()
returns table (id uuid, dominio text, marca_modelo text, equipo text, tipo_flota public.tipo_flota, venc_seguro date, venc_patente date)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query
    select v.id, v.dominio::text, v.marca_modelo::text, v.equipo::text, v.tipo_flota, v.venc_seguro, v.venc_patente
      from public.vehiculos v
     where v.estado = 'Disponible'::public.estado_vehiculo
     order by v.dominio;
end;
$$;

revoke all on function public.vehiculos_checklist() from public, anon;
grant execute on function public.vehiculos_checklist() to authenticated;

-- 2. Datos precargados. Se confirman al menos una vez cada 6 meses.
create table if not exists public.checklist_precarga_vehiculo (
  vehiculo_id uuid primary key references public.vehiculos(id) on delete cascade,
  datos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(id) on delete set null,
  actualizado_por_nombre text
);

create table if not exists public.checklist_precarga_conductor (
  operador_id uuid primary key references public.operadores(id) on delete cascade,
  datos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(id) on delete set null,
  actualizado_por_nombre text
);

alter table public.checklist_precarga_vehiculo enable row level security;
alter table public.checklist_precarga_conductor enable row level security;

drop policy if exists precarga_vehiculo_ver on public.checklist_precarga_vehiculo;
create policy precarga_vehiculo_ver on public.checklist_precarga_vehiculo
  for select to authenticated using (public.operador_actual_id() is not null);

drop policy if exists precarga_conductor_ver on public.checklist_precarga_conductor;
create policy precarga_conductor_ver on public.checklist_precarga_conductor
  for select to authenticated using (operador_id = public.operador_actual_id() or public.es_gestor_legajos());

grant select on public.checklist_precarga_vehiculo, public.checklist_precarga_conductor to authenticated;

create or replace function public.precarga_vigente(p_actualizado timestamptz)
returns boolean language sql stable
set search_path = pg_catalog, public
as $$ select p_actualizado is not null and p_actualizado + interval '6 months' > now() $$;

create or replace function public.guardar_precarga_vehiculo(p_vehiculo_id uuid, p_datos jsonb)
returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_op uuid := public.operador_actual_id();
  v_fecha timestamptz;
begin
  if v_op is null then
    raise exception 'Tu usuario no está habilitado para cargar checklists.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos precargados no tienen un formato válido.';
  end if;
  if not exists (select 1 from public.vehiculos where id = p_vehiculo_id) then
    raise exception 'El vehículo elegido no existe.';
  end if;

  insert into public.checklist_precarga_vehiculo as p (vehiculo_id, datos, actualizado_en, actualizado_por, actualizado_por_nombre)
  values (p_vehiculo_id, p_datos, now(), v_op, public.nombre_operador(v_op))
  on conflict (vehiculo_id) do update
    set datos = excluded.datos, actualizado_en = excluded.actualizado_en,
        actualizado_por = excluded.actualizado_por, actualizado_por_nombre = excluded.actualizado_por_nombre
  returning p.actualizado_en into v_fecha;
  return v_fecha;
end;
$$;

create or replace function public.guardar_precarga_conductor(p_datos jsonb, p_operador_id uuid default null)
returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_op uuid := public.operador_actual_id();
  v_destino uuid := coalesce(p_operador_id, v_op);
  v_fecha timestamptz;
begin
  if v_op is null then
    raise exception 'Tu usuario no está habilitado para cargar checklists.' using errcode = '42501';
  end if;
  if v_destino <> v_op and not public.es_gestor_legajos() then
    raise exception 'Solo podés actualizar tus propios datos de conductor.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos precargados no tienen un formato válido.';
  end if;

  insert into public.checklist_precarga_conductor as p (operador_id, datos, actualizado_en, actualizado_por, actualizado_por_nombre)
  values (v_destino, p_datos, now(), v_op, public.nombre_operador(v_op))
  on conflict (operador_id) do update
    set datos = excluded.datos, actualizado_en = excluded.actualizado_en,
        actualizado_por = excluded.actualizado_por, actualizado_por_nombre = excluded.actualizado_por_nombre
  returning p.actualizado_en into v_fecha;
  return v_fecha;
end;
$$;

revoke all on function public.guardar_precarga_vehiculo(uuid, jsonb) from public, anon;
revoke all on function public.guardar_precarga_conductor(jsonb, uuid) from public, anon;
grant execute on function public.guardar_precarga_vehiculo(uuid, jsonb) to authenticated;
grant execute on function public.guardar_precarga_conductor(jsonb, uuid) to authenticated;

-- 3. Checklists: vehículo de la flota, tipo de flota, encabezado/neumáticos/precarga y motivos de no aptitud.
alter table public.checklists
  add column if not exists vehiculo_id uuid references public.vehiculos(id) on delete set null,
  add column if not exists tipo_flota public.tipo_flota,
  add column if not exists datos jsonb not null default '{}'::jsonb,
  add column if not exists fallas text[] not null default '{}';

create index if not exists checklists_vehiculo_reciente on public.checklists (vehiculo_id, created_at desc);

create or replace function public.checklists_antes_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_hoy date := public.hoy_ar();
  v_veh record;
  v_pv record;
  v_pc record;
  v_fallas text[] := '{}';
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar checklists.' using errcode = '42501';
  end if;
  new.usuario := public.nombre_operador(new.creado_por);
  new.conductor := new.usuario; -- el checklist lo hace y lo firma el propio conductor
  new.created_at := now();
  new.fecha := v_hoy;
  if new.datos is null or jsonb_typeof(new.datos) <> 'object' then new.datos := '{}'::jsonb; end if;
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    raise exception 'El checklist no tiene controles.';
  end if;

  if new.vehiculo_id is null then
    raise exception 'Elegí un vehículo de la flota.';
  end if;
  select v.dominio::text as dominio, v.tipo_flota into v_veh from public.vehiculos v where v.id = new.vehiculo_id;
  if not found then
    raise exception 'El vehículo elegido no existe.';
  end if;
  if v_veh.tipo_flota is null then
    raise exception 'El vehículo % no tiene tipo de flota (pesada o liviana). Pedile al administrador que lo complete en Flota.', v_veh.dominio;
  end if;
  new.vehiculo := v_veh.dominio;
  new.tipo_flota := v_veh.tipo_flota;

  -- Datos precargados vigentes (se renuevan cada 6 meses).
  select * into v_pv from public.checklist_precarga_vehiculo where vehiculo_id = new.vehiculo_id;
  if not found or not public.precarga_vigente(v_pv.actualizado_en)
     or coalesce(v_pv.datos ->> 'tipoFlota', '') <> v_veh.tipo_flota::text then
    raise exception 'Los datos precargados del vehículo % no están vigentes (se renuevan cada 6 meses). Actualizalos antes de guardar.', v_veh.dominio;
  end if;
  select * into v_pc from public.checklist_precarga_conductor where operador_id = new.creado_por;
  if not found or not public.precarga_vigente(v_pc.actualizado_en) then
    raise exception 'Tus datos de conductor no están vigentes (se renuevan cada 6 meses). Actualizalos antes de guardar.';
  end if;
  new.datos := new.datos || jsonb_build_object(
    'precarga_vehiculo', v_pv.datos || jsonb_build_object('actualizado_en', v_pv.actualizado_en, 'actualizado_por', v_pv.actualizado_por_nombre),
    'precarga_conductor', v_pc.datos || jsonb_build_object('actualizado_en', v_pc.actualizado_en, 'actualizado_por', v_pc.actualizado_por_nombre));

  -- Documentación condicionante: vencida o sin vencimiento cargado.
  -- Vehículo: la precarga se guarda con la plantilla de su flota. Conductor: los condicionantes dependen de la flota
  -- del checklist (un mismo conductor puede manejar pesados y livianos).
  v_fallas := v_fallas || coalesce((
    select array_agg(format('Documentación: %s %s', x.d ->> 'nombre',
             case when nullif(x.d ->> 'vencimiento', '') is null then '(sin vencimiento)'
                  else format('(venció el %s)', to_char((x.d ->> 'vencimiento')::date, 'DD/MM/YYYY')) end))
      from (select v.d, coalesce((v.d ->> 'condicionante')::boolean, false) as condicionante
              from jsonb_array_elements(case when jsonb_typeof(v_pv.datos -> 'documentos') = 'array' then v_pv.datos -> 'documentos' else '[]'::jsonb end) v(d)
            union all
            select c.d, (c.d ->> 'id') = any (case v_veh.tipo_flota
                     when 'Pesada' then array['licencia', 'manejo_defensivo', 'cedula', 'cargas_peligrosas', 'psicofisico']
                     else array['licencia', 'manejo_defensivo', 'cedula'] end)
              from jsonb_array_elements(case when jsonb_typeof(v_pc.datos -> 'documentos') = 'array' then v_pc.datos -> 'documentos' else '[]'::jsonb end) c(d)) x
     where x.condicionante
       and not coalesce((x.d ->> 'na')::boolean, false)
       and (nullif(x.d ->> 'vencimiento', '') is null or (x.d ->> 'vencimiento')::date < v_hoy)), '{}');

  -- Controles: los condicionantes tienen que estar en Óptimo (o No aplica); cualquier "Mal" deja la unidad no apta.
  v_fallas := v_fallas || coalesce((
    select array_agg(e ->> 'item')
      from jsonb_array_elements(new.items) e
     where e ->> 'estado' = 'mal'
        or (coalesce((e ->> 'condicionante')::boolean, false) and coalesce(e ->> 'estado', '') not in ('optimo', 'bien', 'na'))), '{}');

  -- Neumáticos: presión informada, estado no malo y control de tuercas / soporte correcto.
  v_fallas := v_fallas || coalesce((
    select array_agg(format('Neumáticos %s: %s', n ->> 'eje', m.motivo))
      from jsonb_array_elements(case when jsonb_typeof(new.datos -> 'neumaticos') = 'array' then new.datos -> 'neumaticos' else '[]'::jsonb end) n
      cross join lateral (values
        (case when nullif(n ->> 'presion', '') is null then 'sin presión informada' end),
        (case when n ->> 'estado' = 'malo' then 'estado malo' end),
        (case when n ->> 'tuercas' = 'no' then 'ajuste de tuercas' end),
        (case when n ->> 'checkpoint' = 'no' then 'check point' end),
        (case when n ->> 'soporte' = 'no' then 'soporte' end)) m(motivo)
     where m.motivo is not null), '{}');

  new.fallas := v_fallas;
  new.apto := cardinality(v_fallas) = 0;
  return new;
end;
$$;

create or replace function public.checklists_despues_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.apto then
    perform public.notificar_gestores(
      format('Checklist #%s: unidad no apta', new.id),
      format('%s marcó la unidad %s como no apta (%s).', new.usuario, new.vehiculo,
             array_to_string(new.fallas[1:3], '; ') || case when cardinality(new.fallas) > 3 then format(' y %s más', cardinality(new.fallas) - 3) else '' end),
      format('/checklist/%s', new.id));
  end if;
  return null;
end;
$$;

-- Último checklist de un vehículo en las últimas 24 h (lo usa la pantalla de gerenciamiento).
create or replace function public.estado_checklist_vehiculo(p_vehiculo_id uuid)
returns table (id bigint, creado_en timestamptz, apto boolean, usuario text, fallas text[])
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query
    select c.id, c.created_at, c.apto, c.usuario, c.fallas
      from public.checklists c
     where c.vehiculo_id = p_vehiculo_id and c.created_at > now() - interval '24 hours'
     order by c.created_at desc
     limit 1;
end;
$$;

revoke all on function public.estado_checklist_vehiculo(uuid) from public, anon;
grant execute on function public.estado_checklist_vehiculo(uuid) to authenticated;

-- 4. Gerenciamiento: exige un checklist apto del vehículo en las últimas 24 h.
alter table public.gerenciamientos
  add column if not exists checklist_id bigint references public.checklists(id) on delete set null;

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

  select * into v_validacion
    from public.validar_facturacion_gerenciamiento(new.vehiculo_id, new.cliente_id, new.contrato_id);
  new.cliente_id := v_validacion.p_cliente_id;
  -- El texto del vehículo queda igual al dominio de la flota.
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
