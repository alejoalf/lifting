-- Clientes, contratos y certificaciones: datos de facturación, estado de los
-- contratos, seguimiento de cobro, certificados que exigen los clientes e
-- historial por cliente. Todo reservado al administrador.
-- Requiere la migración 20261113190000_legajos_habilitaciones.
begin;

-- ---------- Clientes: datos para facturar ----------
-- Razón social, CUIT, condición de IVA, contacto y emails ya existen en la tabla.

alter table public.clientes
  add column if not exists domicilio_fiscal text,
  add column if not exists localidad text,
  add column if not exists provincia text,
  add column if not exists codigo_postal text,
  add column if not exists telefono text,
  add column if not exists condicion_pago_dias integer check (condicion_pago_dias >= 0),
  add column if not exists observaciones text;

-- ---------- Contratos: estado y vigencia ----------

do $$
begin
  create type public.estado_contrato as enum
    ('Pendiente', 'En curso', 'Realizado - falta de pago', 'Finalizado');
exception when duplicate_object then null;
end $$;

alter table public.contratos
  add column if not exists estado_contrato public.estado_contrato not null default 'En curso',
  add column if not exists fecha_inicio date,
  add column if not exists fecha_fin date;

-- ---------- Certificaciones mensuales: factura y cobro ----------

alter table public.certificaciones
  add column if not exists nro_factura text,
  add column if not exists fecha_factura date,
  add column if not exists fecha_cobro date;

-- ---------- Certificados y requisitos que exigen los clientes ----------
-- Un mismo certificado (ISO, seguro, inscripción, etc.) puede valer para todos
-- los clientes o para los clientes y contratos que se le asignen.

create table if not exists public.certificados_empresa (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) <> ''),
  emisor text,
  fecha_emision date,
  vencimiento date,
  archivo_path text unique,
  archivo_nombre text,
  aplica_a_todos boolean not null default false,
  observaciones text,
  created_at timestamptz not null default now()
);

create table if not exists public.certificado_clientes (
  certificado_id uuid not null references public.certificados_empresa(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  primary key (certificado_id, cliente_id)
);

create table if not exists public.certificado_contratos (
  certificado_id uuid not null references public.certificados_empresa(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  primary key (certificado_id, contrato_id)
);

-- ---------- Historial de cada cliente ----------

create table if not exists public.cliente_historial (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  fecha date not null default current_date,
  tipo text not null default 'Nota'
    check (tipo in ('Nota', 'Llamada', 'Reunión', 'Email', 'Reclamo', 'Pago')),
  detalle text not null check (btrim(detalle) <> ''),
  creado_por uuid references public.operadores(id) default public.operador_actual_id(),
  created_at timestamptz not null default now()
);

create index if not exists cliente_historial_cliente_idx
  on public.cliente_historial (cliente_id, fecha desc);

-- ---------- Permisos (RLS): solo Admin ----------

do $$
declare
  t text;
begin
  foreach t in array array['certificados_empresa', 'certificado_clientes', 'certificado_contratos', 'cliente_historial']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.es_admin_legajos()) with check (public.es_admin_legajos())',
      t || '_admin', t);
  end loop;
end $$;

-- ---------- Alta, edición y baja de clientes, contratos y certificaciones ----------

-- Columnas editables de una tabla con su tipo, para que la app arme el
-- formulario con las columnas reales. Solo responde a un Admin.
create or replace function public.columnas_tabla(p_tabla text)
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
              when t.typcategory = 'A' then 'lista'
              else 'texto' end,
         a.attnotnull and not a.atthasdef,
         case when t.typtype = 'e' then
           (select array_agg(e.enumlabel::text order by e.enumsortorder)
              from pg_catalog.pg_enum e where e.enumtypid = t.oid)
         end
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_type t on t.oid = a.atttypid
    where a.attrelid = case
            when p_tabla in ('clientes', 'contratos', 'certificaciones')
            then ('public.' || quote_ident(p_tabla))::regclass
          end
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attidentity = ''
      and a.attname not in ('id', 'created_at', 'updated_at')
      and public.es_admin_legajos()
    order by a.attnum;
$$;

-- Crea (p_id NULL) o modifica una fila. p_datos lleva solo las columnas a guardar.
create or replace function public.guardar_fila(p_tabla text, p_id text, p_datos jsonb)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_columnas text;
  v_id text;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede modificar estos datos.' using errcode = '42501';
  end if;
  if p_tabla is null or p_tabla not in ('clientes', 'contratos', 'certificaciones') then
    raise exception 'Tabla no permitida.';
  end if;

  select string_agg(quote_ident(c.columna), ', ')
    into v_columnas
    from public.columnas_tabla(p_tabla) c
    where p_datos ? c.columna;
  if v_columnas is null then
    raise exception 'No hay datos para guardar.';
  end if;

  if p_id is null then
    execute format(
      'insert into public.%1$I (%2$s)
       select %2$s from jsonb_populate_record(null::public.%1$I, $1)
       returning id::text', p_tabla, v_columnas)
      into v_id using p_datos;
  else
    execute format(
      'update public.%1$I t
          set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))
        where t.id::text = $2
        returning t.id::text', p_tabla, v_columnas)
      into v_id using p_datos, p_id;
    if v_id is null then
      raise exception 'El registro ya no existe.';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe un registro con esos datos.';
  when not_null_violation then
    raise exception 'Falta completar un dato obligatorio.';
  when foreign_key_violation then
    raise exception 'El cliente, contrato o vehículo elegido ya no existe.';
  when check_violation then
    raise exception 'Alguno de los valores no es válido.';
end;
$$;

create or replace function public.eliminar_fila(p_tabla text, p_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id text;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede modificar estos datos.' using errcode = '42501';
  end if;
  if p_tabla is null or p_tabla not in ('clientes', 'contratos', 'certificaciones') then
    raise exception 'Tabla no permitida.';
  end if;

  execute format('delete from public.%I t where t.id::text = $1 returning t.id::text', p_tabla)
    into v_id using p_id;
  if v_id is null then
    raise exception 'El registro ya no existe.';
  end if;
exception
  when foreign_key_violation then
    raise exception 'Tiene contratos, certificaciones, partes u otros registros asociados y no se puede eliminar.';
end;
$$;

revoke all on function public.columnas_tabla(text) from public, anon;
revoke all on function public.guardar_fila(text, text, jsonb) from public, anon;
revoke all on function public.eliminar_fila(text, text) from public, anon;
grant execute on function public.columnas_tabla(text) to authenticated;
grant execute on function public.guardar_fila(text, text, jsonb) to authenticated;
grant execute on function public.eliminar_fila(text, text) to authenticated;

-- ---------- Archivos (Storage) ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificados', 'certificados', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists certificados_admin on storage.objects;
create policy certificados_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'certificados' and public.es_admin_legajos())
  with check (bucket_id = 'certificados' and public.es_admin_legajos());

commit;
