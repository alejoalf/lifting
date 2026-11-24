-- Borrar datos precargados del checklist (por ejemplo, datos de prueba).
-- Los checklists ya guardados no cambian: conservan su propia copia de la precarga.

-- Vehículo: quien cargó los datos por última vez, o un supervisor / administrador.
create or replace function public.borrar_precarga_vehiculo(p_vehiculo_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_op uuid := public.operador_actual_id();
  v_autor uuid;
begin
  if v_op is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select actualizado_por into v_autor from public.checklist_precarga_vehiculo where vehiculo_id = p_vehiculo_id;
  if not found then
    return;
  end if;
  if v_autor is distinct from v_op and not public.es_gestor_legajos() then
    raise exception 'Solo quien cargó los datos del vehículo o un supervisor puede borrarlos.' using errcode = '42501';
  end if;
  delete from public.checklist_precarga_vehiculo where vehiculo_id = p_vehiculo_id;
end;
$$;

-- Conductor: los propios, o los de cualquiera si es supervisor / administrador.
create or replace function public.borrar_precarga_conductor(p_operador_id uuid default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_op uuid := public.operador_actual_id();
  v_destino uuid := coalesce(p_operador_id, v_op);
begin
  if v_op is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  if v_destino <> v_op and not public.es_gestor_legajos() then
    raise exception 'Solo podés borrar tus propios datos de conductor.' using errcode = '42501';
  end if;
  delete from public.checklist_precarga_conductor where operador_id = v_destino;
end;
$$;

revoke all on function public.borrar_precarga_vehiculo(uuid) from public, anon;
revoke all on function public.borrar_precarga_conductor(uuid) from public, anon;
grant execute on function public.borrar_precarga_vehiculo(uuid) to authenticated;
grant execute on function public.borrar_precarga_conductor(uuid) to authenticated;
