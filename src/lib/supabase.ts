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

export type Rol = "chofer" | "hidrogrulero" | "supervisor" | "admin";

// Ajustar al esquema real de la Tabla 7 cuando esté lista.
export interface Operador {
  id: string; // = auth.users.id
  /** operadores.id: la clave con la que se guarda el legajo. */
  operadorId: string;
  nombre_completo: string;
  rol: Rol;
}
