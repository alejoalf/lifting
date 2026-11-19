import { useCallback, useEffect, useState } from "react";
import type { CellObject } from "xlsx";
import { getSupabase } from "./supabase";

// Integración con Strix (telemetría). Mientras no haya API, o si la API no
// responde, los datos entran de dos formas:
//   * Importando el reporte que exporta Strix (Excel o CSV). Se aceptan dos tipos:
//       - diario por vehículo (KMTS_RECORRIDOS): una fila por vehículo y día;
//       - por recorrido: una fila por viaje con hora de inicio y fin.
//   * Cargando a mano el total de un vehículo en un día.
// Cuando haya API, cargará las mismas columnas de strix_recorridos con fuente
// "api" y todo lo demás seguirá funcionando igual.

// ---------- Lectura del archivo ----------

/** Lee un CSV (separado por ";", "," o tabulación; con comillas) y devuelve todas sus filas. */
export function leerCsv(contenido: string): string[][] {
  const texto = contenido.replace(/^﻿/, "");
  const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? "";
  const separador = [";", "\t", ","].reduce((mejor, candidato) =>
    primeraLinea.split(candidato).length > primeraLinea.split(mejor).length ? candidato : mejor, ";");

  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === separador) { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      if (fila.some((v) => v.trim() !== "")) filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((v) => v.trim() !== "")) filas.push(fila);
  return filas;
}

