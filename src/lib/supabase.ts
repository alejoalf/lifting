import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function isValidSupabaseUrl(value: string | undefined) {
  if (!value || value.toLowerCase().includes("tu_proyecto")) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  isValidSupabaseUrl(supabaseUrl) &&
  Boolean(supabaseAnonKey && !supabaseAnonKey.toLowerCase().startsWith("tu_"));

const client =
  isSupabaseConfigured && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export function getSupabase() {
  if (!client) {
    throw new Error("Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.");
  }
  return client;
}

/** Tablas que se anulan con la función genérica de la base (solo administrador). */
export type TablaAnulable =
  | "caja_gastos" | "cliente_historial" | "certificados_empresa" | "documentos_vehiculo"
  | "certificaciones" | "strix_recorridos" | "strix_importaciones";

/** Anula un registro: no se borra, queda guardado como anulado con el motivo. */
export async function anularRegistro(tabla: TablaAnulable, id: string | number, motivo: string) {
  const { error } = await getSupabase().rpc("anular_registro", { p_tabla: tabla, p_id: String(id), p_motivo: motivo });
  if (error) throw new Error(error.message);
}

/** Proveedores de ingreso habilitados en Supabase Auth (por ejemplo { email: true, google: true }). */
export async function proveedoresHabilitados(): Promise<Record<string, boolean>> {
  if (!supabaseUrl || !supabaseAnonKey) return {};
  const respuesta = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
  if (!respuesta.ok) throw new Error("No se pudo consultar la configuración de acceso.");
  const json = (await respuesta.json()) as { external?: Record<string, boolean> };
  return json.external ?? {};
}

/**
 * Mensaje en castellano para los errores técnicos de la base (restricciones,
 * permisos, funciones faltantes). Los que lanzan nuestras funciones ya vienen
 * redactados y se devuelven tal cual.
 */
export function mensajeDeError(error: { message: string; code?: string }, alBorrar = false) {
  const { code = "", message } = error;
  if (code === "23505" || /duplicate key/i.test(message)) return "Ya existe un registro con ese nombre o dato.";
  if (code === "23503" || /foreign key/i.test(message)) {
    return alBorrar
      ? "No se puede eliminar porque tiene otros registros asociados."
      : "Alguno de los datos elegidos ya no existe.";
  }
  if (code === "23514" || /check constraint/i.test(message)) return "Alguno de los valores no es válido.";
  if (code === "23502" || /not-null constraint/i.test(message)) return "Falta completar un dato obligatorio.";
  if (code === "42501" && /row-level security|permission denied/i.test(message)) return "No tenés permiso para hacer este cambio.";
  if (code === "PGRST202" || /Could not find the function/i.test(message)) {
    return "Falta aplicar una actualización de la base de datos (migración). Avisale al administrador.";
  }
  return message;
}

export type Rol = "chofer" | "hidrogrulero" | "supervisor" | "admin";

// Ajustar al esquema real de la Tabla 7 cuando esté lista.
export interface Operador {
  id: string; // = auth.users.id
  /** operadores.id: la clave con la que se guarda el legajo. */
  operadorId: string;
  nombre_completo: string;
  rol: Rol;
}
