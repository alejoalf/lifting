import { useCallback, useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { semaforoDe } from "./registros";

// Legajos del personal (Supabase). Las columnas van tal cual están en la base.

export interface TipoDocumento {
  id: string;
  aplica_a: "operador" | "vehiculo";
  nombre: string;
  requiere_vencimiento: boolean;
  activo: boolean;
}

export interface Actividad {
  id: string;
  nombre: string;
  descripcion: string | null;
  cliente_id: string | null;
  /** Razón social del cliente; null = la actividad vale para cualquier cliente. */
  cliente: string | null;
  activa: boolean;
  /** Ids de los tipos de documento que exige. */
  requisitos: string[];
}

/** Lo que devuelve la función leer-documento. */
export interface LecturaIA {
  legible: boolean;
  tipo: string | null;
  tipo_documento_id: string | null;
  titular: string | null;
  identificacion: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  emisor: string | null;
  observaciones: string;
}

export interface DocumentoLegajo {
  id: string;
  operador_id: string;
  tipo_documento_id: string;
  fecha_emision: string | null;
  vencimiento: string | null;
  archivo_path: string;
  archivo_nombre: string;
  estado: "pendiente" | "aprobado" | "rechazado";
  motivo_rechazo: string | null;
  lectura_ia: LecturaIA | null;
  created_at: string;
}

export interface OperadorLegajo {
  id: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

export interface DatosLegajos {
  tipos: TipoDocumento[];
  actividades: Actividad[];
  documentos: DocumentoLegajo[];
}

const TAMANO_MAXIMO = 10 * 1024 * 1024;
/** La lectura con IA queda pendiente: pasar a true cuando la función leer-documento esté desplegada. */
export const LECTURA_IA_ACTIVA = false;
export const FORMATOS_ARCHIVO ="application/pdf,image/jpeg,image/png,image/webp";

/** Tipos, actividades y documentos. Sin operadorId trae los documentos que el usuario puede ver. */
export function useLegajos(operadorId?: string) {
  const [datos, setDatos] = useState<DatosLegajos | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    const consulta = supabase.from("documentos_legajo").select("*").order("created_at", { ascending: false });
    try {
      const [tipos, actividades, documentos] = await Promise.all([
        supabase.from("tipos_documento").select("*").eq("aplica_a", "operador").order("nombre"),
        supabase.rpc("listar_actividades_legajo"),
        operadorId ? consulta.eq("operador_id", operadorId) : consulta,
      ]);
      const fallo = tipos.error ?? actividades.error ?? documentos.error;
      if (fallo) throw new Error(fallo.message);
      setDatos({ tipos: tipos.data ?? [], actividades: actividades.data ?? [], documentos: documentos.data ?? [] });
      setError("");
    } catch (fallo) {
      setError(`No se pudieron cargar los legajos${fallo instanceof Error ? `: ${fallo.message}` : "."} Verificá que la migración de legajos esté aplicada.`);
    }
  }, [operadorId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { datos, error, refresh };
}

export function useOperadoresLegajo() {
  const [operadores, setOperadores] = useState<OperadorLegajo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    getSupabase().rpc("listar_operadores_legajo").then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) setError(`No se pudo cargar el personal: ${fallo.message}`);
      else setOperadores(data ?? []);
    });
    return () => { activo = false; };
  }, []);

  return { operadores, error };
}

export type EstadoRequisito = "vigente" | "por-vencer" | "vencido" | "en-revision" | "falta";

export const ESTADOS_REQUISITO: Record<EstadoRequisito, string> = {
  vigente: "Vigente",
  "por-vencer": "Por vencer",
  vencido: "Vencido",
  "en-revision": "En revisión",
  falta: "Falta cargar",
};

/** Estado de un tipo de documento para un operador. Solo cuentan los aprobados; si hay varios, el de vencimiento más lejano. */
export function estadoRequisito(documentos: DocumentoLegajo[], operadorId: string, tipo: TipoDocumento) {
  const propios = documentos.filter((d) => d.operador_id === operadorId && d.tipo_documento_id === tipo.id);
  const aprobados = propios.filter((d) => d.estado === "aprobado");
  const enRevision = propios.some((d) => d.estado === "pendiente");
  if (aprobados.length === 0) {
    return { estado: (enRevision ? "en-revision" : "falta") as EstadoRequisito, vencimiento: null };
  }
  if (!tipo.requiere_vencimiento) return { estado: "vigente" as EstadoRequisito, vencimiento: null };

  const vencimiento = aprobados.map((d) => d.vencimiento ?? "").sort().pop() ?? "";
  const estado: EstadoRequisito = vencimiento ? semaforoDe(vencimiento) : "vencido";
  return { estado: estado === "vencido" && enRevision ? "en-revision" as const : estado, vencimiento: vencimiento || null };
}

