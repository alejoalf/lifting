import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// Gerenciamientos de viaje, checklists vehiculares y tarjetas de observación (Supabase).
// La base completa autor, fechas y estado al crear; los cambios de estado van por RPC.

export interface Gerenciamiento {
  id: number;
  creadoPor: string;
  creadoPorNombre: string;
  creadoEn: string;
  fechaSalida: string;
  horaSalida: string;
  fechaLlegada: string;
  horaLlegada: string;
  vehiculo: string;
  conductor: string;
  conductor2: string;
  origen: string;
  destino: string;
  distanciaKm: number;
  telefono: string;
  linea: string;
  radioactivo: boolean;
  pasajeros: boolean;
  motivo: string;
  rutas: string;
  autorizacion: "pendiente" | "autorizado";
  responsable: string;
  estado: "abierto" | "cerrado";
  /** Vehículo de la flota, cliente y contrato a los que se factura el viaje. */
  vehiculoId: string | null;
  clienteId: string | null;
  contratoId: string | null;
  strix: DatosStrix | null;
}

/** Totales de Strix para el horario del gerenciamiento (ver vincular_strix en la base). */
export interface DatosStrix {
  recorridos: number;
  km: number | null;
  horasMarcha: number | null;
  horasRalenti: number | null;
  velocidadMaxima: number | null;
  excesos: number | null;
  inicio: string;
  fin: string;
  vinculadoEn: string;
  /** Registros diarios usados (incluyen todo lo que el vehículo hizo esos días). */
  dias: number;
  /** Registros repartidos con otros viajes del mismo vehículo. */
  compartidos: number;
  /** Registros cargados a mano. */
  manuales: number;
}

export type EstadoItem = "bien" | "mal" | "na";
export interface ItemChecklist { item: string; estado: EstadoItem }

export interface Checklist {
  id: number;
  creadoPor: string;
  usuario: string;
  creadoEn: string;
  fechaCarga: string;
  vehiculo: string;
  conductor: string;
  km: number | null;
  items: ItemChecklist[];
  apto: boolean;
  observaciones: string;
}

export interface Observacion {
  id: number;
  creadoPor: string;
  reportadoPor: string;
  tipos: string[];
  observador: string;
  sectorObservador: string;
  fechaDeteccion: string;
  fechaCarga: string;
  distrito: string;
  sector: string;
  cliente: string;
  lugar: string;
  descripcion: string;
  accion: string;
  riesgo: "Bajo" | "Medio" | "Alto";
  seguimiento: boolean;
  estado: "abierta" | "cerrada";
}

export const TIPOS_OBSERVACION = ["Acto Inseguro", "Condición Insegura", "Práctica Segura", "Detención de Tareas"];

/** Controles del checklist pre-uso. Cada uno se marca Bien, Mal o No aplica. */
export const ITEMS_CHECKLIST = [
  "Documentación del vehículo a bordo",
  "Luces (posición, bajas, altas, freno, giro y retroceso)",
  "Neumáticos y rueda de auxilio",
  "Frenos de servicio y de mano",
  "Niveles (aceite, refrigerante y líquido de frenos)",
  "Pérdidas de fluidos",
  "Limpiaparabrisas y espejos",
  "Carrocería y vidrios",
  "Cinturones de seguridad",
  "Bocina y alarma de retroceso",
  "Matafuego (carga y vencimiento)",
  "Botiquín, balizas y chaleco reflectivo",
  "Hidrogrúa / barquilla (si corresponde)",
];

type Fila = Record<string, unknown>;
const txt = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));
const hora = (valor: unknown) => txt(valor).slice(0, 5);
const numero = (valor: unknown) => (valor === null || valor === undefined || valor === "" ? null : Number(valor));
const idOpcional = (valor: unknown) => (valor === null || valor === undefined ? null : String(valor));

