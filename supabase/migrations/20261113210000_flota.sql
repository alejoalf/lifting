-- Flota: fechas de service, documentos por vehículo y alta/baja/edición de
-- vehículos, todo reservado al administrador.
-- Requiere la migración 20261113190000_legajos_habilitaciones.
begin;

-- ---------- Service obligatorio ----------

alter table public.vehiculos
  add column if not exists ultimo_service date,
  add column if not exists proximo_service date;

-- ---------- Tipos de documento: de personal o de vehículo ----------

alter table public.tipos_documento
  add column if not exists aplica_a text not null default 'operador'
    check (aplica_a in ('operador', 'vehiculo'));

insert into public.tipos_documento (nombre, aplica_a)
values ('Seguro', 'vehiculo'),
       ('VTV provincial', 'vehiculo'),
       ('VTV nacional (RTO)', 'vehiculo'),
       ('Habilitación técnica hidrogrúa', 'vehiculo'),
       ('Habilitación técnica barquilla', 'vehiculo')
on conflict (nombre) do nothing;

-- ---------- Documentos de cada vehículo ----------

create table if not exists public.documentos_vehiculo (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references public.vehiculos(id) on delete cascade,
  tipo_documento_id uuid not null references public.tipos_documento(id),
  fecha_emision date,
  vencimiento date,
  archivo_path text not null unique,
  archivo_nombre text not null,
  cargado_por uuid references public.operadores(id) default public.operador_actual_id(),
  created_at timestamptz not null default now()
);

create index if not exists documentos_vehiculo_vehiculo_idx
  on public.documentos_vehiculo (vehiculo_id, tipo_documento_id);

alter table public.documentos_vehiculo enable row level security;
revoke all on table public.documentos_vehiculo from anon, authenticated;
grant select, insert, update, delete on table public.documentos_vehiculo to authenticated;

drop policy if exists documentos_vehiculo_leer on public.documentos_vehiculo;
create policy documentos_vehiculo_leer on public.documentos_vehiculo
  for select to authenticated using (public.es_gestor_legajos());

drop policy if exists documentos_vehiculo_crear on public.documentos_vehiculo;
create policy documentos_vehiculo_crear on public.documentos_vehiculo
  for insert to authenticated with check (public.es_admin_legajos());

drop policy if exists documentos_vehiculo_editar on public.documentos_vehiculo;
create policy documentos_vehiculo_editar on public.documentos_vehiculo
  for update to authenticated
  using (public.es_admin_legajos()) with check (public.es_admin_legajos());

drop policy if exists documentos_vehiculo_eliminar on public.documentos_vehiculo;
create policy documentos_vehiculo_eliminar on public.documentos_vehiculo
  for delete to authenticated using (public.es_admin_legajos());

-- ---------- Alta, edición y baja de vehículos ----------

-- Columnas editables de vehiculos con su tipo, para que la app arme el
-- formulario sin conocer el esquema de antemano. Solo responde a un Admin.
create or replace function public.columnas_vehiculos()
returns table (columna text, tipo text, obligatoria boolean, opciones text[])
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select a.attname::text,
         case when t.typtype = 'e' then 'enum'
              when t.typname = 'date' then 'fecha'
              when t.typname = 'bool' then 'booleano'
              when t.typcategory = 'N' then 'numero'
              else 'texto' end,
         a.attnotnull and not a.atthasdef,
         case when t.typtype = 'e' then
           (select array_agg(e.enumlabel::text order by e.enumsortorder)
              from pg_catalog.pg_enum e where e.enumtypid = t.oid)
         end
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.vehiculos'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attidentity = ''
      and a.attname not in ('id', 'created_at', 'updated_at')
      and public.es_admin_legajos()
    order by a.attnum;
$$;

-- Crea (p_id NULL) o modifica un vehículo. p_datos lleva solo las columnas a guardar.
create or replace function public.guardar_vehiculo(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_columnas text;
  v_id uuid;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede modificar la flota.' using errcode = '42501';
  end if;

  select string_agg(quote_ident(c.columna), ', ')
    into v_columnas
    from public.columnas_vehiculos() c
    where p_datos ? c.columna;
  if v_columnas is null then
    raise exception 'No hay datos para guardar.';
  end if;

  if p_id is null then
    execute format(
      'insert into public.vehiculos (%1$s)
       select %1$s from jsonb_populate_record(null::public.vehiculos, $1)
       returning id', v_columnas)
      into v_id using p_datos;
  else
    execute format(
      'update public.vehiculos v
          set (%1$s) = (select %1$s from jsonb_populate_record(null::public.vehiculos, $1))
        where v.id = $2
        returning v.id', v_columnas)
      into v_id using p_datos, p_id;
    if v_id is null then
      raise exception 'El vehículo ya no existe.';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe un vehículo con esos datos. Revisá que el dominio no esté repetido.';
  when not_null_violation then
    raise exception 'Falta completar un dato obligatorio del vehículo.';
end;
$$;

create or replace function public.eliminar_vehiculo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede modificar la flota.' using errcode = '42501';
  end if;

  delete from public.vehiculos where id = p_id;
  if not found then
    raise exception 'El vehículo ya no existe.';
  end if;
exception
  when foreign_key_violation then
    raise exception 'El vehículo tiene partes, contratos u otros registros asociados y no se puede eliminar. Cambiale el estado para sacarlo de servicio.';
end;
$$;

revoke all on function public.columnas_vehiculos() from public, anon;
revoke all on function public.guardar_vehiculo(uuid, jsonb) from public, anon;
revoke all on function public.eliminar_vehiculo(uuid) from public, anon;
grant execute on function public.columnas_vehiculos() to authenticated;
grant execute on function public.guardar_vehiculo(uuid, jsonb) to authenticated;
grant execute on function public.eliminar_vehiculo(uuid) to authenticated;

-- ---------- Archivos (Storage) ----------
-- Bucket privado. Cada archivo vive en "<id del vehículo>/<archivo>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flota', 'flota', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists flota_leer on storage.objects;
create policy flota_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'flota' and public.es_gestor_legajos());

drop policy if exists flota_subir on storage.objects;
create policy flota_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flota' and public.es_admin_legajos());

drop policy if exists flota_borrar on storage.objects;
create policy flota_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'flota' and public.es_admin_legajos());

commit;
