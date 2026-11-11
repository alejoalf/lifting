import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

/** Dominios de la flota cargada en Supabase. Si no se pueden leer (RLS, red), devuelve una lista vacía. */
export function useDominios() {
  const [dominios, setDominios] = useState<string[]>([]);

  useEffect(() => {
    let activo = true;
    getSupabase().from("vehiculos").select("dominio").order("dominio").then(({ data }) => {
      if (activo && data) setDominios(data.map((v) => String(v.dominio ?? "")).filter(Boolean));
    });
    return () => { activo = false; };
  }, []);

  return dominios;
}
