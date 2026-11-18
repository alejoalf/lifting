-- Gerenciamientos de viaje, checklists vehiculares, tarjetas de observación y
-- notificaciones, que hasta ahora se guardaban solo en el navegador.
--
-- Quién ve qué:
--   * Cada operador ve lo que cargó. Supervisores y administradores ven todo.
--   * Autorizar un gerenciamiento y cerrar tarjetas: Supervisor o Admin.
--   * Cerrar un gerenciamiento autorizado: Supervisor, Admin o quien lo creó.
--   * Las notificaciones son personales y las genera la base (no la app).
-- Requiere la migración 20261113190000_legajos_habilitaciones.
begin;

-- Si alguna de estas tablas ya existe (por ejemplo, creada a mano), la migración
-- se detiene sin cambiar nada para no mezclar estructuras distintas.
do $$
declare
  v_existentes text;
begin
  select string_agg(t, ', ')
    into v_existentes
    from unnest(array['gerenciamientos', 'checklists', 'observaciones', 'notificaciones']) as t
   where to_regclass('public.' || t) is not null;
  if v_existentes is not null then
    raise exception 'Ya existen las tablas: %. Revisalas antes de aplicar esta migración.', v_existentes;
  end if;
end $$;

-- ---------- Funciones de apoyo ----------

-- Fecha de hoy en Argentina (la base corre en UTC).
create or replace function public.hoy_ar()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

