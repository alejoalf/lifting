import { useSyncExternalStore } from "react";

// Almacenamiento PROVISORIO en el navegador (localStorage) para las pantallas de
// partes diarios, gerenciamientos, checklist, observaciones y notificaciones.
// Cuando existan las tablas en Supabase, reemplazar leer/guardar por consultas
// reales: las pantallas solo usan useColeccion, agregar y actualizar.

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
}

export type Semaforo = "vigente" | "por-vencer" | "vencido";

/** Tabla 8 de la especificación: legajo documental de vehículos y operadores. */
export interface Documento {
  id: number;
  entidad: "vehiculo" | "operador";
  /** Dominio normalizado del vehículo, o id de usuario del operador. */
  entidadId: string;
  entidadNombre: string;
  tipo: string;
  vencimiento: string;
  archivoNombre: string;
  cargadoPor: string;
  cargadoEn: string;
}

export const TIPOS_DOC_VEHICULO = ["Seguro", "RTO / VTV", "Habilitación técnica hidrogrúa TKA", "Habilitación técnica barquilla Axion"];
export const TIPOS_DOC_OPERADOR = ["Licencia de conducir", "Psicofísico", "Manejo defensivo"];

export function normalizarDominio(dominio: string) {
  return dominio.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** VIGENTE: más de 15 días. POR VENCER: 15 días o menos. VENCIDO: vence hoy o ya venció. */
export function semaforoDe(vencimiento: string): Semaforo {
  const dias = Math.round((new Date(`${vencimiento}T00:00:00`).getTime() - new Date(`${hoy()}T00:00:00`).getTime()) / 86_400_000);
  return dias <= 0 ? "vencido" : dias <= 15 ? "por-vencer" : "vigente";
}

/** Documentos que cuentan para una entidad: por cada tipo, solo el de vencimiento más lejano (la renovación). */
export function documentosDe(documentos: Documento[], entidad: Documento["entidad"], entidadId: string) {
  const porTipo = new Map<string, Documento>();
  for (const d of documentos) {
    if (d.entidad !== entidad || d.entidadId !== entidadId) continue;
    const actual = porTipo.get(d.tipo);
    if (!actual || d.vencimiento > actual.vencimiento) porTipo.set(d.tipo, d);
  }
  return [...porTipo.values()];
}

/** El peor estado de un grupo de documentos, o null si no hay ninguno cargado. */
export function peorSemaforo(documentos: Documento[]): Semaforo | null {
  const estados = documentos.map((d) => semaforoDe(d.vencimiento));
  return estados.includes("vencido") ? "vencido" : estados.includes("por-vencer") ? "por-vencer" : estados.length ? "vigente" : null;
}

/** Tabla 9 de la especificación. "frenado" es la respuesta negativa de Base a una excepción. */
export type EstadoParte = "pendiente" | "excepcion" | "en_curso" | "frenado" | "cerrado";

export interface Parte {
  id: string;
  numero: number;
  creadoPor: string;
  operador: string;
  creadoEn: string;
  fecha: string;
  cliente: string;
  contrato: string;
  vehiculo: string;
  tarea: string;
  origen: string;
  destino: string;
  kmInicial: number;
  observaciones: string;
  /** Semáforo documental al abrir el parte (null = sin documentos cargados). */
  semaforo: Semaforo | null;
  documentosVencidos: string[];
  estado: EstadoParte;
  /** Quién autorizó o frenó la excepción. */
  resueltoPor: string;
  resueltoEn: string;
  motivoFreno: string;
  salidaEn: string;
  cerradoEn: string;
  kmFinal: number | null;
  horasDeclaradas: number | null;
  trabajoRealizado: string;
  firmadoPor: string;
  firmadoEn: string;
}

export const ESTADOS_PARTE: Record<EstadoParte, string> = {
  pendiente: "Pendiente de control documental",
  excepcion: "Excepción pendiente",
  en_curso: "En curso",
  frenado: "Unidad frenada",
  cerrado: "Cerrado",
};

export interface Notificacion {
  id: number;
  /** id del usuario destinatario, "rol:supervisor" (supervisores y administradores) o "rol:admin". */
  para: string;
  titulo: string;
  mensaje: string;
  /** Ruta de la app a la que lleva la notificación. */
  enlace: string;
  fecha: string;
  leida: boolean;
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

export interface Checklist {
  id: number;
  vehiculo: string;
  conductor: string;
  fechaCarga: string;
  usuario: string;
}

interface Colecciones {
  gerenciamientos: Gerenciamiento;
  observaciones: Observacion;
  checklists: Checklist;
  documentos: Documento;
  notificaciones: Notificacion;
}

type Clave = keyof Colecciones;

const PREFIJO = "lp:";
const cache = new Map<string, unknown[]>();
const oyentes = new Set<() => void>();

function leer<K extends Clave>(clave: K): Colecciones[K][] {
  let filas = cache.get(clave) as Colecciones[K][] | undefined;
  if (!filas) {
    try {
      const guardado = JSON.parse(localStorage.getItem(PREFIJO + clave) ?? "[]");
      filas = Array.isArray(guardado) ? guardado : [];
    } catch {
      filas = [];
    }
    cache.set(clave, filas);
  }
  return filas;
}

function guardar<K extends Clave>(clave: K, filas: Colecciones[K][]) {
  cache.set(clave, filas);
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(filas));
  } catch {
    // Sin almacenamiento disponible: los datos quedan solo en memoria.
  }
  oyentes.forEach((avisar) => avisar());
}

