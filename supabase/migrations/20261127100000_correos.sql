-- Avisos por mail (especificación, Módulo A):
--   · Pedido de salida excepcional: mail a cada administrador (Titular) con enlaces firmados
--     [AUTORIZAR SALIDA EXCEPCIONAL] / [FRENAR UNIDAD]. Queda registrado quién resolvió.
--   · Operación en curso: mail a supervisores y administradores avisando que la unidad salió.
--
-- Cómo funciona: un trigger deja cada mail en la cola public.correos y le avisa a la Edge Function
-- "correos" (por pg_net), que lo arma y lo envía con Resend. Si la función no está configurada,
-- los mails quedan en la cola y se pueden reenviar después.
--
-- Configuración (una sola vez, ver supabase/functions/correos/index.ts):
--   select vault.create_secret('https://<proyecto>.supabase.co/functions/v1/correos', 'correos_url');
--   select vault.create_secret('<la misma clave que CORREOS_CLAVE>', 'correos_clave');

create extension if not exists pg_net;

-- 1. Cola de mails.
create table if not exists public.correos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('excepcion', 'en_curso')),
  parte_id uuid references public.partes_diarios(id) on delete cascade,
  operador_id uuid references public.operadores(id) on delete set null,
  para text not null,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz,
  intentos integer not null default 0,
  error text
);

create index if not exists correos_pendientes_idx on public.correos (creado_en) where enviado_en is null;
create index if not exists correos_parte_idx on public.correos (parte_id);

-- Solo la usan la base y la Edge Function (con la clave de servicio).
alter table public.correos enable row level security;
revoke all on public.correos from anon, authenticated;

-- Avisa a la Edge Function que hay un mail para enviar. Sin configuración, el mail queda en cola.
create or replace function public.correos_avisar()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_url text;
  v_clave text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'correos_url';
  select decrypted_secret into v_clave from vault.decrypted_secrets where name = 'correos_clave';
  if v_url is null or v_clave is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-clave-correos', v_clave),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  -- Un problema con el aviso nunca frena la operación: el mail queda pendiente.
  raise warning 'No se pudo avisar a la función de correos: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists correos_avisar on public.correos;
create trigger correos_avisar after insert on public.correos
  for each row execute function public.correos_avisar();

-- 2. Mails según el estado del parte.
create or replace function public.partes_encolar_correos()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if new.estado = 'Excepcion'::public.estado_parte and old.estado is distinct from 'Excepcion'::public.estado_parte then
    -- Un mail por administrador: cada uno recibe sus propios enlaces firmados.
    insert into public.correos (tipo, parte_id, operador_id, para)
    select 'excepcion', new.id, op.id, btrim(op.email)
      from public.operadores op
     where op.activo and op.rol = 'Admin'::public.rol_operador and nullif(btrim(op.email), '') is not null;
  elsif new.estado = 'En Curso'::public.estado_parte and old.estado is distinct from 'En Curso'::public.estado_parte then
    insert into public.correos (tipo, parte_id, operador_id, para)
    select 'en_curso', new.id, op.id, btrim(op.email)
      from public.operadores op
     where op.activo
       and op.rol in ('Admin'::public.rol_operador, 'Supervisor'::public.rol_operador)
       and nullif(btrim(op.email), '') is not null;
  end if;
  return null;
end;
$$;

drop trigger if exists partes_encolar_correos on public.partes_diarios;
create trigger partes_encolar_correos after update of estado on public.partes_diarios
  for each row execute function public.partes_encolar_correos();

