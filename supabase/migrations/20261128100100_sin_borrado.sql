-- Sin borrado: los datos de la operación no se borran nunca (pedido del cliente).
--
--   1. Registros operativos y documentos  -> se ANULAN: quedan guardados y visibles como "Anulado",
--      con motivo, quién y cuándo. Un registro anulado ya no se puede modificar.
--   2. Catálogos (clientes, proveedores, vehículos, contratos, matriz) -> se DESACTIVAN.
--   3. La base rechaza cualquier DELETE o TRUNCATE en esas tablas, venga de quien venga.
--   4. Auditoría: cada modificación o borrado (de las tablas que sí lo permiten) guarda el valor anterior.
--   5. Storage: los archivos subidos tampoco se borran (al reemplazar un archivo, el anterior queda).
--
-- Tablas que SÍ admiten borrado (datos auxiliares, no registros): notificaciones, solicitudes_registro,
-- checklist_precarga_vehiculo y las tablas de vínculo actividad_requisitos, certificado_clientes,
-- certificado_contratos. Igual quedan en la auditoría.
--
-- Para borrar datos de prueba ANTES de salir a producción, el dueño de la base (SQL Editor) puede
-- desactivar el trigger "impedir_borrado" de una tabla puntual y volver a activarlo después.

-- ---------------------------------------------------------------------------
-- 1. Columnas de anulación y de actividad
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'partes_diarios', 'gerenciamientos', 'checklists', 'observaciones',
    'documentos_legajo', 'documentos_vehiculo', 'caja_gastos', 'cliente_historial',
    'certificados_empresa', 'certificaciones', 'strix_recorridos', 'strix_importaciones'
  ] loop
    execute format(
      'alter table public.%I
         add column if not exists anulado_en timestamptz,
         add column if not exists anulado_por uuid references public.operadores(id),
         add column if not exists motivo_anulacion text', t);
  end loop;
end;
$$;

alter table public.clientes add column if not exists activo boolean not null default true;
alter table public.proveedores add column if not exists activo boolean not null default true;

-- Estados de texto que ahora admiten "anulado".
alter table public.gerenciamientos drop constraint if exists gerenciamientos_estado_check,
  add constraint gerenciamientos_estado_check check (estado in ('abierto', 'cerrado', 'anulado'));
alter table public.observaciones drop constraint if exists observaciones_estado_check,
  add constraint observaciones_estado_check check (estado in ('abierta', 'cerrada', 'anulada'));
alter table public.documentos_legajo drop constraint if exists documentos_legajo_estado_check,
  add constraint documentos_legajo_estado_check check (estado in ('pendiente', 'aprobado', 'rechazado', 'anulado'));

-- ---------------------------------------------------------------------------
-- 2. Un registro anulado queda congelado. La anulación solo se hace con las funciones anular_*.
-- ---------------------------------------------------------------------------
create or replace function public.proteger_anulado()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.anulado_en := null;
    new.anulado_por := null;
    new.motivo_anulacion := null;
    return new;
  end if;

  if old.anulado_en is not null then
    -- Strix: volver a cargar o importar el mismo recorrido (mismo dominio, inicio y fin) lo reemplaza.
    -- La versión anulada queda guardada en la auditoría.
    if tg_table_name = 'strix_recorridos' and coalesce(current_setting('lifting.anulando', true), '') <> 'si' then
      insert into public.auditoria (tabla, registro_id, accion, operador_id, auth_user_id, antes, cambios)
      values (tg_table_name, old.id::text, 'UPDATE', public.operador_actual_id(), auth.uid(), to_jsonb(old),
              jsonb_build_object('reemplazado_por_nueva_carga', true));
      new.anulado_en := null;
      new.anulado_por := null;
      new.motivo_anulacion := null;
      return new;
    end if;
    raise exception 'Este registro está anulado y ya no se puede modificar.' using errcode = '42501';
  end if;

  if (new.anulado_en, new.anulado_por, new.motivo_anulacion)
       is distinct from (old.anulado_en, old.anulado_por, old.motivo_anulacion)
     and coalesce(current_setting('lifting.anulando', true), '') <> 'si' then
    raise exception 'Para anular un registro usá la opción «Anular».' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'partes_diarios', 'gerenciamientos', 'checklists', 'observaciones',
    'documentos_legajo', 'documentos_vehiculo', 'caja_gastos', 'cliente_historial',
    'certificados_empresa', 'certificaciones', 'strix_recorridos', 'strix_importaciones'
  ] loop
    execute format('drop trigger if exists proteger_anulado on public.%I', t);
    execute format(
      'create trigger proteger_anulado before insert or update on public.%I
         for each row execute function public.proteger_anulado()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Auditoría: historial de cambios (solo lo lee el administrador; nadie lo puede editar)
-- ---------------------------------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  momento timestamptz not null default now(),
  tabla text not null,
  registro_id text,
  accion text not null check (accion in ('UPDATE', 'DELETE')),
  operador_id uuid,
  auth_user_id uuid,
  antes jsonb not null,
  cambios jsonb
);
create index if not exists auditoria_registro_idx on public.auditoria (tabla, registro_id, momento desc);

