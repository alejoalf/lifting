# Plan de trabajo — Lifting Patagonia

Guía para continuar el desarrollo de forma ordenada. La interfaz de referencia
sirve como inspiración para la navegación y la organización; no se busca copiar
su marca, textos ni diseño exacto.

## 1. Preparar el entorno

1. Clonar el repositorio y crear una rama propia para cada etapa o tarea.
2. Instalar dependencias:

   ```powershell
   npm install
   ```

3. Crear `.env.local` a partir de `.env.example` y completar las credenciales
   del proyecto Supabase localmente.
4. No subir ni enviar `.env.local`, contraseñas, claves secretas ni la clave
   `service_role`. El `.gitignore` ya excluye los archivos de entorno; solo
   `.env.example` se puede versionar.
5. Iniciar y verificar la aplicación:

   ```powershell
   npm run dev
   npm run build
   ```

## 2. Estado actual

- Aplicación: React, TypeScript, Vite, React Router y Supabase.
- El login consulta `operadores` por `auth_user_id` y lee `nombre` y `rol`.
- Roles reconocidos: `chofer`, `hidrogrulero`, `supervisor` y `admin`
  (también se aceptan con mayúsculas).
- El registro crea una cuenta de Authentication y una solicitud pendiente; el
  rol elegido es solo una preferencia. Un administrador confirma el correo,
  asigna el rol efectivo y vincula o crea el operador desde Usuarios y roles.
- Para habilitar este flujo en Supabase, aplicar
  `supabase/migrations/20261113160000_registro_con_aprobacion.sql`.
- Ya existen rutas protegidas de chofer, supervisor y administrador.
- Las pantallas principales todavía son placeholders. En particular, el
  formulario de nuevo parte no guarda datos y muestra un estado documental
  simulado; no debe considerarse una validación real.
- El build de producción se ejecuta con `npm run build`. No hay un script de
  tests configurado por ahora.

## 3. Estructura objetivo

Evolucionar hacia una organización por funcionalidades sin mover todo de una
vez:

```text
src/
  app/                 # configuración de rutas y proveedores
  auth/                # sesión y permisos por rol
  components/
    layout/             # menú lateral, encabezado y marco autenticado
    ui/                 # controles visuales reutilizables
  features/
    dashboard/
    partes/
    vehiculos/
    checklist/
    observaciones/
    notificaciones/
  lib/                  # cliente Supabase y utilidades
  pages/                # páginas conectadas con las funcionalidades
```

Mantener las convenciones del proyecto y migrar cada pantalla cuando se trabaje
en ella; evitar una reestructuración masiva sin necesidad.

## 4. Etapas sugeridas

### Etapa A — Marco visual y navegación

**Estado:** implementada en la app. El marco compartido ofrece menú lateral
colapsable en escritorio, menú móvil con cierre por Escape, encabezado con
usuario y salida, y opciones filtradas según el rol. Las rutas siguen usando
guardas de acceso.

1. Definir un menú lateral para escritorio, con opción de colapsar.
2. En celular, mostrar la navegación como menú desplegable o panel accesible.
3. Crear un encabezado con nombre del usuario, rol y acción para cerrar sesión.
4. Preparar un área de contenido consistente: título, navegación contextual y
   tarjetas.
5. Adaptar el menú a los roles existentes; ocultar opciones que no correspondan
   al usuario.
6. Usar una identidad propia de Lifting Patagonia: mantener una estética
   industrial y clara, con buena legibilidad, sin reutilizar logos ni textos de
   la referencia.

**Criterio de aceptación:** al iniciar sesión, cada rol ve su marco y menú;
la navegación funciona con teclado, mouse y pantalla chica, y las rutas siguen
protegidas aunque se escriban directamente en la barra del navegador.

### Etapa B — Inicio por rol

1. Acordar qué información y accesos rápidos necesita cada rol.
2. Diseñar tarjetas de resumen solo con datos disponibles y confirmados.
3. Mostrar estados de carga, error y ausencia de datos.

**Criterio de aceptación:** no hay métricas inventadas; cada tarjeta enlaza a
una acción o sección que exista.

### Etapa C — Partes diarios

1. Revisar columnas, relaciones y políticas de `partes_diarios` en Supabase.
2. Acordar campos y validaciones con el equipo antes de cambiar el esquema.
3. Implementar creación y guardado con estados de carga, éxito y error.
4. Implementar historial y detalle según permisos.
5. Validar permisos también con RLS o lógica del servidor; no confiar solo en la
   interfaz.

**Criterio de aceptación:** un parte válido se guarda una sola vez, los datos
persisten al recargar y los errores se muestran claramente.

### Etapa D — Vehículos y checklist

1. Confirmar el esquema real de `vehiculos`, certificaciones y vistas
   relacionadas.
2. Crear listados, filtros y ficha de vehículo.
3. Implementar checklist e historial según el flujo acordado.
4. Consultar el estado documental real desde una fuente validada.

**Criterio de aceptación:** no habilitar una salida usando estados de ejemplo;
la regla definitiva debe validarse en el servidor.

### Etapa E — Observaciones y notificaciones

1. Definir estados, responsables y transiciones del flujo.
2. Acordar filtros y permisos para listados e historiales.
3. Implementar detalle, acciones y notificaciones con persistencia.

**Criterio de aceptación:** cada transición queda guardada y solo puede
ejecutarla un rol autorizado.

## 5. Forma de trabajo para cada cambio

1. Revisar el esquema y el comportamiento actual antes de editar.
2. Dividir el trabajo en cambios pequeños y relacionados.
3. No asumir nombres de columnas ni reglas de negocio: confirmarlos en Supabase
   o con el responsable del producto.
4. Mantener el diseño adaptable y accesible.
5. Ejecutar `npm run build` antes de dar una etapa por terminada.
6. Probar manualmente los casos principales, errores, permisos y navegación en
   escritorio y celular.
7. Describir en el pull request qué cambió, cómo se probó y qué queda pendiente.
