import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// Constancias de gerenciamiento: el documento congelado que emite la base al cerrar un viaje
// (ver supabase/migrations/..._constancias_gerenciamiento.sql). Nunca cambian: cada corrección es una versión nueva.

export type MotivoConstancia = "emision_inicial" | "cierre" | "anulacion" | "correccion";

export const MOTIVOS_CONSTANCIA: Record<MotivoConstancia, string> = {
  emision_inicial: "Emisión inicial",
  cierre: "Cierre del gerenciamiento",
  anulacion: "Anulación",
  correccion: "Corrección de facturación",
};

/** Lo que guarda la base en `contenido` (los textos vienen tal cual se emitieron). */
export interface ContenidoConstancia {
  gerenciamiento: number;
  estado: string;
  viaje: {
    fecha_salida: string; hora_salida: string; fecha_llegada: string; hora_llegada: string;
    origen: string; destino: string; distancia_km: number; rutas: string | null; motivo: string | null;
    linea: string | null; telefono: string | null; radioactivo: boolean | null; pasajeros: boolean | null;
  };
  personas: {
    conductor: string; conductor2: string | null; cargado_por: string | null; cargado_en: string | null;
    autorizado_por: string | null; autorizado_en: string | null; cerrado_en: string | null;
  };
  vehiculo: { dominio: string | null; marca_modelo: string | null; equipo: string | null };
  cliente: { razon_social: string; cuit: string | null } | null;
  contrato: { modalidad: string | null; unidad_medida: string | null } | null;
  checklist: { id: number; realizado_en: string; usuario: string | null; apto: boolean; fallas: string[] | null } | null;
  parte: {
    numero: number; fecha: string; riesgo: string | null; nivel_riesgo: string | null;
    ats: string | null; conformidad_operador_en: string | null;
  } | null;
  strix: {
    recorridos: number | null; km: number | null; horas_marcha: number | null; horas_ralenti: number | null;
    velocidad_maxima: number | null; excesos: number | null; calculado_en: string;
  } | null;
  anulacion: { en: string; por: string | null; motivo: string } | null;
}

export interface Constancia {
  id: number;
  gerenciamientoId: number;
  version: number;
  motivo: MotivoConstancia;
  contenido: ContenidoConstancia;
  hash: string;
  emitidaEn: string;
}

/** Número visible del documento: G-000123 v2. */
export const numeroConstancia = (c: Pick<Constancia, "gerenciamientoId" | "version">) =>
  `G-${String(c.gerenciamientoId).padStart(6, "0")} v${c.version}`;

/** Dirección pública para comprobar un documento impreso. */
export const enlaceVerificacion = (hash: string) => `${window.location.origin}/verificar/${hash}`;

export function useConstancias(gerenciamientoId: string) {
  const [constancias, setConstancias] = useState<Constancia[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const { data, error: fallo } = await getSupabase()
      .from("constancias_gerenciamiento")
      .select("*")
      .eq("gerenciamiento_id", gerenciamientoId)
      .order("version", { ascending: false });
    if (fallo) {
      setError(/does not exist|schema cache/i.test(fallo.message)
        ? "Falta aplicar la migración de constancias en la base. Avisale al administrador."
        : fallo.message);
      return;
    }
    setError("");
    setConstancias((data ?? []).map((f) => ({
      id: Number(f.id),
      gerenciamientoId: Number(f.gerenciamiento_id),
      version: Number(f.version),
      motivo: f.motivo as MotivoConstancia,
      contenido: f.contenido as ContenidoConstancia,
      hash: String(f.hash),
      emitidaEn: String(f.emitida_en),
    })));
  }, [gerenciamientoId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { constancias, error, refresh };
}

export interface Verificacion {
  gerenciamiento: number;
  version: number;
  emitidaEn: string;
  motivo: MotivoConstancia;
  vehiculo: string;
  cliente: string;
  fechaSalida: string;
  ultimaVersion: number;
  integra: boolean;
}

/** Comprueba un código de verificación (página pública, no necesita sesión). */
export async function verificarConstancia(hash: string): Promise<Verificacion | null> {
  const { data, error } = await getSupabase().rpc("verificar_constancia", { p_hash: hash });
  if (error) throw new Error(error.message);
  const fila = Array.isArray(data) ? data[0] : null;
  if (!fila) return null;
  return {
    gerenciamiento: Number(fila.gerenciamiento),
    version: Number(fila.version),
    emitidaEn: String(fila.emitida_en),
    motivo: fila.motivo as MotivoConstancia,
    vehiculo: String(fila.vehiculo ?? ""),
    cliente: String(fila.cliente ?? ""),
    fechaSalida: String(fila.fecha_salida ?? ""),
    ultimaVersion: Number(fila.ultima_version),
    integra: fila.integra === true,
  };
}