alter table public.auditoria enable row level security;
revoke all on public.auditoria from public, anon, authenticated;
grant select on public.auditoria to authenticated;
drop policy if exists auditoria_admin_leer on public.auditoria;
create policy auditoria_admin_leer on public.auditoria for select to authenticated
  using (public.es_admin_legajos());

-- Argumentos del trigger: patrones (LIKE) de columnas cuyos cambios no se registran
-- (por ejemplo los totales de Strix que se recalculan solos).
create or replace function public.registrar_auditoria()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_antes jsonb := to_jsonb(old);
  v_despues jsonb;
  v_cambios jsonb;
begin
  if tg_op = 'UPDATE' then
    v_despues := to_jsonb(new);
    select jsonb_object_agg(k, v_despues -> k) into v_cambios
      from jsonb_object_keys(v_despues) as k
     where (v_despues -> k) is distinct from (v_antes -> k)
       and not (k like any (coalesce(tg_argv, '{}'::text[])));
    if v_cambios is null then
      return null;
    end if;
  end if;

  insert into public.auditoria (tabla, registro_id, accion, operador_id, auth_user_id, antes, cambios)
  values (tg_table_name, coalesce(v_antes ->> 'id', v_antes ->> 'vehiculo_id'), tg_op,
          public.operador_actual_id(), auth.uid(), v_antes, v_cambios);
  return null;
end;
$$;

revoke all on function public.registrar_auditoria() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. La base rechaza el borrado
-- ---------------------------------------------------------------------------
create or replace function public.impedir_borrado()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los datos no se borran: usá «Anular» o «Desactivar».' using errcode = '42501';
end;
$$;

do $$
declare
  t text;
  v_borrables text[] := array[
    'notificaciones', 'solicitudes_registro', 'checklist_precarga_vehiculo',
    'actividad_requisitos', 'certificado_clientes', 'certificado_contratos'];
  v_sin_auditoria text[] := array['auditoria', 'notificaciones', 'correos', 'strix_recorridos'];
