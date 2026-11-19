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

/** Proveedores de ingreso habilitados en Supabase Auth (por ejemplo { email: true, google: true }). */
export async function proveedoresHabilitados(): Promise<Record<string, boolean>> {
  if (!supabaseUrl || !supabaseAnonKey) return {};
  const respuesta = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
  if (!respuesta.ok) throw new Error("No se pudo consultar la configuración de acceso.");
  const json = (await respuesta.json()) as { external?: Record<string, boolean> };
  return json.external ?? {};
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