function suscribir(avisar: () => void) {
  oyentes.add(avisar);
  return () => { oyentes.delete(avisar); };
}

export function useColeccion<K extends Clave>(clave: K): Colecciones[K][] {
  return useSyncExternalStore(suscribir, () => leer(clave));
}

export function agregar<K extends Clave>(clave: K, fila: Omit<Colecciones[K], "id">): Colecciones[K] {
  const filas = leer(clave);
  const id = filas.reduce((mayor, f) => Math.max(mayor, f.id), 0) + 1;
  const nueva = { ...fila, id } as Colecciones[K];
  guardar(clave, [nueva, ...filas]);
  return nueva;
}

export function actualizar<K extends Clave>(clave: K, id: number, cambios: Partial<Colecciones[K]>) {
  guardar(clave, leer(clave).map((f) => (f.id === id ? { ...f, ...cambios } : f)));
}

export const PARA_SUPERVISORES = "rol:supervisor";

/** El Titular: quien resuelve las excepciones documentales. */
export const PARA_ADMINS = "rol:admin";

export function esPara(n: Notificacion, usuario: { id: string; rol: string } | null) {
  if (!usuario) return false;
  if (n.para === usuario.id) return true;
  if (n.para === PARA_ADMINS) return usuario.rol === "admin";
  return n.para === PARA_SUPERVISORES && (usuario.rol === "supervisor" || usuario.rol === "admin");
}

// Cada notificación equivale a un aviso que más adelante también saldrá por mail.
export function notificar(para: string, titulo: string, mensaje: string, enlace: string) {
  agregar("notificaciones", { para, titulo, mensaje, enlace, fecha: new Date().toISOString(), leida: false });
}

export function marcarNotificacionesLeidas(usuario: { id: string; rol: string }) {
  guardar("notificaciones", leer("notificaciones").map((n) => (esPara(n, usuario) ? { ...n, leida: true } : n)));
}

/** Fecha local de hoy en formato AAAA-MM-DD (el que usa <input type="date">). */
export function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** AAAA-MM-DD -> DD/MM/AAAA */
export function formatFecha(fecha: string) {
  const [a, m, d] = fecha.split("-");
  return a && m && d ? `${d}/${m}/${a}` : fecha;
}

export function formatFechaHora(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${hora} hs.`;
}

export function contiene(texto: string, busqueda: string) {
  return texto.toLocaleLowerCase("es").includes(busqueda.trim().toLocaleLowerCase("es"));
}
