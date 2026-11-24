-- Limpieza de columnas de partes_diarios que no usa ninguna función ni pantalla.
-- (La tabla no tenía filas al momento de escribir esta migración.)
-- Se conservan km_reales_strix, ralenti_min y faltas_detectadas hasta definir la auditoría del parte contra Strix.

alter table public.partes_diarios
  drop column if exists token_hash,
  drop column if exists token_expira,
  drop column if exists firma_supervisor_path,
  drop column if exists perfil_informe,
  drop column if exists distancia_km,
  drop column if exists tiempo_min;

-- El tipo del perfil de informe quedaba solo para esa columna.
do $$ begin
  drop type if exists public.perfil_informe;
exception when dependent_objects_still_exist then
  raise notice 'perfil_informe sigue en uso: no se elimina.';
end $$;