function aDatosStrix(f: Fila): DatosStrix | null {
  if (f.strix_vinculado_en === null || f.strix_vinculado_en === undefined) return null;
  return {
    recorridos: Number(f.strix_recorridos) || 0,
    km: numero(f.strix_km),
    horasMarcha: numero(f.strix_horas_marcha),
    horasRalenti: numero(f.strix_horas_ralenti),
    velocidadMaxima: numero(f.strix_velocidad_maxima),
    excesos: numero(f.strix_excesos),
    inicio: txt(f.strix_inicio),
    fin: txt(f.strix_fin),
    vinculadoEn: txt(f.strix_vinculado_en),
    dias: Number(f.strix_dias) || 0,
    compartidos: Number(f.strix_compartidos) || 0,
    manuales: Number(f.strix_manuales) || 0,
  };
}

function aGerenciamiento(f: Fila): Gerenciamiento {
  return {
    id: Number(f.id),
    creadoPor: txt(f.creado_por),
    creadoPorNombre: txt(f.creado_por_nombre),
    creadoEn: txt(f.created_at),
    fechaSalida: txt(f.fecha_salida),
    horaSalida: hora(f.hora_salida),
    fechaLlegada: txt(f.fecha_llegada),
    horaLlegada: hora(f.hora_llegada),
    vehiculo: txt(f.vehiculo),
    conductor: txt(f.conductor),
    conductor2: txt(f.conductor2),
    origen: txt(f.origen),
    destino: txt(f.destino),
    distanciaKm: Number(f.distancia_km),
    telefono: txt(f.telefono),
    linea: txt(f.linea),
    radioactivo: f.radioactivo === true,
    pasajeros: f.pasajeros === true,
    motivo: txt(f.motivo),
    rutas: txt(f.rutas),
    autorizacion: f.autorizacion === "autorizado" ? "autorizado" : "pendiente",
    responsable: txt(f.responsable),
    estado: f.estado === "cerrado" ? "cerrado" : "abierto",
    vehiculoId: idOpcional(f.vehiculo_id),
    clienteId: idOpcional(f.cliente_id),
    contratoId: idOpcional(f.contrato_id),
    strix: aDatosStrix(f),
  };
}

function aChecklist(f: Fila): Checklist {
  return {
    id: Number(f.id),
    creadoPor: txt(f.creado_por),
    usuario: txt(f.usuario),
    creadoEn: txt(f.created_at),
    fechaCarga: txt(f.fecha),
    vehiculo: txt(f.vehiculo),
    conductor: txt(f.conductor),
    km: f.km === null || f.km === undefined ? null : Number(f.km),
    items: Array.isArray(f.items) ? (f.items as ItemChecklist[]) : [],
    apto: f.apto === true,
    observaciones: txt(f.observaciones),
  };
}

function aObservacion(f: Fila): Observacion {
  return {
    id: Number(f.id),
    creadoPor: txt(f.creado_por),
    reportadoPor: txt(f.reportado_por),
    tipos: Array.isArray(f.tipos) ? f.tipos.map(String) : [],
    observador: txt(f.observador),
    sectorObservador: txt(f.sector_observador),
    fechaDeteccion: txt(f.fecha_deteccion),
    fechaCarga: txt(f.fecha_carga),
    distrito: txt(f.distrito),
    sector: txt(f.sector),
    cliente: txt(f.cliente),
    lugar: txt(f.lugar),
    descripcion: txt(f.descripcion),
    accion: txt(f.accion),
    riesgo: (["Bajo", "Medio", "Alto"].includes(txt(f.riesgo)) ? f.riesgo : "Bajo") as Observacion["riesgo"],
    seguimiento: f.seguimiento === true,
    estado: f.estado === "cerrada" ? "cerrada" : "abierta",
  };
}

function mensaje(error: { message: string }, queCosa: string) {
  if (/does not exist|schema cache/i.test(error.message)) {
    return `No se encontró la tabla de ${queCosa}. Verificá que la migración de gerenciamientos, checklists y observaciones esté aplicada.`;
  }
  return error.message;
}