async function leerTexto(archivo: File) {
  const bytes = await archivo.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Los CSV que guarda Excel en español suelen venir en Windows-1252.
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Texto de una celda de Excel. Los números se devuelven sin separador de miles,
 * las fechas como AAAA-MM-DD [hh:mm:ss] y los tiempos como h:mm:ss, para que la
 * lectura no dependa del formato regional con el que se guardó la planilla.
 */
function textoCelda(celda: CellObject | undefined, ssf: { is_date: (f: string) => boolean; parse_date_code: (v: number) => { y: number; m: number; d: number; H: number; M: number; S: number } }) {
  if (!celda || celda.t === "z" || celda.t === "e") return "";
  if (celda.t === "n" && typeof celda.v === "number") {
    const formato = typeof celda.z === "string" ? celda.z : "";
    if (formato && ssf.is_date(formato)) {
      const limpio = formato.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, (b) => (/^\[[hms]+\]$/i.test(b) ? b : ""));
      if (/[dy]/i.test(limpio)) {
        const p = ssf.parse_date_code(celda.v);
        const fecha = `${p.y}-${dos(p.m)}-${dos(p.d)}`;
        return celda.v % 1 ? `${fecha} ${dos(p.H)}:${dos(p.M)}:${dos(p.S)}` : fecha;
      }
      // Hora o duración (fracción de día).
      const segundos = Math.round(celda.v * 86400);
      return `${Math.floor(segundos / 3600)}:${dos(Math.floor((segundos % 3600) / 60))}:${dos(segundos % 60)}`;
    }
    return String(celda.v);
  }
  if (celda.t === "d" && celda.v instanceof Date) {
    const f = celda.v;
    return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())} ${dos(f.getHours())}:${dos(f.getMinutes())}:${dos(f.getSeconds())}`;
  }
  if (celda.t === "b") return celda.v ? "1" : "0";
  return String(celda.v ?? celda.w ?? "");
}

/** Filas de la primera hoja con datos de un Excel (.xlsx, .xls) u OpenDocument (.ods). */
async function leerPlanilla(archivo: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellNF: true, cellDates: false });
  for (const nombre of libro.SheetNames) {
    const hoja = libro.Sheets[nombre];
    if (!hoja?.["!ref"]) continue;
    const rango = XLSX.utils.decode_range(hoja["!ref"]);
    const filas: string[][] = [];
    for (let r = rango.s.r; r <= rango.e.r; r++) {
      const fila: string[] = [];
      for (let c = rango.s.c; c <= rango.e.c; c++) {
        fila.push(textoCelda(hoja[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined, XLSX.SSF));
      }
      if (fila.some((v) => v.trim() !== "")) filas.push(fila);
    }
    if (filas.length > 1) return filas;
  }
  return [];
}

export class ArchivoNoSoportado extends Error {}

/** Lee el reporte de Strix (Excel, OpenDocument o CSV) y devuelve todas sus filas. */
export async function leerReporte(archivo: File): Promise<string[][]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".pdf")) {
    throw new ArchivoNoSoportado(
      "El PDF no se puede leer de forma confiable: al imprimir, Excel corta las celdas largas y parte las columnas en varias páginas. " +
      "Descargá el mismo reporte de Strix en Excel y subí ese archivo, o cargá los datos en «Carga manual».");
  }
  if (/\.(xlsx|xlsm|xls|ods)$/.test(nombre)) return leerPlanilla(archivo);
  return leerCsv(await leerTexto(archivo));
}

// ---------- Columnas del reporte ----------

export type CampoStrix =
  | "dominio" | "fecha" | "inicio" | "fin" | "km"
  | "contacto" | "marcha" | "ralenti" | "velocidad_maxima" | "excesos"
  | "origen" | "destino" | "conductor";

export interface DefinicionCampo { campo: CampoStrix; titulo: string; obligatorio: boolean; ayuda?: string; pistas: RegExp }

/** En el orden en que se muestran. */
export const CAMPOS_STRIX: DefinicionCampo[] = [
  { campo: "dominio", titulo: "Dominio / patente", obligatorio: true, ayuda: "En el reporte de Strix es la columna «Entidad».", pistas: /dominio|patente|entidad|alias|unidad|m[oó]vil|veh[ií]c/i },
  { campo: "fecha", titulo: "Fecha", obligatorio: false, ayuda: "Reporte diario: una fila por vehículo y día. En Strix es «Fecha GPS».", pistas: /^fecha|^d[ií]a$/i },
  { campo: "inicio", titulo: "Inicio del recorrido", obligatorio: false, ayuda: "Solo en reportes por recorrido. Fecha y hora, o la hora si la fecha viene aparte.", pistas: /inicio|desde|salida|partida|comienzo/i },
  { campo: "fin", titulo: "Fin del recorrido", obligatorio: false, ayuda: "Solo en reportes por recorrido.", pistas: /fin$|fin |hasta|llegada|final|termin/i },
  { campo: "km", titulo: "Kilómetros recorridos", obligatorio: true, ayuda: "En Strix es «Distancia recorrida».", pistas: /km|kil[oó]metr|distancia|recorrid/i },
  { campo: "contacto", titulo: "Tiempo en contacto (motor encendido)", obligatorio: false, pistas: /tiempo.*contacto|contacto total|encendid/i },
  { campo: "marcha", titulo: "Tiempo en movimiento", obligatorio: false, ayuda: "En Strix es «En contacto en movimiento».", pistas: /en movimiento|marcha|conducci|manejo/i },
  { campo: "ralenti", titulo: "Tiempo detenido con motor encendido (ralentí)", obligatorio: false, ayuda: "En Strix es «En contacto sin movimiento». Para hidrogrúa o barquilla es el tiempo de trabajo con toma de fuerza.", pistas: /sin movimiento|ralent|detenid|toma de fuerza|pto/i },
  { campo: "velocidad_maxima", titulo: "Velocidad máxima", obligatorio: false, pistas: /vel.*m[aá]x|m[aá]x.*vel/i },
  { campo: "excesos", titulo: "Cantidad de excesos de velocidad", obligatorio: false, pistas: /exceso/i },
  { campo: "origen", titulo: "Origen", obligatorio: false, pistas: /origen|direcci[oó]n inicio/i },
  { campo: "destino", titulo: "Destino", obligatorio: false, pistas: /destino|direcci[oó]n fin/i },
  { campo: "conductor", titulo: "Conductor", obligatorio: false, pistas: /conductor|chofer|driver/i },
];

/** Orden en que se buscan las columnas (los más específicos primero, para que no se pisen). */
const ORDEN_DETECCION: CampoStrix[] = [
  "dominio", "inicio", "fin", "fecha", "km", "ralenti", "marcha", "contacto",
  "velocidad_maxima", "excesos", "origen", "destino", "conductor",
];

export type UnidadTiempo = "hhmm" | "minutos" | "horas";
export type TipoReporte = "dia" | "recorrido";

export interface Mapeo {
  columnas: Partial<Record<CampoStrix, string>>;
  /** Cómo vienen los tiempos cuando son solo un número. */
  unidadTiempo: UnidadTiempo;
}

/** Reporte diario si hay fecha y no hay inicio/fin; por recorrido si hay inicio y fin. */
export function tipoReporte(mapeo: Mapeo): TipoReporte | null {
  if (mapeo.columnas.inicio && mapeo.columnas.fin) return "recorrido";
  if (mapeo.columnas.fecha) return "dia";
  return null;
}

/** Datos que faltan indicar para poder importar. */
export function faltantes(mapeo: Mapeo): string[] {
  const faltan = CAMPOS_STRIX.filter((c) => c.obligatorio && !mapeo.columnas[c.campo]).map((c) => c.titulo);
  if (!tipoReporte(mapeo)) faltan.push("la fecha (reporte diario) o el inicio y el fin (reporte por recorrido)");
  return faltan;
}

/**
 * Busca la fila de encabezados (puede haber títulos arriba) y devuelve
 * encabezados únicos y las filas de datos.
 */
export function separarEncabezado(filas: string[][]): { encabezados: string[]; filas: string[][]; filaEncabezado: number } {
  let mejor = 0;
  let puntos = 0;
  filas.slice(0, 20).forEach((fila, i) => {
    const coincidencias = fila.filter((celda) => celda.trim() && CAMPOS_STRIX.some((c) => c.pistas.test(celda.trim()))).length;
    if (coincidencias > puntos) { mejor = i; puntos = coincidencias; }
  });
  const usados = new Map<string, number>();
  const encabezados = (filas[mejor] ?? []).map((e, i) => {
    const base = e.trim() || `Columna ${i + 1}`;
    const n = (usados.get(base) ?? 0) + 1;
    usados.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  return { encabezados, filas: filas.slice(mejor + 1), filaEncabezado: mejor + 1 };
}

const CLAVE_MAPEO = "lp:strix-mapeo";

/** Propone qué columna es cada dato a partir de los encabezados (y lo último que se usó). */
export function mapeoInicial(encabezados: string[]): Mapeo {
  let guardado: Mapeo | null = null;
  try {
    guardado = JSON.parse(localStorage.getItem(CLAVE_MAPEO) ?? "null");
  } catch {
    guardado = null;
  }
  const columnas: Mapeo["columnas"] = {};
  const usadas = new Set<string>();
  const anterior = guardado?.columnas ?? {};
  for (const campo of ORDEN_DETECCION) {
    const def = CAMPOS_STRIX.find((c) => c.campo === campo)!;
    const recordada = anterior[campo];
    const elegida = recordada && encabezados.includes(recordada) && !usadas.has(recordada)
      ? recordada
      : encabezados.find((e) => !usadas.has(e) && def.pistas.test(e));
    if (elegida) {
      columnas[campo] = elegida;
      usadas.add(elegida);
    }
  }
  return { columnas, unidadTiempo: guardado?.unidadTiempo ?? "hhmm" };
}

export function recordarMapeo(mapeo: Mapeo) {
  try {
    localStorage.setItem(CLAVE_MAPEO, JSON.stringify(mapeo));
  } catch {
    // Sin almacenamiento: la próxima vez se vuelve a proponer.
  }
}

// ---------- Conversión de valores ----------

/** "1.234,5", "1234.5" o "3,61" -> número. */
export function leerNumero(valor: string): number | null {
  const limpio = valor.replace(/[^\d,.-]/g, "");
  if (!limpio) return null;
  const normalizado = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Tiempo -> minutos. Acepta "h:mm[:ss]", "2 h 5 m 13 s", "1 d 3 h", o un número en la unidad indicada. */
export function leerMinutos(valor: string, unidad: UnidadTiempo): number | null {
  const v = valor.trim();
  if (!v) return null;
  const hhmm = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]) + Number(hhmm[3] ?? 0) / 60;
  const textual = /^(?:(\d+)\s*d(?:[ií]as?)?)?\s*(?:(\d+)\s*h(?:s|oras?)?)?\s*(?:(\d+)\s*m(?:in(?:utos?)?)?)?\s*(?:(\d+)\s*s(?:eg(?:undos?)?)?)?$/i.exec(v);
  if (textual && (textual[1] || textual[2] || textual[3] || textual[4])) {
    return Number(textual[1] ?? 0) * 1440 + Number(textual[2] ?? 0) * 60 + Number(textual[3] ?? 0) + Number(textual[4] ?? 0) / 60;
  }
  const n = leerNumero(v);
  if (n === null) return null;
  return unidad === "horas" ? n * 60 : n;
}

/** Fecha y hora local de Argentina -> ISO con zona (-03:00). Acepta DD/MM/AAAA, DD-MM-AAAA, AAAA-MM-DD y hora opcional. */
export function leerFechaHora(valor: string, fechaAparte = ""): string | null {
  let v = valor.trim();
  if (fechaAparte.trim() && /^\d{1,2}:\d{2}/.test(v)) v = `${fechaAparte.trim()} ${v}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  let anio: number, mes: number, dia: number, h = 0, m = 0, s = 0;
  if (dmy) {
    [dia, mes, anio] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (anio < 100) anio += 2000;
    [h, m, s] = [Number(dmy[4] ?? 0), Number(dmy[5] ?? 0), Number(dmy[6] ?? 0)];
  } else if (ymd) {
    [anio, mes, dia] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    [h, m, s] = [Number(ymd[4] ?? 0), Number(ymd[5] ?? 0), Number(ymd[6] ?? 0)];
  } else return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || h > 23 || m > 59 || s > 59) return null;
  // Descarta fechas que no existen (31/02, 31/04...).
  if (new Date(Date.UTC(anio, mes - 1, dia)).getUTCDate() !== dia) return null;
  return `${anio}-${dos(mes)}-${dos(dia)}T${dos(h)}:${dos(m)}:${dos(s)}-03:00`;
}

