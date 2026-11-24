-- 1. "Suspender" de la matriz de riesgos: el parte pasa al circuito de excepción (Base autoriza o frena),
--    igual que con la documentación vencida. El motivo queda en la lista de motivos de la excepción.
-- 2. Conformidad del operador con el ATS antes de rodar (especificación, Módulo B).
-- 3. Gerenciamiento: el checklist apto tiene que ser de las 24 h previas a la SALIDA.
--    Un viaje que sale en más de 24 h se puede cargar; queda esperando el checklist y no se autoriza sin él.

-- 1. Control del parte: documentación vencida o matriz en "suspender" => excepción.
create or replace function public.aplicar_control_parte(p_parte_id uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_parte public.partes_diarios%rowtype;
  v_control record;
  v_estado public.estado_parte;
  v_dominio text;
  v_suspende boolean;
  v_motivos text[];
begin
  select * into v_parte from public.partes_diarios where id = p_parte_id for update;
  if not found then
    raise exception 'El parte no existe.';
  end if;

  select * into v_control from public.control_documental_parte(v_parte.vehiculo_id, v_parte.operador_id);
  v_suspende := v_parte.riesgo_estado = 'suspendido';
  v_motivos := v_control.vencidos
    || case when v_suspende
         then array[format('Matriz de riesgos: suspender (%s)',
                           coalesce(nullif(array_to_string(v_parte.riesgo_motivos, '; '), ''), 'condiciones fuera de límite'))]
         else '{}'::text[] end;
  v_estado := case when v_control.semaforo = 'vencido' or v_suspende
                   then 'Excepcion'::public.estado_parte
                   else 'En Curso'::public.estado_parte end;

  update public.partes_diarios p
     set estado = v_estado,
         semaforo = v_control.semaforo,
         documentos_vencidos = v_motivos,
         salida_en = case when v_estado = 'En Curso'::public.estado_parte then now() end
   where p.id = p_parte_id;

  -- Se avisa una sola vez, al pasar a excepción.
  if v_estado = 'Excepcion'::public.estado_parte and v_parte.estado <> 'Excepcion'::public.estado_parte then
    select v.dominio into v_dominio from public.vehiculos v where v.id = v_parte.vehiculo_id;
    perform public.notificar_gestores(
      format('Parte N° %s: pedido de salida excepcional', v_parte.nro_parte),
      format('%s quiere salir con %s y %s: %s.',
             public.nombre_operador(v_parte.operador_id), v_dominio,
             case when v_suspende and v_control.semaforo = 'vencido' then 'hay documentación vencida y la matriz indica suspender'
                  when v_suspende then 'la matriz de riesgos indica suspender'
                  else 'hay documentación vencida' end,
             array_to_string(v_motivos, '; ')),
      format('/partes/%s', p_parte_id));
  end if;

  return v_estado::text;
end;
$$;

-- 2. Crear parte: exige la conformidad con el ATS. El aviso de "suspender" ahora lo da la excepción.
create or replace function public.crear_parte_diario(
  p_cliente_id uuid,
  p_contrato_id uuid,
  p_vehiculo_id uuid,
  p_tipo_tarea public.tipo_tarea,
  p_origen text,
  p_destino text,
  p_km_inicial numeric,
  p_observaciones text,
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_precision numeric default null,
  p_tramo_id uuid default null,
  p_riesgo jsonb default null
)
returns table (parte_id uuid, numero bigint)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol public.rol_operador;
  v_operador_id uuid;
  v_dominio text;
  v_equipo_id uuid;
  v_requiere_riesgo boolean := p_tipo_tarea in ('Izaje Hidrogrua'::public.tipo_tarea, 'Altura Barquilla'::public.tipo_tarea);
  v_lat numeric;
  v_lon numeric;
  v_origen text;
  v_estado text;
  v_motivos text[] := '{}';
  v_viento numeric;
  v_rafaga numeric;
  v_momento timestamptz;
  v_ats text := left(nullif(btrim(p_riesgo ->> 'ats'), ''), 8000);
begin
  v_rol := public.rol_actual();
  if auth.uid() is null
     or v_rol is null
     or v_rol not in ('Chofer'::public.rol_operador, 'Hidrogrulero'::public.rol_operador) then
    raise exception 'Solo un chofer o hidrogrulero puede crear un parte.'
      using errcode = '42501';
  end if;

  select op.id into v_operador_id
    from public.operadores op
   where op.auth_user_id = auth.uid() and op.activo;
  if v_operador_id is null then
    raise exception 'La cuenta no está vinculada a un operador activo.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.partes_diarios p
     where p.operador_id = v_operador_id
       and p.estado in ('Pendiente'::public.estado_parte, 'Excepcion'::public.estado_parte, 'En Curso'::public.estado_parte)
  ) then
    raise exception 'Ya tenés un parte abierto. Cerralo antes de crear otro.';
  end if;

  if not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
    raise exception 'El cliente seleccionado ya no está disponible.';
  end if;

  select v.dominio::text, v.riesgo_equipo_id into v_dominio, v_equipo_id
    from public.vehiculos v
   where v.id = p_vehiculo_id and v.estado = 'Disponible'::public.estado_vehiculo;
  if not found then
    raise exception 'El vehículo seleccionado no está disponible.';
  end if;

  if p_contrato_id is not null and not exists (
    select 1 from public.contratos co
     where co.id = p_contrato_id and co.cliente_id = p_cliente_id
       and co.vehiculo_id = p_vehiculo_id and co.vigente
  ) then
    raise exception 'El contrato no corresponde al cliente y vehículo seleccionados o no está vigente.';
  end if;

  if nullif(btrim(p_origen), '') is null
     or nullif(btrim(p_destino), '') is null
     or p_km_inicial is null
     or p_km_inicial < 0 then
    raise exception 'Completá origen, destino y un kilometraje inicial válido.';
  end if;

  if p_tramo_id is not null then
    select t.latitud, t.longitud into v_lat, v_lon from public.riesgo_tramos t where t.id = p_tramo_id;
    if not found then
      raise exception 'El tramo elegido no existe.';
    end if;
    v_origen := 'tramo';
  elsif p_latitud is not null and p_longitud is not null then
    if p_latitud not between -90 and 90 or p_longitud not between -180 and 180 then
      raise exception 'La ubicación recibida no es válida.';
    end if;
    v_lat := round(p_latitud, 6);
    v_lon := round(p_longitud, 6);
    v_origen := 'gps';
  end if;

  if v_requiere_riesgo and v_origen is null then
    raise exception 'Para izaje o trabajo en altura indicá la ubicación: activá el GPS o elegí el tramo.';
  end if;

  -- El operador tiene que leer y aceptar el ATS antes de rodar.
  if v_ats is not null and coalesce((p_riesgo ->> 'conformidad')::boolean, false) is not true then
    raise exception 'Leé el análisis de riesgo (ATS) y confirmá tu conformidad antes de registrar el parte.';
  end if;

  if v_requiere_riesgo then
    if v_equipo_id is null then
      v_estado := 'sin-datos';
      v_motivos := array['El vehículo no tiene equipo vinculado en la matriz de riesgos'];
    elsif p_riesgo is null or coalesce(p_riesgo ->> 'estado', '') not in ('habilitado', 'precaucion', 'suspendido') then
      v_estado := 'sin-datos';
      v_motivos := array['No se pudo consultar el clima al abrir el parte'];
    else
      if (p_riesgo ->> 'equipo_id')::uuid is distinct from v_equipo_id then
        raise exception 'La evaluación de riesgo no corresponde al equipo del vehículo. Volvé a cargar la pantalla.';
      end if;
      v_estado := p_riesgo ->> 'estado';
      v_viento := least(greatest(round((p_riesgo ->> 'viento')::numeric, 1), 0), 9999);
      v_rafaga := least(greatest(round((p_riesgo ->> 'rafaga')::numeric, 1), 0), 9999);
      v_momento := to_timestamp((p_riesgo ->> 'momento')::numeric / 1000);
      select coalesce(array_agg(m), '{}') into v_motivos
        from jsonb_array_elements_text(case when jsonb_typeof(p_riesgo -> 'motivos') = 'array' then p_riesgo -> 'motivos' else '[]'::jsonb end) m;
    end if;
  end if;

  insert into public.partes_diarios (
    cliente_id, contrato_id, vehiculo_id, operador_id, tipo_tarea,
    origen, destino, km_inicial, observaciones, estado,
    latitud, longitud, ubicacion_precision_m, ubicacion_origen, riesgo_tramo_id,
    riesgo_equipo_id, riesgo_estado, riesgo_motivos, viento_kmh, rafaga_kmh, clima_momento, nivel_riesgo,
    ats_texto, conformidad_operador_en
  )
  values (
    p_cliente_id, p_contrato_id, p_vehiculo_id, v_operador_id, p_tipo_tarea,
    btrim(p_origen), btrim(p_destino), p_km_inicial,
    nullif(btrim(p_observaciones), ''), 'Pendiente'::public.estado_parte,
    v_lat, v_lon, case when v_origen = 'gps' then round(p_precision, 1) end, v_origen, p_tramo_id,
    case when v_requiere_riesgo then v_equipo_id end, v_estado, v_motivos, v_viento, v_rafaga, v_momento,
    case v_estado
      when 'habilitado' then 'Bajo'::public.nivel_riesgo
      when 'precaucion' then 'Medio'::public.nivel_riesgo
      when 'suspendido' then 'Suspender'::public.nivel_riesgo
    end,
    v_ats,
    case when v_ats is not null then now() end
  )
  returning id, nro_parte into parte_id, numero;

  -- Documentación vencida o "suspender" => excepción (avisa a Base y espera su respuesta).
  perform public.aplicar_control_parte(parte_id);

  return next;
