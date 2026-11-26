import { useCallback, useEffect, useState } from "react";
import { anularRegistro, getSupabase, mensajeDeError } from "./supabase";
import { semaforoDe, type Semaforo } from "./registros";
import { subirArchivo, type TipoDocumento } from "./legajos";

// Flota (Supabase): vehículos, sus documentos y el service obligatorio.

/** Fila de la tabla vehiculos. Las columnas se leen de la base (ver useColumnasVehiculo). */
export type Vehiculo = { id: string } & Record<string, unknown>;

/** Columna editable de vehiculos, tal como la informa la base. */
export interface ColumnaVehiculo {
  columna: string;
  tipo: "texto" | "numero" | "fecha" | "booleano" | "enum";
  obligatoria: boolean;
  opciones: string[] | null;
}

export interface DocumentoVehiculo {
  id: string;
  vehiculo_id: string;
  tipo_documento_id: string;
  fecha_emision: string | null;
  vencimiento: string | null;
  archivo_path: string;
  archivo_nombre: string;
  created_at: string;
  /** Anulado: queda como historial pero no cuenta. */
  anulado_en?: string | null;
  motivo_anulacion?: string | null;
}

export interface DatosFlota {
  vehiculos: Vehiculo[];
  documentos: DocumentoVehiculo[];
  tipos: TipoDocumento[];
}

const ETIQUETAS: Record<string, string> = {
  dominio: "Dominio",
  marca_modelo: "Marca / modelo",
  equipo: "Equipo",
  estado: "Estado",
  titularidad: "Titularidad",
  venc_seguro: "Vencimiento seguro",
  venc_patente: "Vencimiento patente",
  ultimo_service: "Último service",
  proximo_service: "Próximo service",
  tipo_flota: "Tipo de flota (checklist)",
  riesgo_equipo_id: "Equipo en la matriz de riesgos",
};

/** Equipos de la matriz de riesgos, para vincularlos con los vehículos. */
export function useEquiposRiesgo() {
  const [equipos, setEquipos] = useState<{ id: string; nombre: string; activo: boolean }[]>([]);
  useEffect(() => {
    let activo = true;
    getSupabase().from("riesgo_equipos").select("id, nombre, activo").order("orden").order("nombre").then(({ data }) => {
      if (activo) setEquipos((data ?? []).map((e) => ({ id: String(e.id), nombre: String(e.nombre), activo: e.activo === true })));
    });
    return () => { activo = false; };
  }, []);
  return equipos;
}

export function etiquetaColumna(columna: string) {
  return ETIQUETAS[columna] ?? columna.replace(/_/g, " ").replace(/^./, (letra) => letra.toUpperCase());
}

export function texto(valor: unknown) {
  return valor === null || valor === undefined || valor === "" ? "" : String(valor);
}

export function useFlota() {
  const [datos, setDatos] = useState<DatosFlota | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const [vehiculos, documentos, tipos] = await Promise.all([
        supabase.from("vehiculos").select("*").order("dominio"),
        supabase.from("documentos_vehiculo").select("*").order("created_at", { ascending: false }),
        supabase.from("tipos_documento").select("*").eq("aplica_a", "vehiculo").order("nombre"),
      ]);
      const fallo = vehiculos.error ?? documentos.error ?? tipos.error;
      if (fallo) throw new Error(fallo.message);
      setDatos({ vehiculos: vehiculos.data ?? [], documentos: documentos.data ?? [], tipos: tipos.data ?? [] });
      setError("");
    } catch (fallo) {
      setError(`No se pudo cargar la flota${fallo instanceof Error ? `: ${fallo.message}` : "."} Verificá que la migración de flota esté aplicada.`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { datos, error, refresh };
}

export function useColumnasVehiculo() {
  const [columnas, setColumnas] = useState<ColumnaVehiculo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    getSupabase().rpc("columnas_vehiculos").then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) setError(`No se pudieron leer los datos del vehículo: ${fallo.message}`);
      else setColumnas(data ?? []);
    });
    return () => { activo = false; };
  }, []);

  return { columnas, error };
}

/** Estado documental de un vehículo: por cada tipo cuenta el documento de vencimiento más lejano. */
export function estadoDocumental(todos: DocumentoVehiculo[], vehiculoId: string) {
  const documentos = todos.filter((d) => !d.anulado_en);
  const porTipo = new Map<string, string>();
  for (const d of documentos) {
    if (d.vehiculo_id !== vehiculoId || !d.vencimiento) continue;
    if (d.vencimiento > (porTipo.get(d.tipo_documento_id) ?? "")) porTipo.set(d.tipo_documento_id, d.vencimiento);
  }
  const estados = [...porTipo.values()].map(semaforoDe);
  const peor: Semaforo | null = estados.includes("vencido") ? "vencido"
    : estados.includes("por-vencer") ? "por-vencer"
      : documentos.some((d) => d.vehiculo_id === vehiculoId) ? "vigente" : null;
  return { peor, vencidos: estados.filter((e) => e === "vencido").length };
}

/** Crea (id null) o modifica un vehículo. Devuelve su id. */
export async function guardarVehiculo(id: string | null, datos: Record<string, unknown>) {
  const { data, error } = await getSupabase().rpc("guardar_vehiculo", { p_id: id, p_datos: datos });
  if (error) throw new Error(mensajeDeError(error));
  return String(data);
}

/** Carga un documento nuevo o, con `anterior`, lo edita (sin `archivo` conserva el archivo actual). */
export async function guardarDocumentoVehiculo(documento: {
  vehiculoId: string;
  tipoId: string;
  fechaEmision: string;
  vencimiento: string;
  archivo: File | null;
  anterior: DocumentoVehiculo | null;
}) {
  const { archivo, anterior } = documento;
  const fila: Record<string, unknown> = {
    tipo_documento_id: documento.tipoId,
    fecha_emision: documento.fechaEmision || null,
    vencimiento: documento.vencimiento || null,
  };
  if (archivo) {
    fila.archivo_path = await subirArchivo(documento.vehiculoId, archivo, "flota");
    fila.archivo_nombre = archivo.name;
  }

  const tabla = getSupabase().from("documentos_vehiculo");
  const { error } = anterior
    ? await tabla.update(fila).eq("id", anterior.id)
    : await tabla.insert({ ...fila, vehiculo_id: documento.vehiculoId });
  // El archivo anterior no se borra: queda en Storage y su ruta en la auditoría.
  if (error) throw new Error(mensajeDeError(error));
}

/** Anula un documento: queda como historial, deja de contar para el estado documental y el archivo se conserva. */
export const anularDocumentoVehiculo = (documento: DocumentoVehiculo, motivo: string) =>
  anularRegistro("documentos_vehiculo", documento.id, motivo);
