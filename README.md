# Lifting Patagonia – App

React + TypeScript + Vite + Supabase.

## Arrancar
1. Crear `.env.local` en la raíz y copiar las variables de `.env.example`; completar URL y anon key de Supabase.
2. `npm install` y `npm run dev`
3. Tipos del esquema: editar `TU_PROJECT_ID` en package.json y correr `npm run types`.

## Perfil de acceso
El login consulta `operadores` por `auth_user_id` (UUID del usuario en Supabase
Authentication) y lee `nombre` y `rol`. El rol debe ser chofer,
hidrogrulero, supervisor o admin; también se acepta con mayúscula inicial.
Cada cuenta de Authentication debe tener una fila vinculada en `operadores`.

## Estructura
- `src/auth/` sesión + guardas por rol
- `src/pages/chofer|supervisor|admin/` pantallas por rol (hoy placeholders)
- La barrera de salida (documento vencido) se valida en servidor; el front solo la refleja.