export interface Habilitacion {
  actividad: Actividad;
  habilitado: boolean;
  requisitos: { tipo: TipoDocumento; estado: EstadoRequisito; vencimiento: string | null }[];
}

/** Para cada actividad activa: si el operador tiene vigentes todos los documentos que exige. */
export function habilitacionesDe(datos: DatosLegajos, operadorId: string): Habilitacion[] {
  return datos.actividades.filter((a) => a.activa).map((actividad) => {
    const requisitos = datos.tipos
      .filter((tipo) => actividad.requisitos.includes(tipo.id))
      .map((tipo) => ({ tipo, ...estadoRequisito(datos.documentos, operadorId, tipo) }));
    return {
      actividad,
      habilitado: requisitos.every((r) => r.estado === "vigente" || r.estado === "por-vencer"),
      requisitos,
    };
  });
}

export function nombreActividad(actividad: Actividad) {
  return actividad.cliente ? `${actividad.nombre} · ${actividad.cliente}` : actividad.nombre;
}

export type Bucket = "legajos" | "flota";

/** Sube el archivo al bucket privado, dentro de la carpeta indicada, y devuelve su ruta. */
export async function subirArchivo(carpeta: string, archivo: File, bucket: Bucket = "legajos") {
  if (archivo.size > TAMANO_MAXIMO) throw new Error("El archivo supera los 10 MB.");
  const extension = /\.([a-z0-9]+)$/i.exec(archivo.name)?.[1].toLowerCase() ?? "bin";
  const path = `${carpeta}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getSupabase().storage.from(bucket).upload(path, archivo, { contentType: archivo.type });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return path;
}

export async function leerDocumentoConIA(path: string): Promise<LecturaIA> {
  const { data, error } = await getSupabase().functions.invoke("leer-documento", { body: { path } });
  if (error) {
    let mensaje = "La lectura automática no está disponible. Cargá los datos a mano.";
    if (error instanceof FunctionsHttpError) {
      const cuerpo = await error.context.json().catch(() => null);
      if (typeof cuerpo?.error === "string") mensaje = cuerpo.error;
    }
    throw new Error(mensaje);
  }
  return data as LecturaIA;
}

export async function guardarDocumento(documento: {
  operadorId: string;
  tipoId: string;
  fechaEmision: string;
  vencimiento: string;
  path: string;
  archivoNombre: string;
  lectura: LecturaIA | null;
}) {
  const { error } = await getSupabase().from("documentos_legajo").insert({
    operador_id: documento.operadorId,
    tipo_documento_id: documento.tipoId,
    fecha_emision: documento.fechaEmision || null,
    vencimiento: documento.vencimiento || null,
    archivo_path: documento.path,
    archivo_nombre: documento.archivoNombre,
    lectura_ia: documento.lectura,
  });
  if (error) throw new Error(error.message);
}

/** Borra un archivo que ya no usa ningún documento. Si falla, solo queda el archivo sin usar. */
export async function borrarArchivo(path: string, bucket: Bucket = "legajos") {
  await getSupabase().storage.from(bucket).remove([path]).catch(() => null);
}

/** Edita un documento. `path` vacío = conserva el archivo actual. */
export async function editarDocumento(documento: DocumentoLegajo, cambios: {
  tipoId: string;
  fechaEmision: string;
  vencimiento: string;
  path: string;
  archivoNombre: string;
}) {
  const { error } = await getSupabase().rpc("editar_documento_legajo", {
    p_documento_id: documento.id,
    p_tipo_documento_id: cambios.tipoId,
    p_fecha_emision: cambios.fechaEmision || null,
    p_vencimiento: cambios.vencimiento || null,
    p_archivo_path: cambios.path || null,
    p_archivo_nombre: cambios.path ? cambios.archivoNombre : null,
  });
  if (error) throw new Error(error.message);
  if (cambios.path) await borrarArchivo(documento.archivo_path);
}

export async function eliminarDocumento(documento: DocumentoLegajo) {
  const { error } = await getSupabase().rpc("eliminar_documento_legajo", { p_documento_id: documento.id });
  if (error) throw new Error(error.message);
  await borrarArchivo(documento.archivo_path);
}

export async function revisarDocumento(id: string, aprobar: boolean, motivo = "") {
  const { error } = await getSupabase().rpc("revisar_documento_legajo", {
    p_documento_id: id,
    p_aprobar: aprobar,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
}

/** Abre el archivo en otra pestaña con un enlace temporal. */
export async function abrirArchivo(path: string, bucket: Bucket = "legajos") {
  // La pestaña se abre antes del pedido para que el navegador no la bloquee.
  const pestana = window.open("", "_blank");
  const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data) {
    pestana?.close();
    throw new Error("No se pudo abrir el archivo.");
  }
  if (pestana) pestana.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
