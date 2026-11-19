-- Registro con Google.
--
-- Al crearse una cuenta, el trigger crear_solicitud_registro arma la solicitud
-- de acceso con el nombre y el rol que la persona completó en el formulario
-- (raw_user_meta_data.full_name y requested_role). Con Google no hay
-- formulario: Google manda el nombre, pero no el rol. Hasta ahora eso hacía
-- fallar el alta ("Database error saving new user").
--
-- Esta migración:
--   1. Guarda de qué proveedor viene la cuenta (email, google...) y si la
--      persona ya confirmó el rol que solicita.
--   2. Con Google, crea la solicitud con el nombre de Google y el rol sin
--      confirmar; al volver a la app la persona lo elige con
--      completar_solicitud_registro().
--   3. Con correo y contraseña sigue igual: nombre y rol obligatorios.
-- La aprobación del administrador no cambia (aprobar_solicitud_registro).
begin;

alter table public.solicitudes_registro
  add column if not exists proveedor text not null default 'email',
  add column if not exists rol_confirmado boolean not null default true;

create or replace function public.crear_solicitud_registro()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_proveedor text := coalesce(nullif(new.raw_app_meta_data ->> 'provider', ''), 'email');
  v_nombre text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''));
  v_rol text := lower(btrim(new.raw_user_meta_data ->> 'requested_role'));
  v_rol_valido boolean;
begin
  v_rol_valido := coalesce(v_rol in ('chofer', 'hidrogrulero', 'supervisor', 'admin'), false);

  if v_proveedor = 'email' then
    -- Registro con correo: el formulario exige nombre y rol.
    if v_nombre is null then
      raise exception 'El nombre es obligatorio para solicitar acceso.';
    end if;
    if not v_rol_valido then
      raise exception 'El rol solicitado no es válido.';
    end if;
  else
    -- Google u otro proveedor: el rol se elige al volver a la app.
    v_nombre := coalesce(v_nombre, split_part(coalesce(new.email, ''), '@', 1), 'Sin nombre');
  end if;

  insert into public.solicitudes_registro (auth_user_id, nombre, email, rol_solicitado, proveedor, rol_confirmado)
  values (new.id, v_nombre, coalesce(new.email, ''),
          case when v_rol_valido then v_rol else 'chofer' end,
          v_proveedor, v_rol_valido)
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

-- La persona completa (o corrige) su propia solicitud mientras está pendiente.
create or replace function public.completar_solicitud_registro(p_nombre text, p_rol text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := lower(btrim(coalesce(p_rol, '')));
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión para completar la solicitud.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'Indicá tu nombre y apellido.';
  end if;
  if v_rol not in ('chofer', 'hidrogrulero', 'supervisor', 'admin') then
    raise exception 'El rol solicitado no es válido.';
  end if;

  update public.solicitudes_registro s
     set nombre = btrim(p_nombre),
         rol_solicitado = v_rol,
         rol_confirmado = true
   where s.auth_user_id = auth.uid()
     and s.estado = 'pendiente';
  if not found then
    raise exception 'No tenés una solicitud pendiente para completar.';
  end if;
end;
$$;

revoke all on function public.completar_solicitud_registro(text, text) from public, anon;
grant execute on function public.completar_solicitud_registro(text, text) to authenticated;

commit;
