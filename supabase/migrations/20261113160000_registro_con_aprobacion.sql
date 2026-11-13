begin;

create table public.solicitudes_registro (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  nombre text not null,
  email text not null,
  rol_solicitado text not null check (
    lower(rol_solicitado) in ('chofer', 'hidrogrulero', 'supervisor', 'admin')
  ),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  rol_asignado text,
  revisado_por uuid references auth.users(id),
  revisado_en timestamptz,
  creado_en timestamptz not null default now()
);

create index solicitudes_registro_pendientes_idx
  on public.solicitudes_registro (creado_en)
  where estado = 'pendiente';

alter table public.solicitudes_registro enable row level security;

grant select on public.solicitudes_registro to authenticated;

drop policy if exists "usuarios_lee_su_solicitud" on public.solicitudes_registro;
create policy "usuarios_lee_su_solicitud"
  on public.solicitudes_registro
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "admin_lee_solicitudes_registro" on public.solicitudes_registro;
create policy "admin_lee_solicitudes_registro"
  on public.solicitudes_registro
  for select
  to authenticated
  using (public.rol_actual() = 'Admin'::public.rol_operador);

create or replace function public.crear_solicitud_registro()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_nombre text;
  v_rol text;
begin
  v_nombre := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_rol := lower(btrim(new.raw_user_meta_data ->> 'requested_role'));

  if v_nombre is null then
    raise exception 'El nombre es obligatorio para solicitar acceso.';
  end if;

  if v_rol not in ('chofer', 'hidrogrulero', 'supervisor', 'admin') then
    raise exception 'El rol solicitado no es válido.';
  end if;

  insert into public.solicitudes_registro (auth_user_id, nombre, email, rol_solicitado)
  values (new.id, v_nombre, new.email, v_rol);

  return new;
end;
$$;

revoke all on function public.crear_solicitud_registro() from public, anon, authenticated;

drop trigger if exists crear_solicitud_registro_despues_de_signup on auth.users;
create trigger crear_solicitud_registro_despues_de_signup
  after insert on auth.users
  for each row execute function public.crear_solicitud_registro();

create or replace function public.aprobar_solicitud_registro(p_solicitud_id uuid, p_rol text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_solicitud public.solicitudes_registro%rowtype;
  v_rol public.rol_operador;
  v_operador_id uuid;
  v_coincidencias integer;
begin
  if auth.uid() is null or public.rol_actual() is distinct from 'Admin'::public.rol_operador then
    raise exception 'Solo un administrador puede aprobar solicitudes.'
      using errcode = '42501';
  end if;

  select *
    into v_solicitud
    from public.solicitudes_registro
    where id = p_solicitud_id and estado = 'pendiente'
    for update;

  if not found then
    raise exception 'La solicitud no existe o ya fue revisada.';
  end if;

  if not exists (
    select 1
      from auth.users
      where id = v_solicitud.auth_user_id and email_confirmed_at is not null
  ) then
    raise exception 'La persona debe verificar su correo antes de aprobar la solicitud.';
  end if;

  select e.enumlabel::public.rol_operador
    into v_rol
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'rol_operador'
      and lower(e.enumlabel) = lower(btrim(p_rol))
      and lower(e.enumlabel) in ('chofer', 'hidrogrulero', 'supervisor', 'admin')
    limit 1;

  if v_rol is null then
    raise exception 'El rol asignado no es válido.';
  end if;

  if exists (
    select 1 from public.operadores where auth_user_id = v_solicitud.auth_user_id
  ) then
    raise exception 'La cuenta ya está vinculada a un operador.';
  end if;

  select count(*)
    into v_coincidencias
    from public.operadores
    where auth_user_id is null
      and email is not null
      and lower(btrim(email)) = lower(btrim(v_solicitud.email));

  if v_coincidencias > 1 then
    raise exception 'Hay varios operadores sin vincular con ese correo. Revisá la tabla operadores antes de aprobar.';
  elsif v_coincidencias = 1 then
    select id
      into v_operador_id
      from public.operadores
      where auth_user_id is null
        and email is not null
        and lower(btrim(email)) = lower(btrim(v_solicitud.email))
      for update;

    update public.operadores
      set auth_user_id = v_solicitud.auth_user_id,
          rol = v_rol,
          activo = true
      where id = v_operador_id;
  else
    insert into public.operadores (auth_user_id, nombre, rol, email, activo)
      values (v_solicitud.auth_user_id, v_solicitud.nombre, v_rol, v_solicitud.email, true)
      returning id into v_operador_id;
  end if;

  update public.solicitudes_registro
    set estado = 'aprobada',
        rol_asignado = v_rol::text,
        revisado_por = auth.uid(),
        revisado_en = now()
    where id = v_solicitud.id;

  return v_operador_id;
end;
$$;

create or replace function public.rechazar_solicitud_registro(p_solicitud_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or public.rol_actual() is distinct from 'Admin'::public.rol_operador then
    raise exception 'Solo un administrador puede rechazar solicitudes.'
      using errcode = '42501';
  end if;

  update public.solicitudes_registro
    set estado = 'rechazada',
        revisado_por = auth.uid(),
        revisado_en = now()
    where id = p_solicitud_id and estado = 'pendiente';

  if not found then
    raise exception 'La solicitud no existe o ya fue revisada.';
  end if;
end;
$$;

revoke all on function public.aprobar_solicitud_registro(uuid, text) from public, anon;
revoke all on function public.rechazar_solicitud_registro(uuid) from public, anon;
grant execute on function public.aprobar_solicitud_registro(uuid, text) to authenticated;
grant execute on function public.rechazar_solicitud_registro(uuid) to authenticated;

commit;
