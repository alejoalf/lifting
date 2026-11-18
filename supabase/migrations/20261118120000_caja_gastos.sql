-- Caja y gastos: libro de ingresos y egresos de la empresa, con categoría,
-- circuito (formal / informal) y vínculo opcional a un vehículo, un cliente
-- o un proveedor. Reservado al administrador.
-- Requiere la migración 20261113190000_legajos_habilitaciones.
--
-- La tabla caja_gastos ya existía en la base. Esta migración completa las
-- columnas que falten sin tocar las existentes. Si alguna columna existente
-- tiene un tipo incompatible, la migración se detiene sin cambiar nada y el
-- mensaje dice cuál es.
begin;

create table if not exists public.caja_gastos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- ---------- Verificación de las columnas que ya existen ----------

do $$
declare
  r record;
  esperado text[];
begin
  for r in
    select a.attname::text as columna, t.oid, t.typname::text as tipo, t.typtype, t.typcategory
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_type t on t.oid = a.atttypid
     where a.attrelid = 'public.caja_gastos'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname in ('fecha', 'monto', 'tipo', 'categoria', 'circuito')
  loop
    if r.columna = 'fecha' and r.tipo not in ('date', 'timestamp', 'timestamptz') then
      raise exception 'caja_gastos.fecha es de tipo % y se esperaba una fecha.', r.tipo;
    elsif r.columna = 'monto' and r.typcategory <> 'N' then
      raise exception 'caja_gastos.monto es de tipo % y se esperaba un número.', r.tipo;
    elsif r.columna in ('tipo', 'categoria', 'circuito') then
      if r.typtype = 'e' then
        esperado := case r.columna
          when 'tipo' then array['Ingreso', 'Egreso']
          when 'circuito' then array['Formal', 'Informal']
          else array['Facturación', 'Combustible', 'Mantenimiento', 'Cuota Prendaria',
                     'Intereses Punitorios', 'Honorarios', 'Pago Subalquiler', 'Impuestos']
        end;
        if exists (
          select 1 from unnest(esperado) as opcion
           where opcion not in (select e.enumlabel from pg_catalog.pg_enum e where e.enumtypid = r.oid)
        ) then
          raise exception 'Las opciones de caja_gastos.% no coinciden con las esperadas (%).',
            r.columna, array_to_string(esperado, ', ');
        end if;
      elsif r.typcategory <> 'S' then
        raise exception 'caja_gastos.% es de tipo % y se esperaba texto.', r.columna, r.tipo;
      end if;
    end if;
  end loop;
end $$;

-- ---------- Columnas ----------
-- Si la columna ya existe se deja como está (incluidas sus restricciones).

alter table public.caja_gastos
  add column if not exists fecha date not null default current_date,
  add column if not exists tipo text check (tipo in ('Ingreso', 'Egreso')),
  add column if not exists categoria text check (categoria in (
    'Facturación', 'Combustible', 'Mantenimiento', 'Cuota Prendaria',
    'Intereses Punitorios', 'Honorarios', 'Pago Subalquiler', 'Impuestos')),
  add column if not exists monto numeric(14, 2) check (monto > 0),
  add column if not exists circuito text check (circuito in ('Formal', 'Informal')),
  add column if not exists concepto text,
  add column if not exists comprobante text,
  add column if not exists vehiculo_id uuid references public.vehiculos(id) on delete set null,
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null,
  add column if not exists creado_por uuid references public.operadores(id) default public.operador_actual_id(),
  add column if not exists created_at timestamptz not null default now();

-- El id de proveedores puede ser de cualquier tipo: la columna usa el mismo.
do $$
declare
  v_tipo text;
begin
  if to_regclass('public.proveedores') is null then
    raise exception 'No existe la tabla proveedores.';
  end if;
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
    into v_tipo
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.proveedores'::regclass and a.attname = 'id' and not a.attisdropped;
  if v_tipo is null then
    raise exception 'La tabla proveedores no tiene columna id.';
  end if;
  execute format(
    'alter table public.caja_gastos add column if not exists proveedor_id %s references public.proveedores(id) on delete set null',
    v_tipo);
end $$;

create index if not exists caja_gastos_fecha_idx on public.caja_gastos (fecha desc);
create index if not exists caja_gastos_vehiculo_idx on public.caja_gastos (vehiculo_id);
create index if not exists caja_gastos_cliente_idx on public.caja_gastos (cliente_id);
create index if not exists caja_gastos_proveedor_idx on public.caja_gastos (proveedor_id);

-- ---------- Permisos (RLS): solo Admin ----------
-- Proveedores: el administrador necesita leerlos para vincularlos a un movimiento.

alter table public.caja_gastos enable row level security;
revoke all on table public.caja_gastos from anon;
grant select, insert, update, delete on table public.caja_gastos to authenticated;
drop policy if exists caja_gastos_admin on public.caja_gastos;
create policy caja_gastos_admin on public.caja_gastos
  for all to authenticated
  using (public.es_admin_legajos()) with check (public.es_admin_legajos());

alter table public.proveedores enable row level security;
grant select on table public.proveedores to authenticated;
drop policy if exists proveedores_admin_lectura on public.proveedores;
create policy proveedores_admin_lectura on public.proveedores
  for select to authenticated
  using (public.es_admin_legajos());

commit;
