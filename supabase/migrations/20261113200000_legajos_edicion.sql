-- Legajos: editar y eliminar documentos ya cargados (correcciones y renovaciones).
-- Requiere la migración 20261113190000_legajos_habilitaciones.
begin;

-- Edita un documento. Si lo edita el propio operador vuelve a quedar pendiente de
-- revisión; si lo edita Supervisor/Admin queda aprobado.
-- p_archivo_path / p_archivo_nombre en NULL = se conserva el archivo actual.
create or replace function public.editar_documento_legajo(
  p_documento_id uuid,
  p_tipo_documento_id uuid,
  p_fecha_emision date,
  p_vencimiento date,
  p_archivo_path text,
  p_archivo_nombre text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_doc public.documentos_legajo;
  v_yo uuid := public.operador_actual_id();
  v_gestor boolean := public.es_gestor_legajos();
begin
  select * into v_doc from public.documentos_legajo where id = p_documento_id for update;
  if not found then
    raise exception 'El documento ya no existe.';
  end if;
  if v_yo is null or not (v_gestor or v_doc.operador_id = v_yo) then
    raise exception 'No tenés permiso para editar este documento.' using errcode = '42501';
  end if;

  if p_vencimiento is null and exists (
    select 1 from public.tipos_documento t
    where t.id = p_tipo_documento_id and t.requiere_vencimiento
  ) then
    raise exception 'Este tipo de documento requiere fecha de vencimiento.';
  end if;
  if p_archivo_path is not null and p_archivo_path not like v_doc.operador_id::text || '/%' then
    raise exception 'El archivo no corresponde al legajo de este operador.';
  end if;

  update public.documentos_legajo
     set tipo_documento_id = p_tipo_documento_id,
         fecha_emision = p_fecha_emision,
         vencimiento = p_vencimiento,
         archivo_path = coalesce(p_archivo_path, archivo_path),
         archivo_nombre = case when p_archivo_path is null then archivo_nombre
                               else coalesce(nullif(btrim(p_archivo_nombre), ''), archivo_nombre) end,
         lectura_ia = case when p_archivo_path is null then lectura_ia else null end,
         estado = case when v_gestor then 'aprobado' else 'pendiente' end,
         motivo_rechazo = null,
         revisado_por = case when v_gestor then v_yo end,
         revisado_en = case when v_gestor then now() end
   where id = p_documento_id;
end;
$$;

-- Supervisor/Admin eliminan cualquier documento; el operador solo los propios
-- que no estén aprobados.
create or replace function public.eliminar_documento_legajo(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_doc public.documentos_legajo;
  v_yo uuid := public.operador_actual_id();
begin
  select * into v_doc from public.documentos_legajo where id = p_documento_id for update;
  if not found then
    raise exception 'El documento ya no existe.';
  end if;
  if v_yo is null or not (
    public.es_gestor_legajos()
    or (v_doc.operador_id = v_yo and v_doc.estado <> 'aprobado')
  ) then
    raise exception 'No tenés permiso para eliminar este documento.' using errcode = '42501';
  end if;

  delete from public.documentos_legajo where id = p_documento_id;
end;
$$;

revoke all on function public.editar_documento_legajo(uuid, uuid, date, date, text, text) from public, anon;
revoke all on function public.eliminar_documento_legajo(uuid) from public, anon;
grant execute on function public.editar_documento_legajo(uuid, uuid, date, date, text, text) to authenticated;
grant execute on function public.eliminar_documento_legajo(uuid) to authenticated;

-- Borrar archivos del bucket: Supervisor/Admin cualquiera; el operador solo los
-- propios que no respalden un documento aprobado.
drop policy if exists legajos_borrar on storage.objects;
create policy legajos_borrar on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'legajos'
    and (
      public.es_gestor_legajos()
      or ((storage.foldername(name))[1] = public.operador_actual_id()::text
          and not exists (
            select 1 from public.documentos_legajo d
            where d.archivo_path = name and d.estado = 'aprobado'))
    )
  );

commit;
