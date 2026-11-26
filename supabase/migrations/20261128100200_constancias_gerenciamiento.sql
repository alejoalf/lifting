-- Constancia de gerenciamiento: el documento que acredita qué trabajo se hizo y cómo.
--
--   * Se emite sola al CERRAR el gerenciamiento: una foto de todos sus datos (viaje, personas,
--     autorización, checklist, parte, cliente/contrato y Strix) que ya no cambia.
--   * Lleva un código de verificación SHA-256 del contenido: si alguien alterara un dato, no coincide.
--   * Nunca se modifica ni se borra. Si después el gerenciamiento se anula o se corrige su facturación,
--     se emite una VERSIÓN NUEVA y la anterior queda guardada.
--   * verificar_constancia(código) es pública: cualquiera con el PDF puede comprobar que es auténtico.
-- Requiere 20261128100100_sin_borrado.sql (columnas de anulación y auditoría).

create table if not exists public.constancias_gerenciamiento (
  id bigint generated always as identity primary key,
  gerenciamiento_id bigint not null references public.gerenciamientos(id),
  version integer not null,
  motivo text not null check (motivo in ('emision_inicial', 'cierre', 'anulacion', 'correccion')),
  contenido jsonb not null,
  hash text not null unique,
  emitida_en timestamptz not null default now(),
  emitida_por uuid references public.operadores(id),
  unique (gerenciamiento_id, version)
);

alter table public.constancias_gerenciamiento enable row level security;
revoke all on public.constancias_gerenciamiento from public, anon, authenticated;
grant select on public.constancias_gerenciamiento to authenticated;
drop policy if exists constancias_leer on public.constancias_gerenciamiento;
create policy constancias_leer on public.constancias_gerenciamiento for select to authenticated
  using (
    public.es_gestor_legajos()
    or exists (select 1 from public.gerenciamientos g
                where g.id = gerenciamiento_id and g.creado_por = public.operador_actual_id())
  );

-- Inmutable: ni se edita ni se borra.
create or replace function public.constancia_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Las constancias emitidas no se modifican: se emite una versión nueva.' using errcode = '42501';
end;
$$;
drop trigger if exists constancia_inmutable on public.constancias_gerenciamiento;
create trigger constancia_inmutable before update or delete on public.constancias_gerenciamiento
  for each row execute function public.constancia_inmutable();
drop trigger if exists impedir_vaciado on public.constancias_gerenciamiento;
create trigger impedir_vaciado before truncate on public.constancias_gerenciamiento
  for each statement execute function public.impedir_borrado();

-- Contenido de la constancia: todo lo que hace falta para leerla sin consultar otras tablas.
create or replace function public.contenido_constancia(p_id bigint)
returns jsonb
language sql
stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'gerenciamiento', g.id,
    'estado', g.estado,
    'viaje', jsonb_build_object(
      'fecha_salida', g.fecha_salida, 'hora_salida', left(g.hora_salida::text, 5),
      'fecha_llegada', g.fecha_llegada, 'hora_llegada', left(g.hora_llegada::text, 5),
      'origen', g.origen, 'destino', g.destino, 'distancia_km', g.distancia_km, 'rutas', g.rutas,
      'motivo', g.motivo, 'linea', g.linea, 'telefono', g.telefono,
      'radioactivo', g.radioactivo, 'pasajeros', g.pasajeros),
    'personas', jsonb_build_object(
      'conductor', g.conductor, 'conductor2', g.conductor2,
      'cargado_por', g.creado_por_nombre, 'cargado_en', g.created_at,
      'autorizado_por', g.responsable, 'autorizado_en', g.autorizado_en,
      'cerrado_en', g.cerrado_en),
    'vehiculo', jsonb_build_object('dominio', coalesce(v.dominio::text, g.vehiculo), 'marca_modelo', v.marca_modelo, 'equipo', v.equipo),
    'cliente', case when c.id is null then null else jsonb_build_object('razon_social', c.razon_social, 'cuit', c.cuit) end,
    'contrato', case when co.id is null then null else jsonb_build_object('modalidad', co.modalidad, 'unidad_medida', co.unidad_medida) end,
    'checklist', case when ch.id is null then null else jsonb_build_object(
      'id', ch.id, 'realizado_en', ch.created_at, 'usuario', ch.usuario, 'apto', ch.apto, 'fallas', to_jsonb(ch.fallas)) end,
    'parte', case when p.id is null then null else jsonb_build_object(
      'numero', p.nro_parte, 'fecha', p.fecha, 'riesgo', p.riesgo_estado, 'nivel_riesgo', p.nivel_riesgo,
      'ats', p.ats_texto, 'conformidad_operador_en', p.conformidad_operador_en) end,
    'strix', case when g.strix_vinculado_en is null then null else jsonb_build_object(
      'recorridos', g.strix_recorridos, 'km', g.strix_km, 'horas_marcha', g.strix_horas_marcha,
      'horas_ralenti', g.strix_horas_ralenti, 'velocidad_maxima', g.strix_velocidad_maxima,
      'excesos', g.strix_excesos, 'calculado_en', g.strix_vinculado_en) end,
    'anulacion', case when g.anulado_en is null then null else jsonb_build_object(
      'en', g.anulado_en, 'por', public.nombre_operador(g.anulado_por), 'motivo', g.motivo_anulacion) end)
    from public.gerenciamientos g
    left join public.vehiculos v on v.id = g.vehiculo_id
    left join public.clientes c on c.id = g.cliente_id
    left join public.contratos co on co.id = g.contrato_id
    left join public.checklists ch on ch.id = g.checklist_id
    left join public.partes_diarios p on p.id = g.parte_id
   where g.id = p_id;