/** Carga una tabla ordenada por id descendente (lo más nuevo primero). */
function useTabla<T>(tabla: string, queCosa: string, convertir: (fila: Fila) => T) {
  const [filas, setFilas] = useState<T[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const { data, error: fallo } = await getSupabase().from(tabla).select("*").order("id", { ascending: false });
    if (fallo) setError(mensaje(fallo, queCosa));
    else {
      setFilas((data ?? []).map(convertir));
      setError("");
    }
  }, [tabla, queCosa, convertir]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { filas, error, refresh };
}

export const useGerenciamientos = () => useTabla("gerenciamientos", "gerenciamientos", aGerenciamiento);
export const useChecklists = () => useTabla("checklists", "checklists", aChecklist);
export const useObservaciones = () => useTabla("observaciones", "tarjetas de observación", aObservacion);

async function insertar(tabla: string, queCosa: string, datos: Fila) {
  const { data, error } = await getSupabase().from(tabla).insert(datos).select("id").single();
  if (error) throw new Error(mensaje(error, queCosa));
  return Number(data.id);
}

async function rpc(nombre: string, id: number) {
  const { error } = await getSupabase().rpc(nombre, { p_id: id });
  if (error) throw new Error(error.message);
}

export function crearGerenciamiento(g: Omit<Gerenciamiento, "id" | "creadoPor" | "creadoPorNombre" | "creadoEn" | "autorizacion" | "responsable" | "estado" | "strix">) {
  return insertar("gerenciamientos", "gerenciamientos", {
    vehiculo_id: g.vehiculoId,
    cliente_id: g.clienteId,
    contrato_id: g.contratoId,
    fecha_salida: g.fechaSalida,
    hora_salida: g.horaSalida,
    fecha_llegada: g.fechaLlegada,
    hora_llegada: g.horaLlegada,
    vehiculo: g.vehiculo,
    conductor: g.conductor,
    conductor2: g.conductor2 || null,
    origen: g.origen,
    destino: g.destino,
    distancia_km: g.distanciaKm,
    telefono: g.telefono,
    linea: g.linea,
    radioactivo: g.radioactivo,
    pasajeros: g.pasajeros,
    motivo: g.motivo,
    rutas: g.rutas,
  });
}

export const autorizarGerenciamiento = (id: number) => rpc("autorizar_gerenciamiento", id);
export const cerrarGerenciamiento = (id: number) => rpc("cerrar_gerenciamiento", id);

/** Supervisor o Admin: corrige vehículo, cliente y contrato de un gerenciamiento (recalcula Strix). */
export async function asignarFacturacionGerenciamiento(id: number, vehiculoId: string | null, clienteId: string | null, contratoId: string | null) {
  const { error } = await getSupabase().rpc("asignar_facturacion_gerenciamiento", {
    p_id: id, p_vehiculo_id: vehiculoId, p_cliente_id: clienteId, p_contrato_id: contratoId,
  });
  if (error) throw new Error(error.message);
}

export function crearChecklist(c: Pick<Checklist, "vehiculo" | "conductor" | "km" | "items" | "observaciones">) {
  return insertar("checklists", "checklists", {
    vehiculo: c.vehiculo,
    conductor: c.conductor,
    km: c.km,
    items: c.items,
    observaciones: c.observaciones || null,
    apto: !c.items.some((i) => i.estado === "mal"), // la base lo recalcula
  });
}

export function crearObservacion(o: Omit<Observacion, "id" | "creadoPor" | "reportadoPor" | "fechaCarga" | "estado">) {
  return insertar("observaciones", "tarjetas de observación", {
    tipos: o.tipos,
    observador: o.observador,
    sector_observador: o.sectorObservador,
    fecha_deteccion: o.fechaDeteccion,
    distrito: o.distrito,
    sector: o.sector,
    cliente: o.cliente || null,
    lugar: o.lugar,
    descripcion: o.descripcion,
    accion: o.accion || null,
    riesgo: o.riesgo,
    seguimiento: o.seguimiento,
  });
}

export const cerrarObservacion = (id: number) => rpc("cerrar_observacion", id);
