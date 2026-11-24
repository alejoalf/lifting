-- Borrar registros cargados por error. Quién puede:
--   Checklist:        supervisor / admin, o quien lo cargó. Nunca si habilitó un gerenciamiento.
--   Gerenciamiento:   supervisor / admin, o quien lo cargó mientras no esté autorizado.
--   Tarjeta:          supervisor / admin, o quien la cargó mientras esté abierta.
--   Parte diario:     admin siempre; supervisor si no está firmado; el operador mientras no haya salido
--                     (pendiente, con excepción o frenado). Sus gerenciamientos quedan sin parte.
-- Las notificaciones que apuntaban al registro borrado se eliminan.

create or replace function public.eliminar_checklist(p_id bigint)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_c public.checklists%rowtype;
  v_g bigint;
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_c from public.checklists where id = p_id for update;
  if not found then
    raise exception 'El checklist ya no existe.';
  end if;
  if v_c.creado_por <> v_yo and not public.es_gestor_legajos() then
    raise exception 'Solo quien cargó el checklist o un supervisor puede borrarlo.' using errcode = '42501';
  end if;
  select g.id into v_g from public.gerenciamientos g where g.checklist_id = p_id limit 1;
  if v_g is not null then
    raise exception 'Este checklist habilitó el gerenciamiento #%. Borrá primero el gerenciamiento.', v_g;
  end if;
  delete from public.checklists where id = p_id;
  delete from public.notificaciones where enlace = format('/checklist/%s', p_id);
end;
$$;

create or replace function public.eliminar_gerenciamiento(p_id bigint)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_g public.gerenciamientos%rowtype;
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_g from public.gerenciamientos where id = p_id for update;
  if not found then
    raise exception 'El gerenciamiento ya no existe.';
  end if;
  if not public.es_gestor_legajos() and not (v_g.creado_por = v_yo and v_g.autorizacion = 'pendiente') then
    raise exception 'Solo podés borrar tus gerenciamientos mientras no estén autorizados. Pedíselo a un supervisor.' using errcode = '42501';
  end if;
  delete from public.gerenciamientos where id = p_id;
end;
$$;

create or replace function public.eliminar_observacion(p_id bigint)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_o public.observaciones%rowtype;
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_o from public.observaciones where id = p_id for update;
  if not found then
    raise exception 'La tarjeta ya no existe.';
  end if;
  if not public.es_gestor_legajos() and not (v_o.creado_por = v_yo and v_o.estado = 'abierta') then
    raise exception 'Solo podés borrar tus tarjetas mientras estén abiertas. Pedíselo a un supervisor.' using errcode = '42501';
  end if;
  delete from public.observaciones where id = p_id;
end;
$$;

create or replace function public.eliminar_parte_diario(p_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_p public.partes_diarios%rowtype;
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_p from public.partes_diarios where id = p_id for update;
  if not found then
    raise exception 'El parte ya no existe.';
  end if;
  if not (
    public.es_admin_legajos()
    or (public.es_gestor_legajos() and v_p.firmado_en is null)
    or (v_p.operador_id = v_yo and v_p.estado in ('Pendiente'::public.estado_parte, 'Excepcion'::public.estado_parte, 'Frenado'::public.estado_parte))
  ) then
    raise exception 'No podés borrar este parte: ya salió o ya está firmado. Pedíselo a un administrador.' using errcode = '42501';
  end if;
  delete from public.partes_diarios where id = p_id;
  delete from public.notificaciones where enlace = format('/partes/%s', p_id);
end;
$$;

revoke all on function public.eliminar_checklist(bigint) from public, anon;
revoke all on function public.eliminar_gerenciamiento(bigint) from public, anon;
revoke all on function public.eliminar_observacion(bigint) from public, anon;
revoke all on function public.eliminar_parte_diario(uuid) from public, anon;
grant execute on function public.eliminar_checklist(bigint) to authenticated;
grant execute on function public.eliminar_gerenciamiento(bigint) to authenticated;
grant execute on function public.eliminar_observacion(bigint) to authenticated;
grant execute on function public.eliminar_parte_diario(uuid) to authenticated;
