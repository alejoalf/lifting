import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { aDocChecklist, type DocChecklist, type EstadoItem, type PrecargaVehiculo, type TipoFlota } from "./checklistVehicular";

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
  /** Parte diario que agrupa este trabajo (null si se hizo sin parte en curso). */
  parteId: string | null;
  checklistId: number | null;
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

export type { EstadoItem } from "./checklistVehicular";

export interface ItemChecklist {
  /** Id del control en la plantilla (los checklists viejos no lo tienen). */
  id?: string;
  item: string;
  paso?: string;
  estado: EstadoItem;
  condicionante?: boolean;
}

/** Fila del paso 6 (neumáticos). */
export interface NeumaticoChecklist {
  eje: string;
  presion: string;
  estado: "bueno" | "regular" | "malo";
  caracteristica: string;
  dimension: string;
  /** Ejes: ajuste de tuercas y check point. Auxilio: soporte. */
  tuercas?: "si" | "no";
  checkpoint?: "si" | "no";
  soporte?: "si" | "no";
}

export interface EncabezadoChecklist {
  lugar: string;
  horometro: string;
  semiMillaje: string;
  companero: string;
}

export interface Checklist {
  id: number;
  creadoPor: string;
  usuario: string;
  creadoEn: string;
  fechaCarga: string;
  vehiculo: string;
  vehiculoId: string | null;
  tipoFlota: TipoFlota | null;
  conductor: string;
  km: number | null;
  items: ItemChecklist[];
  apto: boolean;
  /** Motivos por los que la unidad quedó no apta (los calcula la base). */
  fallas: string[];
  observaciones: string;
  encabezado: Partial<EncabezadoChecklist>;
  neumaticos: NeumaticoChecklist[];
  /** Copia de los datos precargados al momento del checklist. */
  precargaVehiculo: Partial<PrecargaVehiculo> | null;
  /** DNI y legajo del conductor al momento del checklist. */
  conductorDatos: { dni: string; nroLegajo: string } | null;
  /** Documentos (Legajo y Flota) tal como estaban al guardar el checklist. */
  documentos: DocChecklist[];
  observacionesPasos: Record<string, string>;
  /** Checklists anteriores a la unificación de documentos. */
  precargaConductorVieja: Record<string, unknown> | null;
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
    parteId: idOpcional(f.parte_id),
    checklistId: numero(f.checklist_id),
  };
}

function aChecklist(f: Fila): Checklist {
  const objeto = (valor: unknown) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Fila : null);
  const datos = objeto(f.datos) ?? {};
  return {
    id: Number(f.id),
    creadoPor: txt(f.creado_por),
    usuario: txt(f.usuario),
    creadoEn: txt(f.created_at),
    fechaCarga: txt(f.fecha),
    vehiculo: txt(f.vehiculo),
    vehiculoId: idOpcional(f.vehiculo_id),
    tipoFlota: f.tipo_flota === "Pesada" || f.tipo_flota === "Liviana" ? f.tipo_flota : null,
    conductor: txt(f.conductor),
    km: f.km === null || f.km === undefined ? null : Number(f.km),
    items: Array.isArray(f.items) ? (f.items as ItemChecklist[]) : [],
    apto: f.apto === true,
    fallas: Array.isArray(f.fallas) ? f.fallas.map(String) : [],
    observaciones: txt(f.observaciones),
    encabezado: (objeto(datos.encabezado) ?? {}) as Partial<EncabezadoChecklist>,
    neumaticos: Array.isArray(datos.neumaticos) ? (datos.neumaticos as NeumaticoChecklist[]) : [],
    precargaVehiculo: objeto(datos.precarga_vehiculo) as Partial<PrecargaVehiculo> | null,
    conductorDatos: objeto(datos.conductor)
      ? { dni: txt(objeto(datos.conductor)?.dni), nroLegajo: txt(objeto(datos.conductor)?.nro_legajo) }
      : null,
    documentos: Array.isArray(datos.documentos) ? (datos.documentos as Fila[]).map(aDocChecklist) : [],
    observacionesPasos: (objeto(datos.observaciones_pasos) ?? {}) as Record<string, string>,
    precargaConductorVieja: objeto(datos.precarga_conductor),
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

/** La base vincula el checklist y, si no se indica parte, el parte en curso del vehículo. */
export function crearGerenciamiento(g: Omit<Gerenciamiento, "id" | "creadoPor" | "creadoPorNombre" | "creadoEn" | "autorizacion" | "responsable" | "estado" | "strix" | "checklistId">) {
  return insertar("gerenciamientos", "gerenciamientos", {
    parte_id: g.parteId,
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

/** La base completa conductor, dominio, tipo de flota y la copia de la precarga, y recalcula apto y fallas. */
export function crearChecklist(c: {
  vehiculoId: string;
  km: number | null;
  items: ItemChecklist[];
  neumaticos: NeumaticoChecklist[];
  encabezado: EncabezadoChecklist;
  observaciones: string;
  /** Observaciones propias de un paso (ej. paso 7). */
  observacionesPasos: Record<string, string>;
  /** Claves de documentos marcados "No aplica" (la base solo acepta los que lo admiten). */
  docsNa: string[];
}) {
  return insertar("checklists", "checklists", {
    vehiculo_id: c.vehiculoId,
    vehiculo: "",
    conductor: "",
    km: c.km,
    items: c.items,
    datos: { encabezado: c.encabezado, neumaticos: c.neumaticos, observaciones_pasos: c.observacionesPasos, docs_na: c.docsNa },
    observaciones: c.observaciones || null,
    apto: false,
  });
}

// ---------- Borrar registros cargados por error (la base valida quién puede) ----------

async function eliminar(funcion: string, id: number | string) {
  const { error } = await getSupabase().rpc(funcion, { p_id: id });
  if (error) throw new Error(error.message);
}

export const eliminarChecklist = (id: number) => eliminar("eliminar_checklist", id);
export const eliminarGerenciamiento = (id: number) => eliminar("eliminar_gerenciamiento", id);
export const eliminarObservacion = (id: number) => eliminar("eliminar_observacion", id);
export const eliminarParteDiario = (id: string) => eliminar("eliminar_parte_diario", id);

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