end;
$$;

-- El resumen del parte informa la conformidad con el ATS.
create or replace function public.resumen_parte(p_id uuid)
returns jsonb
language plpgsql stable security definer
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
       where g.parte_id = p_id), '[]'::jsonb),
    'strix', (
      select jsonb_build_object(
               'vinculados', count(*) filter (where g.strix_vinculado_en is not null),
               'km', sum(g.strix_km), 'horas_marcha', sum(g.strix_horas_marcha),
               'horas_ralenti', sum(g.strix_horas_ralenti), 'velocidad_maxima', max(g.strix_velocidad_maxima),
               'excesos', sum(g.strix_excesos))
        from public.gerenciamientos g where g.parte_id = p_id))
    into v_resultado;
  return v_resultado;
end;
$$;

-- 3. Checklist válido para una salida: el último del vehículo hecho desde 24 h antes de la salida.
create or replace function public.checklist_para_salida(p_vehiculo_id uuid, p_salida timestamptz)
returns table (id bigint, creado_en timestamptz, apto boolean, usuario text, fallas text[])
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.created_at, c.apto, c.usuario, c.fallas
    from public.checklists c
   where c.vehiculo_id = p_vehiculo_id
     and c.created_at >= p_salida - interval '24 hours'
   order by c.created_at desc
   limit 1;
