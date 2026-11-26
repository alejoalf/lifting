-- Seguridad antes de la beta (avisos del asesor de seguridad de Supabase).
--
--   1. Las funciones de trigger no se pueden llamar desde la API (/rest/v1/rpc/...).
--      Los triggers siguen funcionando igual: el permiso solo se controla al crearlos.
--   2. rol_actual() deja de estar disponible sin sesión.
--   3. search_path fijo en las funciones que no lo tenían (evita que se "secuestre" una función
--      creando otra con el mismo nombre en otro esquema).
--   4. Límite de 10 MB por archivo en el bucket legajos (como flota y certificados).
--
-- Queda fuera, a propósito:
--   * correos tiene RLS sin políticas: es correcto, solo la usa la base y la Edge Function (service role).
--   * pg_net en el esquema public: moverla puede romper los avisos por mail; se revisa al activar correos.
--   * Protección de contraseñas filtradas: se activa desde el panel (Auth > Settings), no por SQL.

-- 1. Funciones de trigger fuera de la API.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- 2. rol_actual solo con sesión.
revoke execute on function public.rol_actual() from public, anon;
grant execute on function public.rol_actual() to authenticated;

-- 3. search_path fijo.
alter function public.riesgo_actualizado() set search_path = pg_catalog, public;
alter function public.inicio_dia_ar(date) set search_path = pg_catalog, public;
alter function public.strix_segundos_en(public.gerenciamientos, timestamptz, timestamptz) set search_path = pg_catalog, public;
alter function public.constancia_inmutable() set search_path = pg_catalog, public;
alter function public.gerenciamiento_salida(public.gerenciamientos) set search_path = pg_catalog, public;
alter function public.gerenciamiento_llegada(public.gerenciamientos) set search_path = pg_catalog, public;
alter function public.normalizar_dominio(text) set search_path = pg_catalog, public;
alter function public.strix_margen() set search_path = pg_catalog, public;
alter function public.hoy_ar() set search_path = pg_catalog, public;
alter function public.impedir_borrado() set search_path = pg_catalog, public;

-- 4. Tamaño máximo de archivo en legajos.
update storage.buckets set file_size_limit = 10485760 where id = 'legajos';
