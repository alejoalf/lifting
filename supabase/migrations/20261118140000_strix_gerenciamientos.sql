-- Strix: recorridos de telemetría vinculados a los gerenciamientos de viaje,
-- para liquidar los trabajos (km, horas o días) en las certificaciones mensuales.
--
--   1. Cada gerenciamiento queda asociado a un vehículo de la flota y,
--      si corresponde, a un cliente y un contrato.
--   2. Los recorridos de Strix entran en strix_recorridos (hoy, importando el
--      reporte; más adelante por mail o API: columna "fuente").
--   3. vincular_strix() suma, para cada gerenciamiento, los recorridos de su
--      vehículo dentro del horario del viaje y guarda km, horas y excesos.
-- Requiere la migración 20261118130000_gerenciamientos_checklists_observaciones.
begin;

-- ---------- Gerenciamientos: vehículo, cliente, contrato y datos Strix ----------

alter table public.gerenciamientos
  add column if not exists vehiculo_id uuid references public.vehiculos(id) on delete set null,
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null,
  add column if not exists contrato_id uuid references public.contratos(id) on delete set null,
  add column if not exists strix_recorridos integer,
  add column if not exists strix_km numeric(10, 1),
  add column if not exists strix_horas_marcha numeric(8, 2),
  add column if not exists strix_horas_ralenti numeric(8, 2),
  add column if not exists strix_velocidad_maxima numeric(6, 1),
  add column if not exists strix_excesos integer,
  add column if not exists strix_inicio timestamptz,
  add column if not exists strix_fin timestamptz,
  add column if not exists strix_vinculado_en timestamptz;

create index if not exists gerenciamientos_vehiculo_idx on public.gerenciamientos (vehiculo_id, fecha_salida);
create index if not exists gerenciamientos_contrato_idx on public.gerenciamientos (contrato_id, fecha_salida);

-- Inicio y fin del viaje según el gerenciamiento (horario de Argentina).
create or replace function public.gerenciamiento_salida(g public.gerenciamientos)
returns timestamptz
language sql
stable
as $$ select (g.fecha_salida + g.hora_salida) at time zone 'America/Argentina/Buenos_Aires' $$;

create or replace function public.gerenciamiento_llegada(g public.gerenciamientos)
returns timestamptz
language sql
stable
as $$ select (g.fecha_llegada + g.hora_llegada) at time zone 'America/Argentina/Buenos_Aires' $$;

