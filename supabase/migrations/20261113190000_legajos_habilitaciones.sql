-- Legajos del personal: documentos por operador, actividades y los documentos
-- que cada actividad exige. Un operador queda habilitado para una actividad
-- cuando tiene aprobados y vigentes todos los documentos que la actividad pide.
begin;

-- ---------- Funciones de apoyo ----------

create or replace function public.operador_actual_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select op.id
    from public.operadores op
    where op.auth_user_id = auth.uid() and op.activo
    limit 1;
$$;

create or replace function public.es_gestor_legajos()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(
    public.rol_actual() in ('Supervisor'::public.rol_operador, 'Admin'::public.rol_operador),
    false);
$$;

create or replace function public.es_admin_legajos()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(public.rol_actual() = 'Admin'::public.rol_operador, false);
$$;

-- ---------- Tablas ----------

create table if not exists public.tipos_documento (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (btrim(nombre) <> ''),
  requiere_vencimiento boolean not null default true,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.actividades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) <> ''),
  descripcion text,
  -- Empresa para la que rige la actividad. NULL = vale para cualquier cliente.
  cliente_id uuid references public.clientes(id),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists actividades_nombre_cliente_uidx
  on public.actividades (lower(nombre), coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.actividad_requisitos (
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  tipo_documento_id uuid not null references public.tipos_documento(id),
  primary key (actividad_id, tipo_documento_id)
);

create table if not exists public.documentos_legajo (
  id uuid primary key default gen_random_uuid(),
  operador_id uuid not null references public.operadores(id),
  tipo_documento_id uuid not null references public.tipos_documento(id),
  fecha_emision date,
  vencimiento date,
  archivo_path text not null unique,
  archivo_nombre text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo_rechazo text,
  cargado_por uuid not null references public.operadores(id),
  revisado_por uuid references public.operadores(id),
  revisado_en timestamptz,
  -- Lo que leyó la IA del archivo, para que quien revisa pueda compararlo.
  lectura_ia jsonb,
  created_at timestamptz not null default now()
);

create index if not exists documentos_legajo_operador_idx
  on public.documentos_legajo (operador_id, tipo_documento_id);

-- Quien carga no elige el estado: lo que sube Supervisor/Admin queda aprobado,
-- lo que sube el propio operador queda pendiente de revisión.
create or replace function public.documentos_legajo_antes_de_insertar()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  new.cargado_por := public.operador_actual_id();
  if new.cargado_por is null then
    raise exception 'Se requiere una cuenta de operador activa.' using errcode = '42501';
  end if;

  if new.archivo_path not like new.operador_id::text || '/%' then
    raise exception 'El archivo no corresponde al legajo de este operador.';
  end if;

  if new.vencimiento is null and exists (
    select 1 from public.tipos_documento t
    where t.id = new.tipo_documento_id and t.requiere_vencimiento
  ) then
    raise exception 'Este tipo de documento requiere fecha de vencimiento.';
  end if;

  new.created_at := now();
  new.motivo_rechazo := null;
  if public.es_gestor_legajos() then
    new.estado := 'aprobado';
    new.revisado_por := new.cargado_por;
    new.revisado_en := now();
  else
    new.estado := 'pendiente';
    new.revisado_por := null;
    new.revisado_en := null;
  end if;
  return new;
end;
$$;

drop trigger if exists documentos_legajo_antes_de_insertar on public.documentos_legajo;
create trigger documentos_legajo_antes_de_insertar
  before insert on public.documentos_legajo
  for each row execute function public.documentos_legajo_antes_de_insertar();

-- ---------- Permisos (RLS) ----------

alter table public.tipos_documento enable row level security;
alter table public.actividades enable row level security;
alter table public.actividad_requisitos enable row level security;
alter table public.documentos_legajo enable row level security;

revoke all on table public.tipos_documento, public.actividades,
  public.actividad_requisitos, public.documentos_legajo from anon, authenticated;
grant select, insert, update on table public.tipos_documento to authenticated;
grant select on table public.actividades, public.actividad_requisitos to authenticated;
grant select, insert on table public.documentos_legajo to authenticated;

drop policy if exists tipos_documento_leer on public.tipos_documento;
create policy tipos_documento_leer on public.tipos_documento
  for select to authenticated using (true);

drop policy if exists tipos_documento_crear on public.tipos_documento;
create policy tipos_documento_crear on public.tipos_documento
  for insert to authenticated with check (public.es_admin_legajos());

drop policy if exists tipos_documento_editar on public.tipos_documento;
create policy tipos_documento_editar on public.tipos_documento
  for update to authenticated
  using (public.es_admin_legajos()) with check (public.es_admin_legajos());

drop policy if exists actividades_leer on public.actividades;
create policy actividades_leer on public.actividades
  for select to authenticated using (true);

drop policy if exists actividad_requisitos_leer on public.actividad_requisitos;
create policy actividad_requisitos_leer on public.actividad_requisitos
  for select to authenticated using (true);

drop policy if exists documentos_legajo_leer on public.documentos_legajo;
create policy documentos_legajo_leer on public.documentos_legajo
  for select to authenticated
  using (operador_id = public.operador_actual_id() or public.es_gestor_legajos());

drop policy if exists documentos_legajo_cargar on public.documentos_legajo;
create policy documentos_legajo_cargar on public.documentos_legajo
  for insert to authenticated
  with check (operador_id = public.operador_actual_id() or public.es_gestor_legajos());

-- ---------- Funciones para la app ----------

create or replace function public.listar_actividades_legajo()
returns table (
  id uuid,
  nombre text,
  descripcion text,
  cliente_id uuid,
  cliente text,
  activa boolean,
  requisitos uuid[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or public.rol_actual() is null then
    raise exception 'Se requiere una cuenta de operador activa.' using errcode = '42501';
  end if;

  return query
    select a.id, a.nombre, a.descripcion, a.cliente_id, c.razon_social::text, a.activa,
           coalesce(
             (select array_agg(r.tipo_documento_id)
                from public.actividad_requisitos r
                where r.actividad_id = a.id),
             '{}'::uuid[])
      from public.actividades a
      left join public.clientes c on c.id = a.cliente_id
      order by a.nombre;
end;
$$;

create or replace function public.guardar_actividad_legajo(
  p_id uuid,
  p_nombre text,
  p_descripcion text,
  p_cliente_id uuid,
  p_activa boolean,
  p_requisitos uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id uuid;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede definir actividades.' using errcode = '42501';
  end if;
  if nullif(btrim(p_nombre), '') is null then
    raise exception 'La actividad necesita un nombre.';
  end if;

  if p_id is null then
    insert into public.actividades (nombre, descripcion, cliente_id, activa)
    values (btrim(p_nombre), nullif(btrim(p_descripcion), ''), p_cliente_id, coalesce(p_activa, true))
    returning id into v_id;
  else
    update public.actividades
       set nombre = btrim(p_nombre),
           descripcion = nullif(btrim(p_descripcion), ''),
           cliente_id = p_cliente_id,
           activa = coalesce(p_activa, true)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'La actividad ya no existe.';
    end if;
  end if;

  delete from public.actividad_requisitos where actividad_id = v_id;
  insert into public.actividad_requisitos (actividad_id, tipo_documento_id)
  select v_id, t from unnest(coalesce(p_requisitos, '{}'::uuid[])) as t
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.revisar_documento_legajo(
  p_documento_id uuid,
  p_aprobar boolean,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede revisar documentos.' using errcode = '42501';
  end if;
  if not p_aprobar and nullif(btrim(p_motivo), '') is null then
    raise exception 'Indicá el motivo del rechazo.';
  end if;

  update public.documentos_legajo
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
         motivo_rechazo = case when p_aprobar then null else btrim(p_motivo) end,
         revisado_por = public.operador_actual_id(),
         revisado_en = now()
   where id = p_documento_id;
  if not found then
    raise exception 'El documento ya no existe.';
  end if;
end;
$$;

create or replace function public.listar_operadores_legajo()
returns table (id uuid, nombre text, rol text, activo boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede ver los legajos del personal.' using errcode = '42501';
  end if;

  return query
    select op.id, op.nombre::text, op.rol::text, coalesce(op.activo, false)
      from public.operadores op
      order by op.nombre;
end;
$$;

revoke all on function public.operador_actual_id() from public, anon;
revoke all on function public.es_gestor_legajos() from public, anon;
revoke all on function public.es_admin_legajos() from public, anon;
revoke all on function public.listar_actividades_legajo() from public, anon;
revoke all on function public.guardar_actividad_legajo(uuid, text, text, uuid, boolean, uuid[]) from public, anon;
revoke all on function public.revisar_documento_legajo(uuid, boolean, text) from public, anon;
revoke all on function public.listar_operadores_legajo() from public, anon;
revoke all on function public.documentos_legajo_antes_de_insertar() from public, anon, authenticated;
grant execute on function public.operador_actual_id() to authenticated;
grant execute on function public.es_gestor_legajos() to authenticated;
grant execute on function public.es_admin_legajos() to authenticated;
grant execute on function public.listar_actividades_legajo() to authenticated;
grant execute on function public.guardar_actividad_legajo(uuid, text, text, uuid, boolean, uuid[]) to authenticated;
grant execute on function public.revisar_documento_legajo(uuid, boolean, text) to authenticated;
grant execute on function public.listar_operadores_legajo() to authenticated;

-- ---------- Archivos (Storage) ----------
-- Bucket privado. Cada archivo vive en "<id del operador>/<archivo>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legajos', 'legajos', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists legajos_leer on storage.objects;
create policy legajos_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'legajos'
    and ((storage.foldername(name))[1] = public.operador_actual_id()::text
         or public.es_gestor_legajos())
  );

drop policy if exists legajos_subir on storage.objects;
create policy legajos_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'legajos'
    and ((storage.foldername(name))[1] = public.operador_actual_id()::text
         or public.es_gestor_legajos())
  );

-- ---------- Datos iniciales ----------

insert into public.tipos_documento (nombre)
values ('Licencia de conducir'), ('Psicofísico'), ('Manejo defensivo')
on conflict (nombre) do nothing;

commit;