$$;

revoke all on function public.checklist_para_salida(uuid, timestamptz) from public, anon, authenticated;

-- La pantalla de gerenciamiento consulta el checklist para la salida elegida (sin salida = ahora).
drop function if exists public.estado_checklist_vehiculo(uuid);

create or replace function public.estado_checklist_vehiculo(p_vehiculo_id uuid, p_salida timestamptz default null)
returns table (id bigint, creado_en timestamptz, apto boolean, usuario text, fallas text[])
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if public.operador_actual_id() is null then
    raise exception 'Tu usuario no está habilitado.' using errcode = '42501';
  end if;
  return query select * from public.checklist_para_salida(p_vehiculo_id, coalesce(p_salida, now()));
end;
$$;

revoke all on function public.estado_checklist_vehiculo(uuid, timestamptz) from public, anon;
grant execute on function public.estado_checklist_vehiculo(uuid, timestamptz) to authenticated;

-- Valida el checklist de un gerenciamiento y devuelve su id (error si no hay o no es apto).
create or replace function public.validar_checklist_gerenciamiento(p_vehiculo_id uuid, p_salida timestamptz)
returns bigint
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_check record;
begin
  select * into v_check from public.checklist_para_salida(p_vehiculo_id, p_salida);
  if not found then
    raise exception 'El vehículo no tiene checklist dentro de las 24 h previas a la salida (desde el % hs). Completá el checklist vehicular.',
      to_char((p_salida - interval '24 hours') at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI');
  end if;
  if not v_check.apto then
    raise exception 'El último checklist del vehículo (#%) lo marcó como NO APTO. Resolvé las fallas y hacé un checklist nuevo.', v_check.id;
  end if;
  return v_check.id;
end;
$$;

revoke all on function public.validar_checklist_gerenciamiento(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.gerenciamientos_antes_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_validacion record;
  v_salida timestamptz;
begin
  new.creado_por := public.operador_actual_id();
  if new.creado_por is null then
    raise exception 'Tu usuario no está habilitado para cargar gerenciamientos.' using errcode = '42501';
  end if;
  new.creado_por_nombre := public.nombre_operador(new.creado_por);
  new.created_at := now();
  new.autorizacion := 'pendiente';
  new.autorizado_por := null;
  new.responsable := null;
  new.autorizado_en := null;
  new.estado := 'abierto';
  new.cerrado_en := null;

  -- Condición de inicio: checklist apto dentro de las 24 h previas a la salida.
  -- Si la salida es en más de 24 h todavía no se puede hacer: el viaje queda esperando el checklist.
  if new.vehiculo_id is null then
    raise exception 'Elegí un vehículo de la flota: el gerenciamiento necesita su checklist vehicular.';
  end if;
  v_salida := (new.fecha_salida + new.hora_salida) at time zone 'America/Argentina/Buenos_Aires';
  if v_salida <= now() + interval '24 hours' then
    new.checklist_id := public.validar_checklist_gerenciamiento(new.vehiculo_id, v_salida);
  else
    new.checklist_id := null;
  end if;

  -- Parte diario: el indicado (si es del mismo vehículo y está en curso) o el parte en curso del vehículo.
  if new.parte_id is not null and not exists (
    select 1 from public.partes_diarios p
     where p.id = new.parte_id and p.vehiculo_id = new.vehiculo_id and p.estado = 'En Curso'::public.estado_parte
  ) then
    raise exception 'El parte elegido no está en curso o es de otro vehículo.';
  end if;
  if new.parte_id is null then
    select p.id into new.parte_id
      from public.partes_diarios p
     where p.vehiculo_id = new.vehiculo_id and p.estado = 'En Curso'::public.estado_parte
     order by p.created_at desc
     limit 1;
  end if;

  select * into v_validacion
    from public.validar_facturacion_gerenciamiento(new.vehiculo_id, new.cliente_id, new.contrato_id);
  new.cliente_id := v_validacion.p_cliente_id;
  if v_validacion.p_dominio is not null then
    new.vehiculo := v_validacion.p_dominio;
  end if;

  -- Los datos de Strix solo los completa vincular_strix().
  new.strix_recorridos := null;
  new.strix_km := null;
  new.strix_horas_marcha := null;
  new.strix_horas_ralenti := null;
  new.strix_velocidad_maxima := null;
  new.strix_excesos := null;
  new.strix_inicio := null;
  new.strix_fin := null;
  new.strix_vinculado_en := null;
  return new;
end;
$$;

-- Autorizar exige el checklist apto de las 24 h previas a la salida (y lo deja vinculado).
create or replace function public.autorizar_gerenciamiento(p_id bigint)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_yo uuid := public.operador_actual_id();
  v_nombre text := public.nombre_operador(v_yo);
  v_g public.gerenciamientos%rowtype;
  v_salida timestamptz;
  v_checklist bigint;
begin
  if not public.es_gestor_legajos() then
    raise exception 'Solo un supervisor o administrador puede autorizar viajes.' using errcode = '42501';
  end if;
  select * into v_g from public.gerenciamientos where id = p_id for update;
  if not found or v_g.autorizacion <> 'pendiente' then
    raise exception 'El gerenciamiento no existe o ya estaba autorizado.';
  end if;

  v_salida := (v_g.fecha_salida + v_g.hora_salida) at time zone 'America/Argentina/Buenos_Aires';
  if v_salida > now() + interval '24 hours' then
    raise exception 'Todavía no se puede autorizar: el checklist se hace dentro de las 24 h previas a la salida (desde el % hs).',
      to_char((v_salida - interval '24 hours') at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI');
  end if;
  v_checklist := public.validar_checklist_gerenciamiento(v_g.vehiculo_id, v_salida);

  update public.gerenciamientos g
     set autorizacion = 'autorizado', autorizado_por = v_yo, responsable = v_nombre, autorizado_en = now(),
         checklist_id = v_checklist
   where g.id = p_id;

  if v_g.creado_por is distinct from v_yo then
    perform public.notificar_operador(v_g.creado_por,
      format('Gerenciamiento #%s aprobado', p_id),
      format('%s ha aprobado el gerenciamiento #%s.', v_nombre, p_id),
      '/gerenciamientos');
  end if;
end;
$$;

-- Un checklist nuevo queda vinculado a los viajes pendientes del vehículo que salen dentro de las 24 h siguientes.
create or replace function public.checklists_despues_de_crear()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  update public.gerenciamientos g
     set checklist_id = new.id
   where g.vehiculo_id = new.vehiculo_id
     and g.autorizacion = 'pendiente'
     and g.estado = 'abierto'
     and (g.fecha_salida + g.hora_salida) at time zone 'America/Argentina/Buenos_Aires'
         between new.created_at and new.created_at + interval '24 hours';

  if not new.apto then
    perform public.notificar_gestores(
      format('Checklist #%s: unidad no apta', new.id),
      format('%s marcó la unidad %s como no apta (%s).', new.usuario, new.vehiculo,
             array_to_string(new.fallas[1:3], '; ') || case when cardinality(new.fallas) > 3 then format(' y %s más', cardinality(new.fallas) - 3) else '' end),
      format('/checklist/%s', new.id));
  end if;
  return null;
end;
$$;

-- Borrar checklist: solo se impide si habilitó un gerenciamiento ya autorizado.
-- Los viajes pendientes que lo tenían vinculado quedan sin checklist y se vuelven a validar al autorizar.
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
  select g.id into v_g from public.gerenciamientos g where g.checklist_id = p_id and g.autorizacion = 'autorizado' limit 1;
  if v_g is not null then
    raise exception 'Este checklist habilitó el gerenciamiento autorizado #%. Borrá primero el gerenciamiento.', v_g;
  end if;
  delete from public.checklists where id = p_id;
  delete from public.notificaciones where enlace = format('/checklist/%s', p_id);
end;
$$;
