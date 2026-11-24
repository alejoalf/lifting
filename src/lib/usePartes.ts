import { useCallback, useEffect, useState } from "react";
import { getSupabase, mensajeDeError } from "./supabase";
import type { EstadoParte, Parte, Semaforo } from "./registros";

export type TipoTarea = "Transporte" | "Izaje Hidrogrua" | "Altura Barquilla";

export interface CatalogoParte {
  clientes: { id: string; nombre: string }[];
  vehiculos: { id: string; nombre: string }[];
  contratos: { id: string; nombre: string; clienteId: string; vehiculoId: string }[];
}

export interface NuevoParte {
  clienteId: string;
  contratoId: string | null;
  vehiculoId: string;
  tipoTarea: TipoTarea;
  origen: string;
  destino: string;
  kmInicial: number;
  observaciones: string;
  /** Dónde se abre el parte: GPS del teléfono o un tramo de la matriz de riesgos. */
  ubicacion: { latitud: number; longitud: number; precision: number } | { tramoId: string } | null;
  /** ATS armado con la matriz y, en izaje y altura, la evaluación de viento del equipo del vehículo. */
  riesgo: {
    ats: string;
    /** El operador leyó el ATS y da conformidad (obligatorio si hay ATS). */
    conformidad: boolean;
    equipo_id?: string;
    estado?: "habilitado" | "precaucion" | "suspendido";
    viento?: number | null;
    rafaga?: number | null;
    motivos?: string[];
    momento?: number;
  } | null;
}

const estados: Record<string, EstadoParte> = {
  Pendiente: "pendiente",
  Excepcion: "excepcion",
  "En Curso": "en_curso",
  Frenado: "frenado",
  Cerrado: "cerrado",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function texto(row: Record<string, unknown>, campo: string) {
  const value = row[campo];
  return typeof value === "string" ? value : "";
}

function numero(row: Record<string, unknown>, campo: string) {
  const value = Number(row[campo]);
  if (!Number.isFinite(value)) throw new Error(`El campo ${campo} del parte no es válido.`);
  return value;
}

function numeroOpcional(row: Record<string, unknown>, campo: string) {
  const value = row[campo];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`El campo ${campo} del parte no es válido.`);
  return parsed;
}

const SEMAFOROS: Semaforo[] = ["vigente", "por-vencer", "vencido"];

function mapearParte(value: unknown): Parte {
  if (!isRecord(value)) throw new Error("Supabase devolvió un parte con formato inválido.");
  const estado = estados[texto(value, "estado")];
  if (!estado) throw new Error(`El estado "${texto(value, "estado")}" del parte no está reconocido.`);
  const semaforo = SEMAFOROS.find((s) => s === value.semaforo) ?? null;
  const vencidos = Array.isArray(value.documentos_vencidos) ? value.documentos_vencidos.map(String) : [];

  return {
    id: texto(value, "id"),
    numero: numero(value, "nro_parte"),
    creadoPor: texto(value, "auth_user_id"),
    operador: texto(value, "operador"),
    creadoEn: texto(value, "creado_en"),
    fecha: texto(value, "fecha"),
    cliente: texto(value, "cliente"),
    contrato: texto(value, "contrato"),
    vehiculo: texto(value, "vehiculo"),
    tarea: texto(value, "tarea"),
    origen: texto(value, "origen"),
    destino: texto(value, "destino"),
    kmInicial: numero(value, "km_inicial"),
    observaciones: texto(value, "observaciones"),
    semaforo,
    documentosVencidos: vencidos,
    estado,
    resueltoPor: texto(value, "resuelto_por"),
    resueltoEn: texto(value, "resuelto_en"),
    motivoFreno: texto(value, "motivo_freno"),
    salidaEn: texto(value, "salida_en"),
    cerradoEn: texto(value, "cerrado_en"),
    kmFinal: numeroOpcional(value, "km_final"),
    horasDeclaradas: numeroOpcional(value, "horas_declaradas"),
    trabajoRealizado: texto(value, "trabajo_realizado"),
    firmadoPor: texto(value, "firmado_por"),
    firmadoEn: texto(value, "firmado_en"),
  };
}

