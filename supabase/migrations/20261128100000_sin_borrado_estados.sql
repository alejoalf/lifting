-- Paso 1 de "sin borrado": estados nuevos.
-- Postgres no deja usar un valor de enum en la misma transacción en que se crea,
-- por eso va en una migración aparte, antes de 20261128100100_sin_borrado.sql.

alter type public.estado_parte add value if not exists 'Anulado';
alter type public.estado_vehiculo add value if not exists 'Baja';