-- Valida vehículo, cliente y contrato. El contrato tiene que ser del cliente y
-- del vehículo elegidos; si viene el contrato sin cliente, el cliente sale de él.
create or replace function public.validar_facturacion_gerenciamiento(
  p_vehiculo_id uuid, inout p_cliente_id uuid, p_contrato_id uuid, out p_dominio text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contrato record;
begin
  if p_vehiculo_id is not null then
    select v.dominio::text into p_dominio from public.vehiculos v where v.id = p_vehiculo_id;
    if p_dominio is null then
      raise exception 'El vehículo elegido no existe.';
    end if;
  end if;
  if p_contrato_id is not null then
    select co.cliente_id, co.vehiculo_id into v_contrato from public.contratos co where co.id = p_contrato_id;
    if not found then
      raise exception 'El contrato elegido no existe.';
    end if;
    p_cliente_id := coalesce(p_cliente_id, v_contrato.cliente_id);
    if v_contrato.cliente_id is distinct from p_cliente_id
       or (p_vehiculo_id is not null and v_contrato.vehiculo_id is not null
           and v_contrato.vehiculo_id <> p_vehiculo_id) then
      raise exception 'El contrato no corresponde al cliente y vehículo elegidos.';
    end if;
  end if;
end;
$$;

create or replace function public.gerenciamientos_antes_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_validacion record;
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

-- Supervisor o Admin: corregir vehículo, cliente y contrato (por ejemplo, en
-- gerenciamientos cargados antes de esta migración o con el contrato equivocado).
create or replace function public.asignar_facturacion_gerenciamiento(
  p_id bigint, p_vehiculo_id uuid, p_cliente_id uuid, p_contrato_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_validacion record;
  v_id bigint;
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede modificar estos datos.' using errcode = '42501';
  end if;
  select * into v_validacion
    from public.validar_facturacion_gerenciamiento(p_vehiculo_id, p_cliente_id, p_contrato_id);
  update public.gerenciamientos g
     set vehiculo_id = p_vehiculo_id,
         cliente_id = v_validacion.p_cliente_id,
         contrato_id = p_contrato_id,
         vehiculo = coalesce(v_validacion.p_dominio, g.vehiculo)
   where g.id = p_id
   returning g.id into v_id;
  if v_id is null then
    raise exception 'El gerenciamiento no existe.';
  end if;
  -- Si cambió el vehículo, los datos de Strix se recalculan.
  perform public.vincular_strix_gerenciamiento(p_id);
end;
$$;

-- ---------- Recorridos de Strix ----------

create table if not exists public.strix_importaciones (
  id bigint generated always as identity primary key,
  archivo text not null,
  filas integer not null default 0,
  nuevas integer not null default 0,
  sin_vehiculo integer not null default 0,
  creado_por uuid references public.operadores(id) default public.operador_actual_id(),
  created_at timestamptz not null default now()
);

create table if not exists public.strix_recorridos (
  id bigint generated always as identity primary key,
  importacion_id bigint references public.strix_importaciones(id) on delete cascade,
  fuente text not null default 'archivo' check (fuente in ('archivo', 'email', 'api')),
  -- Dominio tal como lo informa Strix, normalizado (mayúsculas, sin espacios ni guiones).
  dominio text not null check (dominio <> ''),
  vehiculo_id uuid references public.vehiculos(id) on delete set null,
  inicio timestamptz not null,
  fin timestamptz not null check (fin >= inicio),
  km numeric(10, 1) check (km >= 0),
  minutos_marcha numeric(10, 1) check (minutos_marcha >= 0),
  minutos_ralenti numeric(10, 1) check (minutos_ralenti >= 0),
  velocidad_maxima numeric(6, 1) check (velocidad_maxima >= 0),
  excesos integer check (excesos >= 0),
  origen text,
  destino text,
  conductor text,
  -- Fila original del reporte, para auditar.
  datos jsonb,
  created_at timestamptz not null default now(),
  unique (dominio, inicio, fin)
);

create index if not exists strix_recorridos_vehiculo_idx on public.strix_recorridos (vehiculo_id, inicio);

create or replace function public.normalizar_dominio(p_dominio text)
returns text
language sql
stable
as $$ select upper(regexp_replace(coalesce(p_dominio, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function public.strix_recorridos_antes_de_guardar()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.dominio := public.normalizar_dominio(new.dominio);
  select v.id into new.vehiculo_id
    from public.vehiculos v
   where public.normalizar_dominio(v.dominio::text) = new.dominio
   limit 1;
  return new;
end;
$$;

drop trigger if exists strix_recorridos_antes_de_guardar on public.strix_recorridos;
create trigger strix_recorridos_antes_de_guardar
  before insert or update of dominio on public.strix_recorridos
  for each row execute function public.strix_recorridos_antes_de_guardar();

-- Margen alrededor del horario del gerenciamiento para tomar los recorridos:
-- el viaje real puede empezar antes o terminar después de lo planificado.
create or replace function public.strix_margen()
returns interval
language sql
stable
as $$ select interval '2 hours' $$;

-- Suma los recorridos del vehículo dentro del horario del gerenciamiento.
create or replace function public.vincular_strix_gerenciamiento(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.gerenciamientos g
     set strix_recorridos = r.cantidad,
         strix_km = r.km,
         strix_horas_marcha = r.minutos_marcha / 60,
         strix_horas_ralenti = r.minutos_ralenti / 60,
         strix_velocidad_maxima = r.velocidad_maxima,
         strix_excesos = r.excesos,
         strix_inicio = r.inicio,
         strix_fin = r.fin,
         strix_vinculado_en = now()
    from (
      select gg.id,
             count(sr.id)::integer as cantidad,
             sum(sr.km) as km,
             sum(sr.minutos_marcha) as minutos_marcha,
             sum(sr.minutos_ralenti) as minutos_ralenti,
             max(sr.velocidad_maxima) as velocidad_maxima,
             sum(sr.excesos)::integer as excesos,
             min(sr.inicio) as inicio,
             max(sr.fin) as fin
        from public.gerenciamientos gg
        left join public.strix_recorridos sr
          on sr.vehiculo_id = gg.vehiculo_id
         and sr.inicio < public.gerenciamiento_llegada(gg) + public.strix_margen()
         and sr.fin > public.gerenciamiento_salida(gg) - public.strix_margen()
       where gg.id = p_id
       group by gg.id
    ) r
   where g.id = r.id;
end;
$$;

-- Vincula todos los gerenciamientos (con vehículo de la flota) que salieron entre
-- dos fechas. Devuelve cuántos quedaron con al menos un recorrido de Strix.
create or replace function public.vincular_strix(p_desde date default null, p_hasta date default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id bigint;
  v_con_datos integer;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede vincular los datos de Strix.' using errcode = '42501';
  end if;
  for v_id in
    select g.id from public.gerenciamientos g
     where g.vehiculo_id is not null
       and (p_desde is null or g.fecha_llegada >= p_desde)
       and (p_hasta is null or g.fecha_salida <= p_hasta)
  loop
    perform public.vincular_strix_gerenciamiento(v_id);
  end loop;
  select count(*) into v_con_datos
    from public.gerenciamientos g
   where g.strix_recorridos > 0
     and (p_desde is null or g.fecha_llegada >= p_desde)
     and (p_hasta is null or g.fecha_salida <= p_hasta);
  return v_con_datos;
end;
$$;

-- Importa las filas de un reporte de Strix (ya leídas y convertidas por la app).
-- Los recorridos repetidos (mismo dominio, inicio y fin) se ignoran, así se puede
-- volver a importar un reporte que se superpone con otro.
create or replace function public.importar_strix(p_archivo text, p_filas jsonb)
returns table (importacion_id bigint, filas integer, nuevas integer, sin_vehiculo integer, vinculados integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_importacion bigint;
  v_filas integer;
  v_nuevas integer;
  v_sin_vehiculo integer;
  v_desde date;
  v_hasta date;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede importar datos de Strix.' using errcode = '42501';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El reporte no tiene filas para importar.';
  end if;
  v_filas := jsonb_array_length(p_filas);

  insert into public.strix_importaciones (archivo, filas) values (p_archivo, v_filas)
  returning id into v_importacion;

  insert into public.strix_recorridos (
    importacion_id, dominio, inicio, fin, km, minutos_marcha, minutos_ralenti,
    velocidad_maxima, excesos, origen, destino, conductor, datos)
  select v_importacion, r.dominio, r.inicio, r.fin, r.km, r.minutos_marcha, r.minutos_ralenti,
         r.velocidad_maxima, r.excesos, nullif(btrim(r.origen), ''), nullif(btrim(r.destino), ''),
         nullif(btrim(r.conductor), ''), r.datos
    from jsonb_to_recordset(p_filas) as r(
      dominio text, inicio timestamptz, fin timestamptz, km numeric, minutos_marcha numeric,
      minutos_ralenti numeric, velocidad_maxima numeric, excesos integer,
      origen text, destino text, conductor text, datos jsonb)
  on conflict (dominio, inicio, fin) do nothing;
  get diagnostics v_nuevas = row_count;

  select count(*) filter (where sr.vehiculo_id is null),
         min((sr.inicio at time zone 'America/Argentina/Buenos_Aires')::date),
         max((sr.fin at time zone 'America/Argentina/Buenos_Aires')::date)
    into v_sin_vehiculo, v_desde, v_hasta
    from public.strix_recorridos sr
   where sr.importacion_id = v_importacion;

  update public.strix_importaciones i
     set nuevas = v_nuevas, sin_vehiculo = v_sin_vehiculo
   where i.id = v_importacion;

  return query select v_importacion, v_filas, v_nuevas, v_sin_vehiculo,
    case when v_desde is null then 0 else public.vincular_strix(v_desde, v_hasta) end;
end;
$$;

-- Después de cargar un vehículo con un dominio que Strix ya informaba, sus
-- recorridos quedan vinculados al volver a guardar el dominio.
create or replace function public.revincular_recorridos_sin_vehiculo()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_cantidad integer;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede hacer esto.' using errcode = '42501';
  end if;
  update public.strix_recorridos sr set dominio = sr.dominio where sr.vehiculo_id is null;
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- ---------- Permisos (RLS): solo Admin ----------

do $$
declare
  t text;
begin
  foreach t in array array['strix_importaciones', 'strix_recorridos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.es_admin_legajos()) with check (public.es_admin_legajos())',
      t || '_admin', t);
  end loop;
end $$;

revoke all on function public.validar_facturacion_gerenciamiento(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.vincular_strix_gerenciamiento(bigint) from public, anon, authenticated;
revoke all on function public.strix_recorridos_antes_de_guardar() from public, anon, authenticated;
revoke all on function public.asignar_facturacion_gerenciamiento(bigint, uuid, uuid, uuid) from public, anon;
revoke all on function public.vincular_strix(date, date) from public, anon;
revoke all on function public.importar_strix(text, jsonb) from public, anon;
revoke all on function public.revincular_recorridos_sin_vehiculo() from public, anon;
grant execute on function public.asignar_facturacion_gerenciamiento(bigint, uuid, uuid, uuid) to authenticated;
grant execute on function public.vincular_strix(date, date) to authenticated;
grant execute on function public.importar_strix(text, jsonb) to authenticated;
grant execute on function public.revincular_recorridos_sin_vehiculo() to authenticated;

commit;