$$;

create or replace function public.hash_constancia(p_contenido jsonb, p_gerenciamiento bigint, p_version integer, p_emitida timestamptz)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  -- La emisión va en segundos desde 1970 (no como texto) para que el código no dependa de la zona horaria.
  select encode(sha256(convert_to(
    jsonb_build_object('g', p_gerenciamiento, 'v', p_version,
                       'emitida', extract(epoch from p_emitida)::bigint, 'contenido', p_contenido)::text,
    'UTF8')), 'hex');
$$;

create or replace function public.emitir_constancia(p_id bigint, p_motivo text)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_version integer;
  v_contenido jsonb := public.contenido_constancia(p_id);
  v_emitida timestamptz := date_trunc('second', now());
  v_nueva bigint;
begin
  if v_contenido is null then
    return null;
  end if;
  perform 1 from public.gerenciamientos where id = p_id for update;
  select coalesce(max(version), 0) + 1 into v_version
    from public.constancias_gerenciamiento where gerenciamiento_id = p_id;
  insert into public.constancias_gerenciamiento (gerenciamiento_id, version, motivo, contenido, hash, emitida_en, emitida_por)
  values (p_id, v_version, p_motivo, v_contenido,
          public.hash_constancia(v_contenido, p_id, v_version, v_emitida), v_emitida, public.operador_actual_id())
  returning id into v_nueva;
  return v_nueva;
end;
$$;
revoke all on function public.emitir_constancia(bigint, text) from public, anon, authenticated;
revoke all on function public.contenido_constancia(bigint) from public, anon, authenticated;

-- Cuándo se emite: al cerrar; y, si ya tenía constancia, al anularse o al corregir vehículo/cliente/contrato.
create or replace function public.gerenciamientos_constancia()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tiene boolean := exists (select 1 from public.constancias_gerenciamiento c where c.gerenciamiento_id = new.id);
begin
  if old.estado <> 'cerrado' and new.estado = 'cerrado' then
    perform public.emitir_constancia(new.id, 'cierre');
  elsif v_tiene and old.anulado_en is null and new.anulado_en is not null then
    perform public.emitir_constancia(new.id, 'anulacion');
  elsif v_tiene and new.estado = 'cerrado'
        and (old.vehiculo_id, old.cliente_id, old.contrato_id) is distinct from (new.vehiculo_id, new.cliente_id, new.contrato_id) then
    perform public.emitir_constancia(new.id, 'correccion');
  end if;
  return null;
end;
$$;
drop trigger if exists gerenciamientos_constancia on public.gerenciamientos;
create trigger gerenciamientos_constancia after update on public.gerenciamientos
  for each row execute function public.gerenciamientos_constancia();

-- Verificación pública (por ejemplo desde el enlace impreso en el PDF).
-- Devuelve lo mínimo para identificar el documento, si es la última versión y si el contenido está íntegro.
create or replace function public.verificar_constancia(p_hash text)
returns table(gerenciamiento bigint, version integer, emitida_en timestamptz, motivo text, vehiculo text,
              cliente text, fecha_salida date, ultima_version integer, integra boolean)
language sql
stable security definer
set search_path = pg_catalog, public
as $$
  select c.gerenciamiento_id, c.version, c.emitida_en, c.motivo,
         c.contenido #>> '{vehiculo,dominio}', c.contenido #>> '{cliente,razon_social}',
         (c.contenido #>> '{viaje,fecha_salida}')::date,
         (select max(x.version) from public.constancias_gerenciamiento x where x.gerenciamiento_id = c.gerenciamiento_id),
         c.hash = public.hash_constancia(c.contenido, c.gerenciamiento_id, c.version, c.emitida_en)
    from public.constancias_gerenciamiento c
   where c.hash = lower(btrim(p_hash));
$$;
revoke all on function public.verificar_constancia(text) from public;
grant execute on function public.verificar_constancia(text) to anon, authenticated;

-- Los gerenciamientos ya cerrados reciben su constancia inicial.
do $$
declare
  v_id bigint;
begin
  for v_id in
    select g.id from public.gerenciamientos g
     where g.estado = 'cerrado'
       and not exists (select 1 from public.constancias_gerenciamiento c where c.gerenciamiento_id = g.id)
     order by g.id
  loop
    perform public.emitir_constancia(v_id, 'emision_inicial');
  end loop;
end;
$$;