export function usePartes() {
  const [partes, setPartes] = useState<Parte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Solo la primera carga muestra "Cargando…"; al refrescar después de una acción la pantalla no parpadea.
  const refresh = useCallback(async () => {
    setError("");
    try {
      const { data, error: fallo } = await getSupabase().rpc("listar_partes_diarios");
      if (fallo) throw new Error(fallo.message);
      if (!Array.isArray(data)) throw new Error("La respuesta de Supabase no tiene el formato esperado.");
      setPartes(data.map(mapearParte));
    } catch (fallo) {
      setPartes([]);
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar los partes. Revisá la conexión e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { partes, loading, error, refresh };
}

export function useCatalogoPartes() {
  const [catalogo, setCatalogo] = useState<CatalogoParte>({ clientes: [], vehiculos: [], contratos: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function cargar() {
      setLoading(true);
      setError("");
      try {
        const { data, error: fallo } = await getSupabase().rpc("catalogo_partes_diarios");
        if (fallo) throw new Error(fallo.message);
        if (!Array.isArray(data)) throw new Error("La respuesta del catálogo no tiene el formato esperado.");

        const siguiente: CatalogoParte = { clientes: [], vehiculos: [], contratos: [] };
        for (const value of data) {
          if (!isRecord(value)) throw new Error("Supabase devolvió una opción del catálogo con formato inválido.");
          const item = { id: texto(value, "id"), nombre: texto(value, "nombre") };
          if (!item.id || !item.nombre) throw new Error("Una opción del catálogo no tiene identificador o nombre.");

          if (value.tipo === "cliente") siguiente.clientes.push(item);
          else if (value.tipo === "vehiculo") siguiente.vehiculos.push(item);
          else if (value.tipo === "contrato") {
            siguiente.contratos.push({
              ...item,
              clienteId: texto(value, "cliente_id"),
              vehiculoId: texto(value, "vehiculo_id"),
            });
          } else {
            throw new Error("Supabase devolvió un tipo de catálogo no reconocido.");
          }
        }

        if (active) setCatalogo(siguiente);
      } catch (fallo) {
        if (active) setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el catálogo. Revisá la conexión e intentá de nuevo.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void cargar();
    return () => { active = false; };
  }, []);

  return { catalogo, loading, error };
}

export async function crearParte(input: NuevoParte) {
  const { data, error } = await getSupabase().rpc("crear_parte_diario", {
    p_cliente_id: input.clienteId,
    p_contrato_id: input.contratoId,
    p_vehiculo_id: input.vehiculoId,
    p_tipo_tarea: input.tipoTarea,
    p_origen: input.origen,
    p_destino: input.destino,
    p_km_inicial: input.kmInicial,
    p_observaciones: input.observaciones,
    p_latitud: input.ubicacion && "latitud" in input.ubicacion ? input.ubicacion.latitud : null,
    p_longitud: input.ubicacion && "longitud" in input.ubicacion ? input.ubicacion.longitud : null,
    p_precision: input.ubicacion && "precision" in input.ubicacion ? input.ubicacion.precision : null,
    p_tramo_id: input.ubicacion && "tramoId" in input.ubicacion ? input.ubicacion.tramoId : null,
    p_riesgo: input.riesgo,
  });
  if (error) throw new Error(mensajeDeError(error));
  if (!Array.isArray(data) || !isRecord(data[0]) || typeof data[0].parte_id !== "string") {
    throw new Error("No se pudo confirmar la creación del parte. Actualizá la lista antes de volver a intentarlo.");
  }
  const numeroParte = Number(data[0].numero);
  if (!Number.isSafeInteger(numeroParte) || numeroParte < 1) {
    throw new Error("El parte se creó, pero Supabase devolvió un número de parte inválido.");
  }
  return { id: data[0].parte_id, numero: numeroParte };
}

// ---------- Acciones sobre un parte (ver migración 20261123120000_partes_diarios_flujo) ----------

async function accionParte(funcion: string, parametros: Record<string, unknown>) {
  const { error } = await getSupabase().rpc(funcion, parametros);
  if (error) throw new Error(mensajeDeError(error));
}

/** Vuelve a hacer el control documental de un parte pendiente o con excepción. */
export const controlarParte = (id: string) => accionParte("controlar_parte_diario", { p_id: id });

/** Admin: autoriza la salida excepcional o la frena con un motivo. */
export const resolverExcepcion = (id: string, autorizar: boolean, motivo: string) =>
  accionParte("resolver_excepcion_parte", { p_id: id, p_autorizar: autorizar, p_motivo: motivo });

/** Cierra el servicio con el kilometraje final, las horas de equipo y el trabajo realizado. */
export const cerrarParte = (id: string, cierre: { kmFinal: number; horas: number | null; trabajo: string }) =>
  accionParte("cerrar_parte_diario", { p_id: id, p_km_final: cierre.kmFinal, p_horas: cierre.horas, p_trabajo: cierre.trabajo });

/** Supervisor o Admin: firma un parte cerrado. */
export const firmarParte = (id: string) => accionParte("firmar_parte_diario", { p_id: id });

/// ---------- Resumen del parte: riesgo, ATS, trabajos (gerenciamientos), checklist y Strix ----------
// (ver migraciones 20261124140000_parte_ubicacion_riesgo y 20261125110000_parte_gerenciamientos)

export interface RiesgoParte {
  latitud: number | null;
  longitud: number | null;
  precision: number | null;
  origen: "gps" | "tramo" | null;
  tramo: string;
  equipo: string;
  estado: "habilitado" | "precaucion" | "suspendido" | "sin-datos" | null;
  motivos: string[];
  viento: number | null;
  rafaga: number | null;
  nivel: string;
  climaMomento: string;
}

/** Un trabajo (gerenciamiento) del parte, con su checklist y sus datos de Strix. */
export interface TrabajoParte {
  id: number;
  fechaSalida: string;
  horaSalida: string;
  fechaLlegada: string;
  horaLlegada: string;
  origen: string;
  destino: string;
  distanciaKm: number | null;
  conductor: string;
  autorizacion: string;
  estado: string;
  responsable: string;
  strixRecorridos: number | null;
  strixKm: number | null;
  strixHorasMarcha: number | null;
  strixHorasRalenti: number | null;
  strixVelocidadMaxima: number | null;
  strixExcesos: number | null;
  checklistId: number | null;
  checklistApto: boolean | null;
  checklistEn: string;
  checklistUsuario: string;
}

export interface ResumenParte {
  riesgo: RiesgoParte;
  ats: string;
  /** Cuándo el operador dio conformidad con el ATS ("" si no corresponde). */
  conformidadEn: string;
  trabajos: TrabajoParte[];
  strix: {
    vinculados: number;
    km: number | null;
    horasMarcha: number | null;
    horasRalenti: number | null;
    velocidadMaxima: number | null;
    excesos: number | null;
  };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const obj = (v: unknown) => (isRecord(v) ? v : {});

function aResumen(data: unknown): ResumenParte | null {
  if (!isRecord(data)) return null;
  const r = obj(data.riesgo);
  const s = obj(data.strix);
  return {
    riesgo: {
      latitud: num(r.latitud),
      longitud: num(r.longitud),
      precision: num(r.precision_m),
      origen: r.origen === "gps" || r.origen === "tramo" ? r.origen : null,
      tramo: texto(r, "tramo"),
      equipo: texto(r, "equipo"),
      estado: ["habilitado", "precaucion", "suspendido", "sin-datos"].includes(String(r.estado)) ? r.estado as RiesgoParte["estado"] : null,
      motivos: Array.isArray(r.motivos) ? r.motivos.map(String) : [],
      viento: num(r.viento_kmh),
      rafaga: num(r.rafaga_kmh),
      nivel: texto(r, "nivel_riesgo"),
      climaMomento: texto(r, "clima_momento"),
    },
    ats: typeof data.ats === "string" ? data.ats : "",
    conformidadEn: texto(data, "conformidad_en"),
    trabajos: (Array.isArray(data.gerenciamientos) ? data.gerenciamientos : []).filter(isRecord).map((g) => ({
      id: Number(g.id),
      fechaSalida: texto(g, "fecha_salida"),
      horaSalida: texto(g, "hora_salida"),
      fechaLlegada: texto(g, "fecha_llegada"),
      horaLlegada: texto(g, "hora_llegada"),
      origen: texto(g, "origen"),
      destino: texto(g, "destino"),
      distanciaKm: num(g.distancia_km),
      conductor: texto(g, "conductor"),
      autorizacion: texto(g, "autorizacion"),
      estado: texto(g, "estado"),
      responsable: texto(g, "responsable"),
      strixRecorridos: num(g.strix_recorridos),
      strixKm: num(g.strix_km),
      strixHorasMarcha: num(g.strix_horas_marcha),
      strixHorasRalenti: num(g.strix_horas_ralenti),
      strixVelocidadMaxima: num(g.strix_velocidad_maxima),
      strixExcesos: num(g.strix_excesos),
      checklistId: num(g.checklist_id),
      checklistApto: typeof g.checklist_apto === "boolean" ? g.checklist_apto : null,
      checklistEn: texto(g, "checklist_en"),
      checklistUsuario: texto(g, "checklist_usuario"),
    })),
    strix: {
      vinculados: Number(s.vinculados) || 0,
      km: num(s.km),
      horasMarcha: num(s.horas_marcha),
      horasRalenti: num(s.horas_ralenti),
      velocidadMaxima: num(s.velocidad_maxima),
      excesos: num(s.excesos),
    },
  };
}

/** Resumen del parte. undefined mientras carga; null si no existe o no se puede ver. */
export function useResumenParte(id: string) {
  const [resumen, setResumen] = useState<ResumenParte | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let activo = true;
    getSupabase().rpc("resumen_parte", { p_id: id }).then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(mensajeDeError(fallo));
        setResumen(null);
        return;
      }
      setError("");
      setResumen(aResumen(data));
    });
    return () => { activo = false; };
  }, [id]);

  return { resumen, error };
}

/** Equipo de la matriz de riesgos vinculado al vehículo (null si no tiene). */
export function useEquipoDeVehiculo(vehiculoId: string) {
  const [equipoId, setEquipoId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vehiculoId) { setEquipoId(undefined); return; }
    let activo = true;
    setEquipoId(undefined);
    getSupabase().rpc("equipo_riesgo_vehiculo", { p_vehiculo_id: vehiculoId }).then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(mensajeDeError(fallo));
        setEquipoId(null);
        return;
      }
      setError("");
      setEquipoId(typeof data === "string" && data ? data : null);
    });
    return () => { activo = false; };
  }, [vehiculoId]);

  return { equipoId, error };
}

/** Parte en curso del vehículo: el gerenciamiento se vincula a él. undefined mientras carga. */
export interface ParteAbierto { id: string; numero: number; operador: string; clienteId: string; contratoId: string }

export function useParteAbiertoVehiculo(vehiculoId: string) {
  const [parte, setParte] = useState<ParteAbierto | null | undefined>(undefined);

  useEffect(() => {
    if (!vehiculoId) { setParte(undefined); return; }
    let activo = true;
    setParte(undefined);
    getSupabase().rpc("parte_abierto_vehiculo", { p_vehiculo_id: vehiculoId }).then(({ data, error }) => {
      if (!activo) return;
      const f = !error && Array.isArray(data) && isRecord(data[0]) ? data[0] : null;
      setParte(f ? {
        id: texto(f, "id"),
        numero: Number(f.nro_parte),
        operador: texto(f, "operador"),
        clienteId: texto(f, "cliente_id"),
        contratoId: texto(f, "contrato_id"),
      } : null);
    });
    return () => { activo = false; };
  }, [vehiculoId]);

  return parte;
}
