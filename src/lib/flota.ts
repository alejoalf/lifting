import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { semaforoDe, type Semaforo } from "./registros";
import { borrarArchivo, subirArchivo, type TipoDocumento } from "./legajos";

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
};

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
export function estadoDocumental(documentos: DocumentoVehiculo[], vehiculoId: string) {
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
  if (error) throw new Error(error.message);
  return String(data);
}

export async function eliminarVehiculo(id: string, documentos: DocumentoVehiculo[]) {
  const { error } = await getSupabase().rpc("eliminar_vehiculo", { p_id: id });
  if (error) throw new Error(error.message);
  // Los documentos se borran en cascada; quedan por limpiar sus archivos.
  await Promise.all(documentos.filter((d) => d.vehiculo_id === id).map((d) => borrarArchivo(d.archivo_path, "flota")));
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
  if (error) {
    if (archivo) await borrarArchivo(String(fila.archivo_path), "flota");
    throw new Error(error.message);
  }
  if (archivo && anterior) await borrarArchivo(anterior.archivo_path, "flota");
}

export async function eliminarDocumentoVehiculo(documento: DocumentoVehiculo) {
  const { error } = await getSupabase().from("documentos_vehiculo").delete().eq("id", documento.id);
  if (error) throw new Error(error.message);
  await borrarArchivo(documento.archivo_path, "flota");
}