/** "AAAA-MM-DD" del día siguiente. */
export function diaSiguiente(fecha: string) {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

export interface RecorridoLeido {
  granularidad: TipoReporte;
  dominio: string;
  /** AAAA-MM-DD, en los registros diarios. */
  fecha: string | null;
  inicio: string;
  fin: string;
  km: number | null;
  minutos_contacto: number | null;
  minutos_marcha: number | null;
  minutos_ralenti: number | null;
  velocidad_maxima: number | null;
  excesos: number | null;
  origen: string;
  destino: string;
  conductor: string;
  datos: Record<string, string>;
}

export interface ResultadoLectura { tipo: TipoReporte; recorridos: RecorridoLeido[]; errores: { fila: number; motivo: string }[] }

/** Si falta uno de los tres tiempos, se calcula con los otros dos. */
function completarTiempos(contacto: number | null, marcha: number | null, ralenti: number | null) {
  const redondo = (n: number) => Math.round(n * 100) / 100;
  if (contacto !== null && marcha !== null && ralenti === null) ralenti = redondo(Math.max(0, contacto - marcha));
  else if (contacto !== null && ralenti !== null && marcha === null) marcha = redondo(Math.max(0, contacto - ralenti));
  else if (contacto === null && marcha !== null && ralenti !== null) contacto = redondo(marcha + ralenti);
  return { contacto, marcha, ralenti };
}

/** Convierte las filas del reporte según el mapeo. Las filas inválidas se informan aparte. */
export function convertirFilas(encabezados: string[], filas: string[][], mapeo: Mapeo, filaEncabezado = 1): ResultadoLectura | null {
  const tipo = tipoReporte(mapeo);
  if (!tipo) return null;
  const indice = (campo: CampoStrix) => {
    const columna = mapeo.columnas[campo];
    return columna ? encabezados.indexOf(columna) : -1;
  };
  const valor = (fila: string[], campo: CampoStrix) => {
    const i = indice(campo);
    return i >= 0 ? (fila[i] ?? "").trim() : "";
  };

  const recorridos: RecorridoLeido[] = [];
  const errores: ResultadoLectura["errores"] = [];
  filas.forEach((fila, n) => {
    const numeroFila = filaEncabezado + n + 1; // como lo numera la planilla
    const dominio = valor(fila, "dominio");
    // Filas de totales al pie del reporte.
    if (/^total/i.test(dominio) || (!dominio && !valor(fila, "km"))) return;
    if (!dominio) return errores.push({ fila: numeroFila, motivo: "sin dominio" });

    let inicio: string | null;
    let fin: string | null;
    let fecha: string | null = null;
    if (tipo === "dia") {
      inicio = leerFechaHora(valor(fila, "fecha"));
      if (!inicio) return errores.push({ fila: numeroFila, motivo: `fecha no reconocida ("${valor(fila, "fecha")}")` });
      fecha = inicio.slice(0, 10);
      inicio = `${fecha}T00:00:00-03:00`;
      fin = `${diaSiguiente(fecha)}T00:00:00-03:00`;
    } else {
      inicio = leerFechaHora(valor(fila, "inicio"), valor(fila, "fecha"));
      fin = leerFechaHora(valor(fila, "fin"), valor(fila, "fecha"));
      if (!inicio) return errores.push({ fila: numeroFila, motivo: `inicio no reconocido ("${valor(fila, "inicio")}")` });
      if (!fin) return errores.push({ fila: numeroFila, motivo: `fin no reconocido ("${valor(fila, "fin")}")` });
      // Recorrido que cruza la medianoche con la fecha en columna aparte: el fin es del día siguiente.
      if (fin < inicio && valor(fila, "fecha")) fin = `${diaSiguiente(fin)}${fin.slice(10)}`;
      if (new Date(fin) < new Date(inicio)) return errores.push({ fila: numeroFila, motivo: "el fin es anterior al inicio" });
    }

    const km = leerNumero(valor(fila, "km"));
    if (km === null) return errores.push({ fila: numeroFila, motivo: `kilómetros no reconocidos ("${valor(fila, "km")}")` });
    if (km < 0) return errores.push({ fila: numeroFila, motivo: "kilómetros negativos" });
    const tiempos = completarTiempos(
      leerMinutos(valor(fila, "contacto"), mapeo.unidadTiempo),
      leerMinutos(valor(fila, "marcha"), mapeo.unidadTiempo),
      leerMinutos(valor(fila, "ralenti"), mapeo.unidadTiempo),
    );
    if (tipo === "dia" && (tiempos.contacto ?? (tiempos.marcha ?? 0) + (tiempos.ralenti ?? 0)) > 1441) {
      return errores.push({ fila: numeroFila, motivo: "los tiempos suman más de 24 horas en un día (revisá el formato de los tiempos)" });
    }

    const excesos = leerNumero(valor(fila, "excesos"));
    recorridos.push({
      granularidad: tipo,
      dominio,
      fecha,
      inicio,
      fin,
      km,
      minutos_contacto: tiempos.contacto,
      minutos_marcha: tiempos.marcha,
      minutos_ralenti: tiempos.ralenti,
      velocidad_maxima: leerNumero(valor(fila, "velocidad_maxima")),
      excesos: excesos === null ? null : Math.round(excesos),
      origen: valor(fila, "origen"),
      destino: valor(fila, "destino"),
      conductor: valor(fila, "conductor"),
      datos: Object.fromEntries(encabezados.map((e, i) => [e, fila[i] ?? ""])),
    });
  });
  return { tipo, recorridos, errores };
}

// ---------- Base de datos ----------

export interface ResultadoImportacion {
  importacion_id: number; filas: number; nuevas: number; actualizadas: number; sin_vehiculo: number; vinculados: number;
}

const LOTE = 500;

/** Importa los registros en lotes. Si un vehículo y período ya estaba cargado, se actualiza con el valor nuevo. */
export async function importarRecorridos(archivo: string, recorridos: RecorridoLeido[]) {
  const total: ResultadoImportacion = { importacion_id: 0, filas: 0, nuevas: 0, actualizadas: 0, sin_vehiculo: 0, vinculados: 0 };
  for (let i = 0; i < recorridos.length; i += LOTE) {
    const parte = recorridos.length > LOTE ? `${archivo} (${i / LOTE + 1})` : archivo;
    const { data, error } = await getSupabase().rpc("importar_strix", { p_archivo: parte, p_filas: recorridos.slice(i, i + LOTE) });
    if (error) throw new Error(error.message);
    const r = (Array.isArray(data) ? data[0] : data) as ResultadoImportacion;
    total.importacion_id = r.importacion_id;
    total.filas += r.filas;
    total.nuevas += r.nuevas;
    total.actualizadas += r.actualizadas ?? 0;
    total.sin_vehiculo += r.sin_vehiculo;
    total.vinculados = Math.max(total.vinculados, r.vinculados);
  }
  return total;
}

export interface CargaManual {
  vehiculoId: string;
  fecha: string;
  km: number;
  minutosMarcha: number | null;
  minutosRalenti: number | null;
  observacion: string;
}

/** Carga o reemplaza el total de un vehículo en un día. Devuelve true si reemplazó un dato existente. */
export async function cargarManual(c: CargaManual) {
  const { data, error } = await getSupabase().rpc("cargar_strix_manual", {
    p_vehiculo_id: c.vehiculoId,
    p_fecha: c.fecha,
    p_km: c.km,
    p_minutos_marcha: c.minutosMarcha,
    p_minutos_ralenti: c.minutosRalenti,
    p_observacion: c.observacion,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function eliminarRecorrido(id: number) {
  const { error } = await getSupabase().rpc("eliminar_recorrido_strix", { p_id: id });
  if (error) throw new Error(error.message);
}

export async function vincularStrix(desde: string | null, hasta: string | null) {
  const { data, error } = await getSupabase().rpc("vincular_strix", { p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function revincularSinVehiculo() {
  const { data, error } = await getSupabase().rpc("revincular_recorridos_sin_vehiculo");
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function eliminarImportacion(id: number) {
  const { error } = await getSupabase().from("strix_importaciones").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface Importacion {
  id: number; archivo: string; filas: number; nuevas: number; actualizadas: number; sin_vehiculo: number; created_at: string;
}

export type FuenteStrix = "archivo" | "email" | "api" | "manual";
export const FUENTES: Record<FuenteStrix, string> = { archivo: "Reporte", email: "Email", api: "API", manual: "Manual" };

export interface Recorrido {
  id: number;
  fuente: FuenteStrix;
  granularidad: TipoReporte;
  dominio: string;
  vehiculo_id: string | null;
  fecha: string | null;
  inicio: string;
  fin: string;
  km: number | null;
  minutos_contacto: number | null;
  minutos_marcha: number | null;
  minutos_ralenti: number | null;
  velocidad_maxima: number | null;
  excesos: number | null;
  origen: string | null;
  destino: string | null;
  conductor: string | null;
  observacion: string | null;
  importacion_id: number | null;
  actualizado_en: string | null;
  /** Gerenciamientos a los que quedó vinculado (vacío = sin gerenciamiento). */
  gerenciamientos: number[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function ultimoDia(mes: string) {
  const [anio, numero] = mes.split("-").map(Number);
  return `${mes}-${dos(new Date(anio, numero, 0).getDate())}`;
}

/** Importaciones y registros de un mes (AAAA-MM), con los gerenciamientos a los que quedaron vinculados. */
export function useStrix(mes: string) {
  const [datos, setDatos] = useState<{ importaciones: Importacion[]; recorridos: Recorrido[] } | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    const [importaciones, recorridos] = await Promise.all([
      supabase.from("strix_importaciones").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.rpc("strix_recorridos_periodo", { p_desde: `${mes}-01`, p_hasta: ultimoDia(mes) }),
    ]);
    const fallo = importaciones.error ?? recorridos.error;
    if (fallo) {
      setError(/does not exist|schema cache|Could not find the function/i.test(fallo.message)
        ? "Faltan las tablas o funciones de Strix. Verificá que esté aplicada la migración del reporte diario y la carga manual."
        : fallo.message);
      return;
    }
    setDatos({
      importaciones: (importaciones.data ?? []) as Importacion[],
      recorridos: ((recorridos.data ?? []) as Record<string, unknown>[]).map((r) => ({
        ...(r as unknown as Recorrido),
        km: num(r.km),
        minutos_contacto: num(r.minutos_contacto),
        minutos_marcha: num(r.minutos_marcha),
        minutos_ralenti: num(r.minutos_ralenti),
        velocidad_maxima: num(r.velocidad_maxima),
        gerenciamientos: ((r.gerenciamientos as unknown[] | null) ?? []).map(Number),
      })),
    });
    setError("");
  }, [mes]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { datos, error, refresh };
}

/** Registros de un vehículo que tocan un día (para avisar antes de cargar a mano). */
export async function registrosDelDia(vehiculoId: string, fecha: string) {
  const { data, error } = await getSupabase()
    .from("strix_recorridos")
    .select("id, fuente, granularidad, km")
    .eq("vehiculo_id", vehiculoId)
    .lt("inicio", `${diaSiguiente(fecha)}T00:00:00-03:00`)
    .gt("fin", `${fecha}T00:00:00-03:00`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, km: num(r.km) })) as { id: number; fuente: FuenteStrix; granularidad: TipoReporte; km: number | null }[];
}

// ---------- Liquidación ----------

/** Cómo se mide el trabajo según la unidad de medida del contrato. */
export type BaseLiquidacion = "km" | "horas" | "dias" | "mes" | "otra";

export function baseDeUnidad(unidad: string): BaseLiquidacion {
  const u = unidad.toLocaleLowerCase("es");
  if (/km|kil[oó]metr/.test(u)) return "km";
  if (/hora/.test(u)) return "horas";
  if (/d[ií]a/.test(u)) return "dias";
  if (/mes/.test(u)) return "mes";
  return "otra";
}

export function formatHoras(horas: number | null) {
  if (horas === null) return "—";
  const total = Math.round(horas * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}
