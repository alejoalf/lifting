-- Documentos con una sola fuente y criterio de vencimiento único.
--   1. Un documento que vence hoy sigue vigente durante todo el día (parte, gerenciamiento y checklist).
--   2. Cada tipo de documento indica si lo pide el checklist (pesada / liviana) y si es condicionante.
--      Las licencias del conductor viven en su Legajo y los documentos del vehículo en Flota:
--      el checklist, el parte y el resto de las secciones leen de ahí.
--   3. DNI y N° de legajo pasan a la ficha del operador; la clase de la licencia, al documento.
--   4. Los datos precargados del conductor dejan de existir (los reemplaza el Legajo).
--      Los del vehículo (interno, marca, semi, neumáticos) siguen renovándose cada 6 meses.

-- 1. Vence hoy = vigente.
create or replace function public.control_documental_parte(p_vehiculo_id uuid, p_operador_id uuid, out semaforo text, out vencidos text[])
returns record
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_hoy date := public.hoy_ar();
begin
  with docs(nombre, vence) as (
    select 'Vehículo: ' || t.nombre, max(d.vencimiento)
      from public.documentos_vehiculo d
      join public.tipos_documento t on t.id = d.tipo_documento_id
     where d.vehiculo_id = p_vehiculo_id and t.activo and d.vencimiento is not null
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

-- 2. Qué documentos pide el checklist y con qué peso.
alter table public.tipos_documento
  add column if not exists clave text,
  add column if not exists checklist_pesada text,
  add column if not exists checklist_liviana text,
  add column if not exists solo_semi boolean not null default false,
  add column if not exists admite_na boolean not null default false,
  add column if not exists con_clase boolean not null default false;

do $$ begin
  alter table public.tipos_documento add constraint tipos_documento_checklist_valido check (
    (checklist_pesada is null or checklist_pesada in ('condicionante', 'informativo'))
    and (checklist_liviana is null or checklist_liviana in ('condicionante', 'informativo')));
exception when duplicate_object then null;
end $$;

comment on column public.tipos_documento.clave is
  'Agrupa tipos equivalentes para el checklist (ej. VTV provincial y VTV nacional cuentan como «vtv»).';

update public.tipos_documento set clave = 'licencia', checklist_pesada = 'condicionante', checklist_liviana = 'condicionante', con_clase = true
 where nombre = 'Licencia de conducir';
update public.tipos_documento set clave = 'manejo_defensivo', checklist_pesada = 'condicionante', checklist_liviana = 'condicionante', con_clase = true
 where nombre = 'Manejo defensivo';
update public.tipos_documento set clave = 'psicofisico', checklist_pesada = 'condicionante', checklist_liviana = 'informativo'
 where nombre = 'Psicofísico';
update public.tipos_documento set clave = 'poliza', checklist_pesada = 'condicionante', checklist_liviana = 'condicionante'
 where nombre = 'Seguro' and aplica_a = 'vehiculo';
update public.tipos_documento set clave = 'vtv', checklist_pesada = 'condicionante', checklist_liviana = 'condicionante'
 where nombre in ('VTV provincial', 'VTV nacional (RTO)');

insert into public.tipos_documento
  (nombre, aplica_a, requiere_vencimiento, activo, clave, checklist_pesada, checklist_liviana, solo_semi, admite_na, con_clase)
values
  ('Cédula verde / azul',                'operador', true, true, 'cedula',            'condicionante', 'condicionante', false, false, false),
  ('Cargas generales',                   'operador', true, true, 'cargas_generales',  'informativo',   null,            false, true,  false),
  ('Cargas peligrosas',                  'operador', true, true, 'cargas_peligrosas', 'condicionante', null,            false, true,  false),
  ('R.U.T.A.',                           'vehiculo', true, true, 'ruta',              'condicionante', null,            false, false, false),
  ('Comprobante pago de patente',        'vehiculo', true, true, 'patente',           'informativo',   'informativo',   false, false, false),
  ('Comprobante pago del seguro',        'vehiculo', true, true, 'pago_seguro',       'condicionante', 'condicionante', false, false, false),
  ('Extintor de cabina 1 kg',            'vehiculo', true, true, 'extintor_cabina',   'informativo',   'condicionante', false, false, false),
  ('Extintor de tractor 10 kg',          'vehiculo', true, true, 'extintor_tractor',  'condicionante', null,            false, false, false),
  ('Extintor de semi 10 kg',             'vehiculo', true, true, 'extintor_semi',     'condicionante', null,            true,  false, false),
  ('Ticket Card',                        'vehiculo', true, true, 'ticket_card',       'informativo',   'informativo',   false, false, false),
  ('VTV del semirremolque',              'vehiculo', true, true, 'semi_vtv',          'condicionante', null,            true,  false, false),
  ('Patente del semirremolque',          'vehiculo', true, true, 'semi_patente',      'informativo',   null,            true,  false, false),
  ('Póliza de seguro del semirremolque', 'vehiculo', true, true, 'semi_poliza',       'condicionante', null,            true,  false, false),
  ('Pago del seguro del semirremolque',  'vehiculo', true, true, 'semi_pago_seguro',  'condicionante', null,            true,  false, false)
on conflict (nombre) do update set
  clave = excluded.clave, checklist_pesada = excluded.checklist_pesada, checklist_liviana = excluded.checklist_liviana,
  solo_semi = excluded.solo_semi, admite_na = excluded.admite_na, con_clase = excluded.con_clase;

-- 3. Datos del conductor en su ficha y clase de la licencia en el documento.
alter table public.operadores
  add column if not exists dni text,
  add column if not exists nro_legajo text;

alter table public.documentos_legajo add column if not exists clase text;

create or replace function public.guardar_datos_conductor(p_dni text, p_nro_legajo text, p_operador_id uuid default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_destino uuid := coalesce(p_operador_id, v_yo);
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  if v_destino <> v_yo and not public.es_gestor_legajos() then
    raise exception 'Solo podés modificar tus propios datos.' using errcode = '42501';
  end if;
  if nullif(btrim(p_dni), '') is not null and btrim(p_dni) !~ '^[0-9.]{7,11}$' then
    raise exception 'El DNI no es válido: usá solo números.';
  end if;
  update public.operadores
     set dni = nullif(replace(btrim(p_dni), '.', ''), ''),
         nro_legajo = nullif(btrim(p_nro_legajo), '')
   where id = v_destino;
end;
$$;

revoke all on function public.guardar_datos_conductor(text, text, uuid) from public, anon;
grant execute on function public.guardar_datos_conductor(text, text, uuid) to authenticated;

-- DNI y legajo del operador actual (el chofer no lee la tabla operadores completa).
create or replace function public.mis_datos_conductor()
returns table (dni text, nro_legajo text)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select o.dni, o.nro_legajo from public.operadores o where o.id = public.operador_actual_id();
$$;

revoke all on function public.mis_datos_conductor() from public, anon;
grant execute on function public.mis_datos_conductor() to authenticated;

-- La edición de un documento del legajo también guarda la clase.
drop function if exists public.editar_documento_legajo(uuid, uuid, date, date, text, text);

create or replace function public.editar_documento_legajo(
  p_documento_id uuid, p_tipo_documento_id uuid, p_fecha_emision date, p_vencimiento date,
  p_archivo_path text, p_archivo_nombre text, p_clase text default null)
returns void
language plpgsql security definer
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
         clase = case when p_clase is null then clase else nullif(btrim(p_clase), '') end,
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

revoke all on function public.editar_documento_legajo(uuid, uuid, date, date, text, text, text) from public, anon;
grant execute on function public.editar_documento_legajo(uuid, uuid, date, date, text, text, text) to authenticated;

-- 4. Documentos que pide el checklist para un vehículo y un conductor, leídos de Legajo y Flota.
--    Del legajo cuentan los aprobados; un documento en revisión se informa pero no habilita.
create or replace function public.documentos_checklist_de(p_vehiculo_id uuid, p_operador_id uuid)
returns table (
  clave text, nombre text, aplica_a text, condicionante boolean, admite_na boolean, con_clase boolean,
  tipo_id uuid, vencimiento date, clase text, estado text
)
language sql stable security definer
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
             and dl.tipo_documento_id = any (g.tipo_ids) and dl.estado <> 'rechazado'
          union all
          select dv.vencimiento, null, 'aprobado', 0
            from public.documentos_vehiculo dv
           where g.aplica_a = 'vehiculo' and dv.vehiculo_id = veh.id and dv.tipo_documento_id = any (g.tipo_ids)
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

-- Solo la usan otras funciones: con un operador cualquiera mostraría documentos ajenos.
revoke all on function public.documentos_checklist_de(uuid, uuid) from public, anon, authenticated;

create or replace function public.documentos_checklist(p_vehiculo_id uuid)
returns table (
  clave text, nombre text, aplica_a text, condicionante boolean, admite_na boolean, con_clase boolean,
  tipo_id uuid, vencimiento date, clase text, estado text
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query select * from public.documentos_checklist_de(p_vehiculo_id, public.operador_actual_id());
end;
$$;

revoke all on function public.documentos_checklist(uuid) from public, anon;
grant execute on function public.documentos_checklist(uuid) to authenticated;

-- Avisa a los administradores que faltan documentos del vehículo en Flota.
create or replace function public.avisar_documentos_vehiculo(p_vehiculo_id uuid, p_faltantes text[])
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_dominio text;
begin
  if v_yo is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  select v.dominio::text into v_dominio from public.vehiculos v where v.id = p_vehiculo_id;
  if v_dominio is null then
    raise exception 'El vehículo no existe.';
  end if;
  insert into public.notificaciones (para, titulo, mensaje, enlace)
  select op.id,
         format('Documentos a cargar: %s', v_dominio),
         format('%s necesita hacer el checklist de %s y faltan o vencieron: %s.',
                public.nombre_operador(v_yo), v_dominio, array_to_string(p_faltantes[1:10], '; ')),
         format('/admin/flota/%s', p_vehiculo_id)
    from public.operadores op
   where op.activo and op.rol = 'Admin'::public.rol_operador and op.id is distinct from v_yo;
end;
$$;

revoke all on function public.avisar_documentos_vehiculo(uuid, text[]) from public, anon;
grant execute on function public.avisar_documentos_vehiculo(uuid, text[]) to authenticated;

-- 5. Checklist: documentos desde Legajo y Flota; ya no hay datos precargados del conductor.
create or replace function public.checklists_antes_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_hoy date := public.hoy_ar();
  v_veh record;
  v_pv record;
  v_docs jsonb;
  v_na text[];
  v_fallas text[] := '{}';
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar checklists.' using errcode = '42501';
  end if;
  new.usuario := public.nombre_operador(new.creado_por);
  new.conductor := new.usuario; -- el checklist lo hace y lo firma el propio conductor
  new.created_at := now();
  new.fecha := v_hoy;
  if new.datos is null or jsonb_typeof(new.datos) <> 'object' then new.datos := '{}'::jsonb; end if;
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    raise exception 'El checklist no tiene controles.';
  end if;

  if new.vehiculo_id is null then
    raise exception 'Elegí un vehículo de la flota.';
  end if;
  select v.dominio::text as dominio, v.tipo_flota into v_veh from public.vehiculos v where v.id = new.vehiculo_id;
  if not found then
    raise exception 'El vehículo elegido no existe.';
  end if;
  if v_veh.tipo_flota is null then
    raise exception 'El vehículo % no tiene tipo de flota (pesada o liviana). Pedile al administrador que lo complete en Flota.', v_veh.dominio;
  end if;
  new.vehiculo := v_veh.dominio;
  new.tipo_flota := v_veh.tipo_flota;

  -- Datos técnicos del vehículo confirmados en los últimos 6 meses.
  select * into v_pv from public.checklist_precarga_vehiculo where vehiculo_id = new.vehiculo_id;
  if not found or not public.precarga_vigente(v_pv.actualizado_en)
     or coalesce(v_pv.datos ->> 'tipoFlota', '') <> v_veh.tipo_flota::text then
    raise exception 'Los datos precargados del vehículo % no están vigentes (se renuevan cada 6 meses). Actualizalos antes de guardar.', v_veh.dominio;
  end if;

  -- Documentos marcados "No aplica" (solo los tipos que lo admiten).
  select coalesce(array_agg(x), '{}') into v_na
    from jsonb_array_elements_text(case when jsonb_typeof(new.datos -> 'docs_na') = 'array' then new.datos -> 'docs_na' else '[]'::jsonb end) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', d.clave, 'nombre', d.nombre, 'aplica_a', d.aplica_a, 'condicionante', d.condicionante,
           'vencimiento', d.vencimiento, 'clase', d.clase, 'estado', d.estado,
           'na', d.admite_na and d.clave = any (v_na))), '[]'::jsonb)
    into v_docs
    from public.documentos_checklist_de(new.vehiculo_id, new.creado_por) d;

  v_fallas := v_fallas || coalesce((
    select array_agg(format('Documentación: %s %s', d ->> 'nombre',
             case when d ->> 'estado' is null then '(falta cargar)'
                  when d ->> 'estado' <> 'aprobado' then '(en revisión)'
                  else format('(venció el %s)', to_char((d ->> 'vencimiento')::date, 'DD/MM/YYYY')) end))
      from jsonb_array_elements(v_docs) d
     where (d ->> 'condicionante')::boolean
       and not (d ->> 'na')::boolean
       and (d ->> 'estado' is null
            or d ->> 'estado' <> 'aprobado'
            or (d ->> 'vencimiento' is not null and (d ->> 'vencimiento')::date < v_hoy))), '{}');

  new.datos := (new.datos - 'docs_na' - 'precarga_conductor') || jsonb_build_object(
    'documentos', v_docs,
    'conductor', (select jsonb_build_object('dni', o.dni, 'nro_legajo', o.nro_legajo) from public.operadores o where o.id = new.creado_por),
    'precarga_vehiculo', (v_pv.datos - 'documentos') || jsonb_build_object('actualizado_en', v_pv.actualizado_en, 'actualizado_por', v_pv.actualizado_por_nombre));

  -- Controles: los condicionantes tienen que estar en Óptimo (o No aplica); cualquier "Mal" deja la unidad no apta.
  v_fallas := v_fallas || coalesce((
    select array_agg(e ->> 'item')
      from jsonb_array_elements(new.items) e
     where e ->> 'estado' = 'mal'
        or (coalesce((e ->> 'condicionante')::boolean, false) and coalesce(e ->> 'estado', '') not in ('optimo', 'bien', 'na'))), '{}');

  -- Neumáticos: presión informada, estado no malo y control de tuercas / soporte correcto.
  v_fallas := v_fallas || coalesce((
    select array_agg(format('Neumáticos %s: %s', n ->> 'eje', m.motivo))
      from jsonb_array_elements(case when jsonb_typeof(new.datos -> 'neumaticos') = 'array' then new.datos -> 'neumaticos' else '[]'::jsonb end) n
      cross join lateral (values
        (case when nullif(n ->> 'presion', '') is null then 'sin presión informada' end),
        (case when n ->> 'estado' = 'malo' then 'estado malo' end),
        (case when n ->> 'tuercas' = 'no' then 'ajuste de tuercas' end),
        (case when n ->> 'checkpoint' = 'no' then 'check point' end),
        (case when n ->> 'soporte' = 'no' then 'soporte' end)) m(motivo)
     where m.motivo is not null), '{}');

  new.fallas := v_fallas;
  new.apto := cardinality(v_fallas) = 0;
  return new;
end;
$$;

-- La precarga del vehículo ya no guarda documentos (están en Flota).
update public.checklist_precarga_vehiculo set datos = datos - 'documentos' where datos ? 'documentos';

-- 6. Los datos precargados del conductor se reemplazan por el Legajo.
drop function if exists public.guardar_precarga_conductor(jsonb, uuid);
drop function if exists public.borrar_precarga_conductor(uuid);
drop table if exists public.checklist_precarga_conductor;