create or replace function public.nombre_operador(p_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$ select op.nombre::text from public.operadores op where op.id = p_id $$;

-- ---------- Notificaciones ----------

create table public.notificaciones (
  id bigint generated always as identity primary key,
  para uuid not null references public.operadores(id) on delete cascade,
  titulo text not null,
  mensaje text not null,
  enlace text,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);

create index notificaciones_para_idx on public.notificaciones (para, created_at desc);

create or replace function public.notificar_operador(p_para uuid, p_titulo text, p_mensaje text, p_enlace text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.notificaciones (para, titulo, mensaje, enlace)
  select p_para, p_titulo, p_mensaje, p_enlace where p_para is not null;
$$;

-- A todos los supervisores y administradores activos, salvo a quien generó el aviso.
create or replace function public.notificar_gestores(p_titulo text, p_mensaje text, p_enlace text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.notificaciones (para, titulo, mensaje, enlace)
  select op.id, p_titulo, p_mensaje, p_enlace
    from public.operadores op
   where op.activo
     and op.rol in ('Supervisor'::public.rol_operador, 'Admin'::public.rol_operador)
     and op.id is distinct from public.operador_actual_id();
$$;

-- ---------- Gerenciamientos de viaje ----------

create table public.gerenciamientos (
  id bigint generated always as identity primary key,
  creado_por uuid not null references public.operadores(id),
  creado_por_nombre text not null,
  created_at timestamptz not null default now(),
  fecha_salida date not null,
  hora_salida time not null,
  fecha_llegada date not null,
  hora_llegada time not null,
  vehiculo text not null check (btrim(vehiculo) <> ''),
  conductor text not null check (btrim(conductor) <> ''),
  conductor2 text,
  origen text not null check (btrim(origen) <> ''),
  destino text not null check (btrim(destino) <> ''),
  distancia_km integer not null check (distancia_km > 0),
  telefono text not null,
  linea text not null,
  radioactivo boolean not null default false,
  pasajeros boolean not null default false,
  motivo text not null,
  rutas text not null,
  autorizacion text not null default 'pendiente' check (autorizacion in ('pendiente', 'autorizado')),
  autorizado_por uuid references public.operadores(id),
  responsable text,
  autorizado_en timestamptz,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  cerrado_en timestamptz,
  check (fecha_llegada + hora_llegada > fecha_salida + hora_salida)
);

create index gerenciamientos_creado_por_idx on public.gerenciamientos (creado_por);
create index gerenciamientos_salida_idx on public.gerenciamientos (fecha_salida desc);

create or replace function public.gerenciamientos_antes_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
  return new;
end;
$$;

create or replace function public.gerenciamientos_despues_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.notificar_gestores(
    format('Gerenciamiento #%s pendiente', new.id),
    format('%s cargó un viaje a %s el %s y espera autorización.',
           new.creado_por_nombre, new.destino, to_char(new.fecha_salida, 'DD/MM/YYYY')),
    '/gerenciamientos');
  return null;
end;
$$;

create trigger gerenciamientos_antes_de_crear
  before insert on public.gerenciamientos
  for each row execute function public.gerenciamientos_antes_de_crear();

create trigger gerenciamientos_despues_de_crear
  after insert on public.gerenciamientos
  for each row execute function public.gerenciamientos_despues_de_crear();

create or replace function public.autorizar_gerenciamiento(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_nombre text := public.nombre_operador(v_yo);
  v_creador uuid;
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede autorizar viajes.' using errcode = '42501';
  end if;
  update public.gerenciamientos g
     set autorizacion = 'autorizado', autorizado_por = v_yo, responsable = v_nombre, autorizado_en = now()
   where g.id = p_id and g.autorizacion = 'pendiente'
   returning g.creado_por into v_creador;
  if v_creador is null then
    raise exception 'El gerenciamiento no existe o ya estaba autorizado.';
  end if;
  if v_creador is distinct from v_yo then
    perform public.notificar_operador(v_creador,
      format('Gerenciamiento #%s aprobado', p_id),
      format('%s ha aprobado el gerenciamiento #%s.', v_nombre, p_id),
      '/gerenciamientos');
  end if;
end;
$$;

create or replace function public.cerrar_gerenciamiento(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id bigint;
begin
  update public.gerenciamientos g
     set estado = 'cerrado', cerrado_en = now()
   where g.id = p_id
     and g.estado = 'abierto'
     and g.autorizacion = 'autorizado'
     and (public.es_gestor_legajos() or g.creado_por = public.operador_actual_id())
   returning g.id into v_id;
  if v_id is null then
    raise exception 'No se puede cerrar: el viaje no existe, no está autorizado, ya está cerrado o no es tuyo.';
  end if;
end;
$$;

-- ---------- Checklists vehiculares ----------

create table public.checklists (
  id bigint generated always as identity primary key,
  creado_por uuid not null references public.operadores(id),
  usuario text not null,
  created_at timestamptz not null default now(),
  fecha date not null,
  vehiculo text not null check (btrim(vehiculo) <> ''),
  conductor text not null check (btrim(conductor) <> ''),
  km numeric check (km >= 0),
  -- [{ "item": "Luces", "estado": "bien" | "mal" | "na" }, ...]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  apto boolean not null,
  observaciones text,
  check (apto or btrim(coalesce(observaciones, '')) <> '')
);

create index checklists_creado_por_idx on public.checklists (creado_por);
create index checklists_fecha_idx on public.checklists (fecha desc);

create or replace function public.checklists_antes_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar checklists.' using errcode = '42501';
  end if;
  new.usuario := public.nombre_operador(new.creado_por);
  new.created_at := now();
  new.fecha := public.hoy_ar();
  -- El resultado sale de los ítems: con alguno en "mal" la unidad no está apta.
  new.apto := not exists (select 1 from jsonb_array_elements(new.items) e where e ->> 'estado' = 'mal');
  return new;
end;
$$;

create or replace function public.checklists_despues_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.apto then
    perform public.notificar_gestores(
      format('Checklist #%s con fallas', new.id),
      format('%s marcó fallas en el vehículo %s.', new.usuario, new.vehiculo),
      format('/checklist/%s', new.id));
  end if;
  return null;
end;
$$;

create trigger checklists_antes_de_crear
  before insert on public.checklists
  for each row execute function public.checklists_antes_de_crear();

create trigger checklists_despues_de_crear
  after insert on public.checklists
  for each row execute function public.checklists_despues_de_crear();

-- ---------- Tarjetas de observación ----------

create table public.observaciones (
  id bigint generated always as identity primary key,
  creado_por uuid not null references public.operadores(id),
  reportado_por text not null,
  created_at timestamptz not null default now(),
  tipos text[] not null check (
    cardinality(tipos) > 0
    and tipos <@ array['Acto Inseguro', 'Condición Insegura', 'Práctica Segura', 'Detención de Tareas']),
  observador text not null,
  sector_observador text not null,
  fecha_deteccion date not null,
  fecha_carga date not null,
  distrito text not null,
  sector text not null,
  cliente text,
  lugar text not null,
  descripcion text not null check (btrim(descripcion) <> ''),
  accion text,
  riesgo text not null check (riesgo in ('Bajo', 'Medio', 'Alto')),
  seguimiento boolean not null default false,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_por uuid references public.operadores(id),
  cerrada_en timestamptz
);

create index observaciones_creado_por_idx on public.observaciones (creado_por);
create index observaciones_carga_idx on public.observaciones (fecha_carga desc);

create or replace function public.observaciones_antes_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar tarjetas.' using errcode = '42501';
  end if;
  new.reportado_por := public.nombre_operador(new.creado_por);
  new.created_at := now();
  new.fecha_carga := public.hoy_ar();
  if new.fecha_deteccion > new.fecha_carga then
    raise exception 'La fecha de detección no puede ser futura.';
  end if;
  new.estado := 'abierta';
  new.cerrada_por := null;
  new.cerrada_en := null;
  return new;
end;
$$;

create or replace function public.observaciones_despues_de_crear()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.riesgo = 'Alto' or 'Detención de Tareas' = any (new.tipos) then
    perform public.notificar_gestores(
      format('Tarjeta #%s: %s', new.id, case when new.riesgo = 'Alto' then 'riesgo alto' else 'detención de tareas' end),
      format('%s reportó en %s: %s', new.reportado_por, new.lugar, left(new.descripcion, 120)),
      '/observaciones');
  end if;
  return null;
end;
$$;

create trigger observaciones_antes_de_crear
  before insert on public.observaciones
  for each row execute function public.observaciones_antes_de_crear();

create trigger observaciones_despues_de_crear
  after insert on public.observaciones
  for each row execute function public.observaciones_despues_de_crear();

create or replace function public.cerrar_observacion(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id bigint;
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede cerrar tarjetas.' using errcode = '42501';
  end if;
  update public.observaciones o
     set estado = 'cerrada', cerrada_por = public.operador_actual_id(), cerrada_en = now()
   where o.id = p_id and o.estado = 'abierta'
   returning o.id into v_id;
  if v_id is null then
    raise exception 'La tarjeta no existe o ya estaba cerrada.';
  end if;
end;
$$;

-- ---------- Permisos (RLS) ----------
-- Alta directa sobre la tabla (los triggers completan autor, fechas y estado);
-- los cambios de estado solo por las funciones de arriba.

do $$
declare
  t text;
begin
  foreach t in array array['gerenciamientos', 'checklists', 'observaciones']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (creado_por = public.operador_actual_id() or public.es_gestor_legajos())',
      t || '_ver', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.operador_actual_id() is not null)',
      t || '_crear', t);
  end loop;
end $$;

alter table public.notificaciones enable row level security;
revoke all on table public.notificaciones from anon, authenticated;
grant select on table public.notificaciones to authenticated;
grant update (leida) on table public.notificaciones to authenticated;
create policy notificaciones_propias on public.notificaciones
  for select to authenticated using (para = public.operador_actual_id());
create policy notificaciones_marcar_leidas on public.notificaciones
  for update to authenticated
  using (para = public.operador_actual_id()) with check (para = public.operador_actual_id());

revoke all on function public.nombre_operador(uuid) from public, anon, authenticated;
revoke all on function public.notificar_operador(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.notificar_gestores(text, text, text) from public, anon, authenticated;
revoke all on function public.gerenciamientos_antes_de_crear() from public, anon, authenticated;
revoke all on function public.gerenciamientos_despues_de_crear() from public, anon, authenticated;
revoke all on function public.checklists_antes_de_crear() from public, anon, authenticated;
revoke all on function public.checklists_despues_de_crear() from public, anon, authenticated;
revoke all on function public.observaciones_antes_de_crear() from public, anon, authenticated;
revoke all on function public.observaciones_despues_de_crear() from public, anon, authenticated;
revoke all on function public.autorizar_gerenciamiento(bigint) from public, anon;
revoke all on function public.cerrar_gerenciamiento(bigint) from public, anon;
revoke all on function public.cerrar_observacion(bigint) from public, anon;
grant execute on function public.autorizar_gerenciamiento(bigint) to authenticated;
grant execute on function public.cerrar_gerenciamiento(bigint) to authenticated;
grant execute on function public.cerrar_observacion(bigint) to authenticated;

commit;
