// Tipos y utilidades compartidas: semáforo documental, partes diarios y formato de fechas.
// Los datos viven en Supabase (ver usePartes, operaciones, notificaciones, flota, legajos...).

export type Semaforo = "vigente" | "por-vencer" | "vencido";

/**
 * VIGENTE: más de 15 días. POR VENCER: de 0 a 15 días (un documento que vence hoy sigue valiendo todo el día).
 * VENCIDO: la fecha ya pasó. Es la misma regla que usa la base para el parte, el checklist y el gerenciamiento.
 */
export function semaforoDe(vencimiento: string): Semaforo {
  const dias = Math.round((new Date(`${vencimiento}T00:00:00`).getTime() - new Date(`${hoy()}T00:00:00`).getTime()) / 86_400_000);
  return dias < 0 ? "vencido" : dias <= 15 ? "por-vencer" : "vigente";
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