begin
  for t in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    if not (t = any (v_sin_auditoria)) then
      execute format('drop trigger if exists registrar_auditoria on public.%I', t);
      if t = 'gerenciamientos' then
        execute format('create trigger registrar_auditoria after update or delete on public.%I
                          for each row execute function public.registrar_auditoria(%L)', t, 'strix\_%');
      else
        execute format('create trigger registrar_auditoria after update or delete on public.%I
                          for each row execute function public.registrar_auditoria()', t);
      end if;
    end if;

    if not (t = any (v_borrables)) then
      execute format('drop trigger if exists impedir_borrado on public.%I', t);
      execute format('drop trigger if exists impedir_vaciado on public.%I', t);
      execute format('create trigger impedir_borrado before delete on public.%I
                        for each row execute function public.impedir_borrado()', t);
      execute format('create trigger impedir_vaciado before truncate on public.%I
                        for each statement execute function public.impedir_borrado()', t);
      execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
    end if;
  end loop;
end;
$$;

-- Las funciones de borrado se reemplazan por las de anulación.
drop function if exists public.eliminar_checklist(bigint);
drop function if exists public.eliminar_gerenciamiento(bigint);
drop function if exists public.eliminar_observacion(bigint);
drop function if exists public.eliminar_parte_diario(uuid);
drop function if exists public.eliminar_documento_legajo(uuid);
drop function if exists public.eliminar_fila(text, text);
drop function if exists public.eliminar_recorrido_strix(bigint);
drop function if exists public.eliminar_vehiculo(uuid);

-- Storage: sin borrado de archivos.
drop policy if exists legajos_borrar on storage.objects;
drop policy if exists flota_borrar on storage.objects;
drop policy if exists certificados_admin on storage.objects;
drop policy if exists certificados_admin_leer on storage.objects;
drop policy if exists certificados_admin_subir on storage.objects;
create policy certificados_admin_leer on storage.objects for select to authenticated
  using (bucket_id = 'certificados' and public.es_admin_legajos());
create policy certificados_admin_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'certificados' and public.es_admin_legajos());

-- ---------------------------------------------------------------------------
-- 5. Funciones de anulación
-- ---------------------------------------------------------------------------
-- Valida el motivo y habilita la anulación dentro de la transacción actual.
create or replace function public.iniciar_anulacion(p_motivo text)
returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Escribí el motivo de la anulación (al menos 5 caracteres).';
  end if;
  perform set_config('lifting.anulando', 'si', true);
  return v_motivo;
end;
$$;
revoke all on function public.iniciar_anulacion(text) from public, anon, authenticated;

-- Parte diario: admin siempre; supervisor si no está firmado; el operador mientras no haya salido.
create or replace function public.anular_parte_diario(p_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_p public.partes_diarios%rowtype;
begin
  select * into v_p from public.partes_diarios where id = p_id for update;
  if not found then
    raise exception 'El parte no existe.';
  end if;
  if v_p.anulado_en is not null then
    raise exception 'El parte ya estaba anulado.';
  end if;
  if not (
    public.es_admin_legajos()
    or (public.es_gestor_legajos() and v_p.firmado_en is null)
    or (v_p.operador_id = v_yo and v_p.estado in ('Pendiente'::public.estado_parte, 'Excepcion'::public.estado_parte, 'Frenado'::public.estado_parte))
  ) then
    raise exception 'No podés anular este parte: ya salió o ya está firmado. Pedíselo a un administrador.' using errcode = '42501';
  end if;
  update public.partes_diarios
     set estado = 'Anulado'::public.estado_parte, anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
   where id = p_id;
  delete from public.notificaciones where enlace = format('/partes/%s', p_id);
end;
$$;

-- Gerenciamiento: supervisor / admin, o quien lo cargó mientras no esté autorizado.
create or replace function public.anular_gerenciamiento(p_id bigint, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_g public.gerenciamientos%rowtype;
begin
  select * into v_g from public.gerenciamientos where id = p_id for update;
  if not found then
    raise exception 'El gerenciamiento no existe.';
  end if;
  if v_g.anulado_en is not null then
    raise exception 'El gerenciamiento ya estaba anulado.';
  end if;
  if not public.es_gestor_legajos() and not (v_g.creado_por = v_yo and v_g.autorizacion = 'pendiente') then
    raise exception 'Solo podés anular tus gerenciamientos mientras no estén autorizados. Pedíselo a un supervisor.' using errcode = '42501';
  end if;
  update public.gerenciamientos
     set estado = 'anulado', anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
   where id = p_id;
end;
$$;

-- Checklist: supervisor / admin, o quien lo cargó. Nunca si habilitó un gerenciamiento vigente.
create or replace function public.anular_checklist(p_id bigint, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_c public.checklists%rowtype;
  v_g bigint;
begin
  select * into v_c from public.checklists where id = p_id for update;
  if not found then
    raise exception 'El checklist no existe.';
  end if;
  if v_c.anulado_en is not null then
    raise exception 'El checklist ya estaba anulado.';
  end if;
  if v_c.creado_por <> v_yo and not public.es_gestor_legajos() then
    raise exception 'Solo quien cargó el checklist o un supervisor puede anularlo.' using errcode = '42501';
  end if;
  select g.id into v_g from public.gerenciamientos g
   where g.checklist_id = p_id and g.anulado_en is null limit 1;
  if v_g is not null then
    raise exception 'Este checklist habilitó el gerenciamiento #%. Anulá primero el gerenciamiento.', v_g;
  end if;
  update public.checklists
     set anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
   where id = p_id;
  delete from public.notificaciones where enlace = format('/checklist/%s', p_id);
end;
$$;

-- Tarjeta de observación: supervisor / admin, o quien la cargó mientras esté abierta.
create or replace function public.anular_observacion(p_id bigint, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_o public.observaciones%rowtype;
begin
  select * into v_o from public.observaciones where id = p_id for update;
  if not found then
    raise exception 'La tarjeta no existe.';
  end if;
  if v_o.anulado_en is not null then
    raise exception 'La tarjeta ya estaba anulada.';
  end if;
  if not public.es_gestor_legajos() and not (v_o.creado_por = v_yo and v_o.estado = 'abierta') then
    raise exception 'Solo podés anular tus tarjetas mientras estén abiertas. Pedíselo a un supervisor.' using errcode = '42501';
  end if;
  update public.observaciones
     set estado = 'anulada', anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
   where id = p_id;
end;
$$;

-- Documento del legajo: supervisor / admin, o el operador mientras no esté aprobado.
create or replace function public.anular_documento_legajo(p_documento_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_doc public.documentos_legajo%rowtype;
begin
  select * into v_doc from public.documentos_legajo where id = p_documento_id for update;
  if not found then
    raise exception 'El documento no existe.';
  end if;
  if v_doc.anulado_en is not null then
    raise exception 'El documento ya estaba anulado.';
  end if;
  if not (public.es_gestor_legajos() or (v_doc.operador_id = v_yo and v_doc.estado <> 'aprobado')) then
    raise exception 'No tenés permiso para anular este documento.' using errcode = '42501';
  end if;
  update public.documentos_legajo
     set estado = 'anulado', anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
   where id = p_documento_id;
end;
$$;

-- Resto de los registros (solo administrador).
create or replace function public.anular_registro(p_tabla text, p_id text, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_motivo text := public.iniciar_anulacion(p_motivo);
  v_yo uuid := public.operador_actual_id();
  v_id text;
  v_r record;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede anular estos datos.' using errcode = '42501';
  end if;
  if p_tabla is null or p_tabla not in (
    'caja_gastos', 'cliente_historial', 'certificados_empresa', 'documentos_vehiculo',
    'certificaciones', 'strix_recorridos', 'strix_importaciones') then
    raise exception 'Tabla no permitida.';
  end if;

  execute format(
    'update public.%I t set anulado_en = now(), anulado_por = $1, motivo_anulacion = $2
      where t.id::text = $3 and t.anulado_en is null
      returning t.id::text', p_tabla)
    into v_id using v_yo, v_motivo, p_id;
  if v_id is null then
    raise exception 'El registro no existe o ya estaba anulado.';
  end if;

  -- Strix: anular una importación anula sus recorridos; después se recalculan los gerenciamientos.
  if p_tabla = 'strix_importaciones' then
    update public.strix_recorridos
       set anulado_en = now(), anulado_por = v_yo, motivo_anulacion = v_motivo
     where importacion_id = p_id::bigint and anulado_en is null;
  end if;
  if p_tabla in ('strix_recorridos', 'strix_importaciones') then
    for v_r in
      select sr.vehiculo_id, min(sr.inicio) as desde, max(sr.fin) as hasta
        from public.strix_recorridos sr
       where sr.vehiculo_id is not null
         and ((p_tabla = 'strix_recorridos' and sr.id = p_id::bigint)
           or (p_tabla = 'strix_importaciones' and sr.importacion_id = p_id::bigint))
       group by sr.vehiculo_id
    loop
      perform public.vincular_strix_vehiculo(v_r.vehiculo_id, v_r.desde, v_r.hasta);
    end loop;
  end if;
end;
$$;

revoke all on function public.anular_parte_diario(uuid, text) from public, anon;
revoke all on function public.anular_gerenciamiento(bigint, text) from public, anon;
revoke all on function public.anular_checklist(bigint, text) from public, anon;
revoke all on function public.anular_observacion(bigint, text) from public, anon;
revoke all on function public.anular_documento_legajo(uuid, text) from public, anon;
revoke all on function public.anular_registro(text, text, text) from public, anon;
grant execute on function public.anular_parte_diario(uuid, text) to authenticated;
grant execute on function public.anular_gerenciamiento(bigint, text) to authenticated;
grant execute on function public.anular_checklist(bigint, text) to authenticated;
grant execute on function public.anular_observacion(bigint, text) to authenticated;
grant execute on function public.anular_documento_legajo(uuid, text) to authenticated;
grant execute on function public.anular_registro(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Lo anulado o inactivo deja de contar en los cálculos
-- ---------------------------------------------------------------------------
-- Formulario genérico (clientes, contratos, certificaciones): las columnas de anulación no se editan a mano.
create or replace function public.columnas_tabla(p_tabla text)
returns table(columna text, tipo text, obligatoria boolean, opciones text[])
language sql
stable security definer
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
      and a.attname not in ('id', 'created_at', 'updated_at', 'anulado_en', 'anulado_por', 'motivo_anulacion')
      and public.es_admin_legajos()
    order by a.attnum;
$$;

create or replace function public.catalogo_partes_diarios()
returns table(tipo text, id uuid, nombre text, cliente_id uuid, vehiculo_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or public.rol_actual() is null then
    raise exception 'Se requiere una cuenta de operador activa.'
      using errcode = '42501';
  end if;

  return query
    select 'cliente'::text, c.id, c.razon_social, null::uuid, null::uuid
      from public.clientes c
      where c.activo
    union all
    select 'vehiculo'::text, v.id, v.dominio, null::uuid, null::uuid
      from public.vehiculos v
      where v.estado = 'Disponible'::public.estado_vehiculo
    union all
    select 'contrato'::text, co.id,
           concat_ws(' · ', co.modalidad::text, co.unidad_medida::text),
           co.cliente_id, co.vehiculo_id
      from public.contratos co
      where co.vigente;
end;
$$;

create or replace function public.checklist_para_salida(p_vehiculo_id uuid, p_salida timestamptz)
returns table(id bigint, creado_en timestamptz, apto boolean, usuario text, fallas text[])
language sql
stable security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.created_at, c.apto, c.usuario, c.fallas
    from public.checklists c
   where c.vehiculo_id = p_vehiculo_id
     and c.anulado_en is null
     and c.created_at >= p_salida - interval '24 hours'
   order by c.created_at desc
   limit 1;
$$;

create or replace function public.control_documental_parte(p_vehiculo_id uuid, p_operador_id uuid, out semaforo text, out vencidos text[])
returns record
language plpgsql
stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_hoy date := public.hoy_ar();
begin
  with docs(nombre, vence) as (
    select 'Vehículo: ' || t.nombre, max(d.vencimiento)
      from public.documentos_vehiculo d
      join public.tipos_documento t on t.id = d.tipo_documento_id
     where d.vehiculo_id = p_vehiculo_id and d.anulado_en is null and t.activo and d.vencimiento is not null
     group by t.nombre
    union all
    select 'Vehículo: seguro', v.venc_seguro
      from public.vehiculos v
     where v.id = p_vehiculo_id and v.venc_seguro is not null
    union all
    select 'Vehículo: patente', v.venc_patente
      from public.vehiculos v
     where v.id = p_vehiculo_id and v.venc_patente is not null
    union all
    select 'Operador: ' || t.nombre, max(d.vencimiento)
      from public.documentos_legajo d
      join public.tipos_documento t on t.id = d.tipo_documento_id
     where d.operador_id = p_operador_id and d.estado = 'aprobado' and t.activo and d.vencimiento is not null
     group by t.nombre
  )
  select case when count(*) = 0 then null
              when bool_or(docs.vence < v_hoy) then 'vencido'
              when bool_or(docs.vence <= v_hoy + 15) then 'por-vencer'
              else 'vigente' end,
         coalesce(
           array_agg(format('%s (venció el %s)', docs.nombre, to_char(docs.vence, 'DD/MM/YYYY')) order by docs.nombre)
             filter (where docs.vence < v_hoy),
           '{}'::text[])
    into semaforo, vencidos
    from docs;
end;
$$;

create or replace function public.documentos_checklist_de(p_vehiculo_id uuid, p_operador_id uuid)
returns table(clave text, nombre text, aplica_a text, condicionante boolean, admite_na boolean, con_clase boolean, tipo_id uuid, vencimiento date, clase text, estado text)
language sql
stable security definer
set search_path = pg_catalog, public
as $$
  with veh as (
    select v.id, v.tipo_flota, v.venc_seguro, v.venc_patente,
           coalesce((pv.datos ->> 'conSemi')::boolean, false) as con_semi
      from public.vehiculos v
      left join public.checklist_precarga_vehiculo pv on pv.vehiculo_id = v.id
     where v.id = p_vehiculo_id
  ), grupos as (
    select t.clave, t.aplica_a,
           string_agg(t.nombre, ' / ' order by t.nombre) as nombre,
           bool_or((case when veh.tipo_flota = 'Pesada' then t.checklist_pesada else t.checklist_liviana end) = 'condicionante') as condicionante,
           bool_or(t.admite_na) as admite_na,
           bool_or(t.con_clase) as con_clase,
           (array_agg(t.id order by t.nombre))[1] as tipo_id,
           array_agg(t.id) as tipo_ids
      from public.tipos_documento t
     cross join veh
     where t.activo and t.clave is not null
       and (case when veh.tipo_flota = 'Pesada' then t.checklist_pesada else t.checklist_liviana end) is not null
       and (not t.solo_semi or veh.con_semi)
     group by t.clave, t.aplica_a
  )
  select g.clave, g.nombre, g.aplica_a, g.condicionante, g.admite_na, g.con_clase, g.tipo_id,
         d.vencimiento, d.clase, d.estado
    from grupos g
   cross join veh
    left join lateral (
      select x.vencimiento, x.clase, x.estado
        from (
          select dl.vencimiento, dl.clase, dl.estado,
                 case dl.estado when 'aprobado' then 0 else 1 end as prioridad
            from public.documentos_legajo dl
           where g.aplica_a = 'operador' and dl.operador_id = p_operador_id
             and dl.tipo_documento_id = any (g.tipo_ids) and dl.estado not in ('rechazado', 'anulado')
          union all
          select dv.vencimiento, null, 'aprobado', 0
            from public.documentos_vehiculo dv
           where g.aplica_a = 'vehiculo' and dv.vehiculo_id = veh.id and dv.tipo_documento_id = any (g.tipo_ids)
             and dv.anulado_en is null
          union all
          select veh.venc_seguro, null, 'aprobado', 0 where g.clave = 'poliza' and veh.venc_seguro is not null
          union all
          select veh.venc_patente, null, 'aprobado', 0 where g.clave = 'patente' and veh.venc_patente is not null
        ) x
       order by x.prioridad, x.vencimiento desc nulls last
       limit 1
    ) d on true
   order by g.aplica_a desc, g.condicionante desc, g.nombre;
$$;

-- Strix: los recorridos anulados y los gerenciamientos anulados no se vinculan.
create or replace function public.strix_gerenciamiento_de_recorrido(r public.strix_recorridos)
returns bigint
language sql
stable security definer
set search_path = pg_catalog, public
as $$
  select g.id
    from public.gerenciamientos g
   where g.vehiculo_id = r.vehiculo_id
     and g.anulado_en is null
     and r.inicio < public.gerenciamiento_llegada(g) + public.strix_margen()
     and r.fin > public.gerenciamiento_salida(g) - public.strix_margen()
   order by public.strix_segundos_en(g, r.inicio, r.fin) desc,
            greatest(extract(epoch from public.gerenciamiento_salida(g) - r.fin),
                     extract(epoch from r.inicio - public.gerenciamiento_llegada(g)), 0),
            g.id
   limit 1
$$;

create or replace function public.strix_fraccion(r public.strix_recorridos, g public.gerenciamientos)
returns numeric
language plpgsql
stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_mio numeric;
  v_total numeric;
begin
  if r.vehiculo_id is null or g.vehiculo_id is distinct from r.vehiculo_id
     or r.anulado_en is not null or g.anulado_en is not null then
    return 0;
  end if;

  if r.granularidad = 'recorrido' then
    return case when public.strix_gerenciamiento_de_recorrido(r) = g.id then 1 else 0 end;
  end if;

  -- Día con recorridos detallados del mismo vehículo: se usan esos, no el total diario.
  if exists (
    select 1 from public.strix_recorridos t
     where t.vehiculo_id = r.vehiculo_id and t.granularidad = 'recorrido' and t.anulado_en is null
       and t.inicio < r.fin and t.fin > r.inicio
  ) then
    return 0;
  end if;

  v_mio := public.strix_segundos_en(g, r.inicio, r.fin);
  if v_mio = 0 then
    return 0;
  end if;
  -- El día se reparte entre los gerenciamientos del vehículo que lo cubren.
  select sum(public.strix_segundos_en(o, r.inicio, r.fin)) into v_total
    from public.gerenciamientos o
   where o.vehiculo_id = r.vehiculo_id
     and o.anulado_en is null
     and public.gerenciamiento_salida(o) < r.fin
     and public.gerenciamiento_llegada(o) > r.inicio;
  return v_mio / v_total;
end;
$$;

create or replace function public.strix_recorridos_periodo(p_desde date, p_hasta date)
returns table(id bigint, fuente text, granularidad text, dominio text, vehiculo_id uuid, fecha date, inicio timestamptz, fin timestamptz, km numeric, minutos_contacto numeric, minutos_marcha numeric, minutos_ralenti numeric, velocidad_maxima numeric, excesos integer, origen text, destino text, conductor text, observacion text, importacion_id bigint, actualizado_en timestamptz, gerenciamientos bigint[])
language sql
stable security definer
set search_path = pg_catalog, public, auth
as $$
  select sr.id, sr.fuente, sr.granularidad, sr.dominio, sr.vehiculo_id, sr.fecha, sr.inicio, sr.fin,
         sr.km, sr.minutos_contacto, sr.minutos_marcha, sr.minutos_ralenti, sr.velocidad_maxima, sr.excesos,
         sr.origen, sr.destino, sr.conductor, sr.observacion, sr.importacion_id, sr.actualizado_en,
         array(
           select g.id from public.gerenciamientos g
            where g.vehiculo_id = sr.vehiculo_id
              and g.anulado_en is null
              and public.gerenciamiento_salida(g) < sr.fin + public.strix_margen()
              and public.gerenciamiento_llegada(g) > sr.inicio - public.strix_margen()
              and public.strix_fraccion(sr, g) > 0
            order by g.id)
    from public.strix_recorridos sr
   where public.es_admin_legajos()
     and sr.anulado_en is null
     and sr.inicio >= public.inicio_dia_ar(p_desde)
     and sr.inicio < public.inicio_dia_ar(p_hasta + 1)
   order by sr.inicio desc, sr.dominio
   limit 3000
$$;

create or replace function public.vincular_strix_gerenciamiento(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.gerenciamientos g
     set strix_recorridos = r.cantidad,
         strix_km = r.km,
         strix_horas_marcha = r.minutos_marcha / 60,
         strix_horas_ralenti = r.minutos_ralenti / 60,
         strix_velocidad_maxima = r.velocidad_maxima,
         strix_excesos = r.excesos,
         strix_inicio = r.inicio,
         strix_fin = r.fin,
         strix_dias = r.dias,
         strix_compartidos = r.compartidos,
         strix_manuales = r.manuales,
         strix_vinculado_en = now()
    from (
      select gg.id,
             count(a.id)::integer as cantidad,
             sum(a.km * a.fraccion) as km,
             sum(a.minutos_marcha * a.fraccion) as minutos_marcha,
             sum(a.minutos_ralenti * a.fraccion) as minutos_ralenti,
             max(a.velocidad_maxima) as velocidad_maxima,
             round(sum(a.excesos * a.fraccion))::integer as excesos,
             min(a.inicio) as inicio,
             max(a.fin) as fin,
             (count(a.id) filter (where a.granularidad = 'dia'))::integer as dias,
             (count(a.id) filter (where a.fraccion < 1))::integer as compartidos,
             (count(a.id) filter (where a.fuente = 'manual'))::integer as manuales
        from public.gerenciamientos gg
        left join lateral (
          select sr.id, sr.km, sr.minutos_marcha, sr.minutos_ralenti, sr.velocidad_maxima, sr.excesos,
                 sr.inicio, sr.fin, sr.granularidad, sr.fuente, public.strix_fraccion(sr, gg) as fraccion
            from public.strix_recorridos sr
           where sr.vehiculo_id = gg.vehiculo_id
             and sr.anulado_en is null
             and sr.inicio < public.gerenciamiento_llegada(gg) + public.strix_margen()
             and sr.fin > public.gerenciamiento_salida(gg) - public.strix_margen()
        ) a on a.fraccion > 0
       where gg.id = p_id and gg.anulado_en is null
       group by gg.id
    ) r
   where g.id = r.id;
end;
$$;

-- Revincular no toca los recorridos anulados (si no, los "reviviría" como una carga nueva).
create or replace function public.revincular_recorridos_sin_vehiculo()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_cantidad integer;
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede hacer esto.' using errcode = '42501';
  end if;
  update public.strix_recorridos sr set dominio = sr.dominio
   where sr.vehiculo_id is null and sr.anulado_en is null;
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- Resumen del parte (detalle y PDF): sin los gerenciamientos anulados.
create or replace function public.resumen_parte(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_parte public.partes_diarios%rowtype;
  v_resultado jsonb;
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select * into v_parte from public.partes_diarios p
   where p.id = p_id and (p.operador_id = public.operador_actual_id() or public.es_gestor_legajos());
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'riesgo', jsonb_build_object(
      'latitud', v_parte.latitud, 'longitud', v_parte.longitud, 'precision_m', v_parte.ubicacion_precision_m,
      'origen', v_parte.ubicacion_origen,
      'tramo', (select t.nombre from public.riesgo_tramos t where t.id = v_parte.riesgo_tramo_id),
      'equipo', (select e.nombre from public.riesgo_equipos e where e.id = v_parte.riesgo_equipo_id),
      'estado', v_parte.riesgo_estado, 'motivos', to_jsonb(v_parte.riesgo_motivos),
      'viento_kmh', v_parte.viento_kmh, 'rafaga_kmh', v_parte.rafaga_kmh,
      'nivel_riesgo', v_parte.nivel_riesgo, 'clima_momento', v_parte.clima_momento),
    'ats', v_parte.ats_texto,
    'conformidad_en', v_parte.conformidad_operador_en,
    'anulacion', case when v_parte.anulado_en is null then null else jsonb_build_object(
      'en', v_parte.anulado_en, 'por', public.nombre_operador(v_parte.anulado_por), 'motivo', v_parte.motivo_anulacion) end,
    'gerenciamientos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'fecha_salida', g.fecha_salida, 'hora_salida', left(g.hora_salida::text, 5),
               'fecha_llegada', g.fecha_llegada, 'hora_llegada', left(g.hora_llegada::text, 5),
               'origen', g.origen, 'destino', g.destino, 'distancia_km', g.distancia_km, 'conductor', g.conductor,
               'autorizacion', g.autorizacion, 'estado', g.estado, 'responsable', g.responsable,
               'strix_recorridos', g.strix_recorridos, 'strix_km', g.strix_km,
               'strix_horas_marcha', g.strix_horas_marcha, 'strix_horas_ralenti', g.strix_horas_ralenti,
               'strix_velocidad_maxima', g.strix_velocidad_maxima, 'strix_excesos', g.strix_excesos,
               'checklist_id', g.checklist_id, 'checklist_apto', c.apto, 'checklist_en', c.created_at,
               'checklist_usuario', c.usuario)
             order by g.fecha_salida, g.hora_salida)
        from public.gerenciamientos g
        left join public.checklists c on c.id = g.checklist_id
       where g.parte_id = p_id and g.anulado_en is null), '[]'::jsonb),
    'strix', (
      select jsonb_build_object(
               'vinculados', count(*) filter (where g.strix_vinculado_en is not null),
               'km', sum(g.strix_km), 'horas_marcha', sum(g.strix_horas_marcha),
               'horas_ralenti', sum(g.strix_horas_ralenti), 'velocidad_maxima', max(g.strix_velocidad_maxima),
               'excesos', sum(g.strix_excesos))
        from public.gerenciamientos g where g.parte_id = p_id and g.anulado_en is null))
    into v_resultado;
  return v_resultado;
end;
$$;