-- 3. Resolver la excepción: misma lógica desde la app o desde el enlace del mail.
create or replace function public.resolver_excepcion_interna(p_id uuid, p_autorizar boolean, p_motivo text, p_yo uuid, p_medio text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_parte public.partes_diarios%rowtype;
begin
  if p_autorizar is null then
    raise exception 'Indicá si se autoriza o se frena la salida.';
  end if;
  if not p_autorizar and nullif(btrim(p_motivo), '') is null then
    raise exception 'Indicá el motivo por el que se frena la salida.';
  end if;

  select * into v_parte from public.partes_diarios where id = p_id for update;
  if not found or v_parte.estado <> 'Excepcion'::public.estado_parte then
    raise exception 'El parte no existe o ya no tiene una excepción pendiente.';
  end if;

  update public.partes_diarios p
     set estado = case when p_autorizar then 'En Curso'::public.estado_parte else 'Frenado'::public.estado_parte end,
         autorizado_por = p_yo,
         autorizado_en = now(),
         salida_en = case when p_autorizar then now() end,
         motivo_freno = case when p_autorizar then null else btrim(p_motivo) end
   where p.id = p_id;

  perform public.notificar_operador(
    v_parte.operador_id,
    format('Parte N° %s: salida %s', v_parte.nro_parte, case when p_autorizar then 'autorizada' else 'frenada' end),
    case when p_autorizar
      then format('%s autorizó la salida excepcional del parte N° %s%s.', public.nombre_operador(p_yo), v_parte.nro_parte, p_medio)
      else format('%s frenó la salida del parte N° %s%s: %s', public.nombre_operador(p_yo), v_parte.nro_parte, p_medio, btrim(p_motivo)) end,
    format('/partes/%s', p_id));
end;
$$;

revoke all on function public.resolver_excepcion_interna(uuid, boolean, text, uuid, text) from public, anon, authenticated;

create or replace function public.resolver_excepcion_parte(p_id uuid, p_autorizar boolean, p_motivo text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.es_admin_legajos() then
    raise exception 'Solo un administrador puede autorizar o frenar una salida excepcional.' using errcode = '42501';
  end if;
  perform public.resolver_excepcion_interna(p_id, p_autorizar, p_motivo, public.operador_actual_id(), '');
end;
$$;

-- Desde el enlace del mail: solo la Edge Function (clave de servicio), que ya verificó la firma del enlace.
create or replace function public.resolver_excepcion_por_enlace(p_id uuid, p_autorizar boolean, p_motivo text, p_operador_id uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_parte public.partes_diarios%rowtype;
begin
  if not exists (
    select 1 from public.operadores op
     where op.id = p_operador_id and op.activo and op.rol = 'Admin'::public.rol_operador
  ) then
    raise exception 'El enlace ya no es válido: la persona no es administradora activa.';
  end if;
  select * into v_parte from public.partes_diarios where id = p_id;
  if not found then
    raise exception 'El parte ya no existe.';
  end if;
  if v_parte.estado <> 'Excepcion'::public.estado_parte then
    return format('El parte N° %s ya estaba resuelto (%s).', v_parte.nro_parte, v_parte.estado::text);
  end if;
  perform public.resolver_excepcion_interna(p_id, p_autorizar, p_motivo, p_operador_id, ' (desde el mail)');
  return format('Parte N° %s: salida %s.', v_parte.nro_parte, case when p_autorizar then 'autorizada' else 'frenada' end);
end;
$$;

revoke all on function public.resolver_excepcion_por_enlace(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.resolver_excepcion_por_enlace(uuid, boolean, text, uuid) to service_role;

-- 4. Datos para armar el mail (solo la Edge Function).
create or replace function public.datos_correo(p_id bigint)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', c.id, 'tipo', c.tipo, 'para', c.para, 'operador_id', c.operador_id, 'enviado_en', c.enviado_en,
    'destinatario', public.nombre_operador(c.operador_id),
    'parte', jsonb_build_object(
      'id', p.id, 'numero', p.nro_parte, 'estado', p.estado, 'fecha', p.fecha,
      'operador', public.nombre_operador(p.operador_id),
      'vehiculo', v.dominio, 'tarea', p.tipo_tarea, 'origen', p.origen, 'destino', p.destino,
      'cliente', cl.razon_social, 'motivos', to_jsonb(p.documentos_vencidos),
      'riesgo_estado', p.riesgo_estado, 'viento_kmh', p.viento_kmh, 'rafaga_kmh', p.rafaga_kmh,
      'salida_en', p.salida_en, 'autorizado_por', public.nombre_operador(p.autorizado_por)))
    from public.correos c
    join public.partes_diarios p on p.id = c.parte_id
    join public.vehiculos v on v.id = p.vehiculo_id
    join public.clientes cl on cl.id = p.cliente_id
   where c.id = p_id;
$$;

revoke all on function public.datos_correo(bigint) from public, anon, authenticated;
grant execute on function public.datos_correo(bigint) to service_role;

create or replace function public.sumar_intento_correo(p_id bigint)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$ update public.correos set intentos = intentos + 1 where id = p_id $$;

revoke all on function public.sumar_intento_correo(bigint) from public, anon, authenticated;
grant execute on function public.sumar_intento_correo(bigint) to service_role;
