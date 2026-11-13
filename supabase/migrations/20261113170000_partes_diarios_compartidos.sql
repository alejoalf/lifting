begin;

create unique index if not exists partes_diarios_nro_parte_uidx
  on public.partes_diarios (nro_parte);

alter table public.partes_diarios
  add column if not exists km_inicial numeric not null check (km_inicial >= 0),
  add column if not exists km_final numeric check (km_final >= 0),
  add column if not exists observaciones text,
  add column if not exists trabajo_realizado text,
  add column if not exists salida_en timestamptz,
  add column if not exists cerrado_en timestamptz,
  add column if not exists firmado_por uuid references public.operadores(id),
  add column if not exists firmado_en timestamptz,
  add column if not exists motivo_freno text;

revoke all on table public.partes_diarios from anon, authenticated;

create or replace function public.catalogo_partes_diarios()
returns table (
  tipo text,
  id uuid,
  nombre text,
  cliente_id uuid,
  vehiculo_id uuid
)
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

create or replace function public.listar_partes_diarios()
returns table (
  id uuid,
  nro_parte bigint,
  auth_user_id uuid,
  operador text,
  creado_en timestamptz,
  fecha date,
  cliente text,
  contrato text,
  vehiculo text,
  tarea text,
  origen text,
  destino text,
  km_inicial numeric,
  km_final numeric,
  km_declarados numeric,
  observaciones text,
  estado text,
  resuelto_por text,
  resuelto_en timestamptz,
  motivo_freno text,
  salida_en timestamptz,
  cerrado_en timestamptz,
  horas_declaradas numeric,
  trabajo_realizado text,
  firmado_por text,
  firmado_en timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol public.rol_operador;
begin
  v_rol := public.rol_actual();
  if auth.uid() is null or v_rol is null then
    raise exception 'Se requiere una cuenta de operador activa.'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.nro_parte, op.auth_user_id, op.nombre, p.created_at, p.fecha,
           c.razon_social,
           case when co.id is null then null
             else concat_ws(' · ', co.modalidad::text, co.unidad_medida::text)
           end,
           v.dominio, p.tipo_tarea::text, p.origen, p.destino,
           p.km_inicial, p.km_final, p.km_declarados, p.observaciones,
           p.estado::text, autorizado.nombre, p.autorizado_en, p.motivo_freno,
           p.salida_en, p.cerrado_en, p.horas_declaradas, p.trabajo_realizado,
           firmante.nombre, p.firmado_en
      from public.partes_diarios p
      join public.operadores op on op.id = p.operador_id
      join public.clientes c on c.id = p.cliente_id
      join public.vehiculos v on v.id = p.vehiculo_id
      left join public.contratos co on co.id = p.contrato_id
      left join public.operadores autorizado on autorizado.id = p.autorizado_por
      left join public.operadores firmante on firmante.id = p.firmado_por
      where v_rol in ('Supervisor'::public.rol_operador, 'Admin'::public.rol_operador)
         or op.auth_user_id = auth.uid()
      order by p.created_at desc;
end;
$$;

create or replace function public.crear_parte_diario(
  p_cliente_id uuid,
  p_contrato_id uuid,
  p_vehiculo_id uuid,
  p_tipo_tarea public.tipo_tarea,
  p_origen text,
  p_destino text,
  p_km_inicial numeric,
  p_observaciones text
)
returns table (parte_id uuid, numero bigint)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol public.rol_operador;
  v_operador_id uuid;
begin
  v_rol := public.rol_actual();
  if auth.uid() is null
     or v_rol is null
     or v_rol not in ('Chofer'::public.rol_operador, 'Hidrogrulero'::public.rol_operador) then
    raise exception 'Solo un chofer o hidrogrulero puede crear un parte.'
      using errcode = '42501';
  end if;

  select op.id
    into v_operador_id
    from public.operadores op
    where op.auth_user_id = auth.uid() and op.activo;

  if v_operador_id is null then
    raise exception 'La cuenta no está vinculada a un operador activo.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
    raise exception 'El cliente seleccionado ya no está disponible.';
  end if;

  if not exists (
    select 1 from public.vehiculos v
    where v.id = p_vehiculo_id and v.estado = 'Disponible'::public.estado_vehiculo
  ) then
    raise exception 'El vehículo seleccionado no está disponible.';
  end if;

  if p_contrato_id is not null and not exists (
    select 1
      from public.contratos co
      where co.id = p_contrato_id
        and co.cliente_id = p_cliente_id
        and co.vehiculo_id = p_vehiculo_id
        and co.vigente
  ) then
    raise exception 'El contrato no corresponde al cliente y vehículo seleccionados o no está vigente.';
  end if;

  if nullif(btrim(p_origen), '') is null
     or nullif(btrim(p_destino), '') is null
     or p_km_inicial is null
     or p_km_inicial < 0 then
    raise exception 'Completá origen, destino y un kilometraje inicial válido.';
  end if;

  insert into public.partes_diarios (
    cliente_id, contrato_id, vehiculo_id, operador_id, tipo_tarea,
    origen, destino, km_inicial, observaciones, estado
  )
  values (
    p_cliente_id, p_contrato_id, p_vehiculo_id, v_operador_id, p_tipo_tarea,
    btrim(p_origen), btrim(p_destino), p_km_inicial,
    nullif(btrim(p_observaciones), ''), 'Pendiente'::public.estado_parte
  )
  returning id, nro_parte into parte_id, numero;

  return next;
end;
$$;

revoke all on function public.catalogo_partes_diarios() from public, anon;
revoke all on function public.listar_partes_diarios() from public, anon;
revoke all on function public.crear_parte_diario(uuid, uuid, uuid, public.tipo_tarea, text, text, numeric, text) from public, anon;
grant execute on function public.catalogo_partes_diarios() to authenticated;
grant execute on function public.listar_partes_diarios() to authenticated;
grant execute on function public.crear_parte_diario(uuid, uuid, uuid, public.tipo_tarea, text, text, numeric, text) to authenticated;

commit;
