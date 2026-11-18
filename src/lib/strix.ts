import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// Integración con Strix (telemetría). Hoy los recorridos entran importando el
// reporte exportado desde la plataforma de Strix como CSV. Como el formato exacto
// del reporte todavía no está confirmado, el administrador indica qué columna es
// cada dato y la elección queda recordada en el navegador.
// Cuando haya acceso por mail o API, se cargan las mismas columnas de strix_recorridos
// (con fuente "email" o "api") y todo lo demás sigue funcionando igual.

// ---------- Lectura del CSV ----------

/** Lee un CSV (separado por ";", "," o tabulación; con comillas) y devuelve encabezados y filas. */
export function leerCsv(contenido: string): { encabezados: string[]; filas: string[][] } {
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

  const [encabezados = [], ...resto] = filas;
  return { encabezados: encabezados.map((e) => e.trim()), filas: resto };
}

// ---------- Columnas del reporte ----------

export type CampoStrix =
  | "dominio" | "fecha" | "inicio" | "fin" | "km"
  | "marcha" | "ralenti" | "velocidad_maxima" | "excesos"
  | "origen" | "destino" | "conductor";

export interface DefinicionCampo { campo: CampoStrix; titulo: string; obligatorio: boolean; ayuda?: string; pistas: RegExp }

export const CAMPOS_STRIX: DefinicionCampo[] = [
  { campo: "dominio", titulo: "Dominio / patente", obligatorio: true, pistas: /dominio|patente|unidad|movil|vehic/i },
  { campo: "inicio", titulo: "Inicio del recorrido", obligatorio: true, ayuda: "Fecha y hora, o solo la hora si hay una columna de fecha aparte.", pistas: /inicio|desde|salida|partida|comienzo/i },
  { campo: "fin", titulo: "Fin del recorrido", obligatorio: true, ayuda: "Fecha y hora, o solo la hora si hay una columna de fecha aparte.", pistas: /fin$|fin |hasta|llegada|final|termin/i },
  { campo: "fecha", titulo: "Fecha (si viene separada)", obligatorio: false, pistas: /^fecha$|^dia$|^día$/i },
  { campo: "km", titulo: "Kilómetros recorridos", obligatorio: true, pistas: /km|kil[oó]metr|distancia|recorrid/i },
  { campo: "marcha", titulo: "Tiempo en marcha", obligatorio: false, pistas: /marcha|movimiento|conducci|manejo/i },
  { campo: "ralenti", titulo: "Tiempo en ralentí / toma de fuerza", obligatorio: false, pistas: /ralent|detenid.*encend|toma de fuerza|pto/i },
  { campo: "velocidad_maxima", titulo: "Velocidad máxima", obligatorio: false, pistas: /vel.*m[aá]x|m[aá]x.*vel/i },
  { campo: "excesos", titulo: "Cantidad de excesos de velocidad", obligatorio: false, pistas: /exceso/i },
  { campo: "origen", titulo: "Origen", obligatorio: false, pistas: /origen|direcci[oó]n inicio/i },
  { campo: "destino", titulo: "Destino", obligatorio: false, pistas: /destino|direcci[oó]n fin/i },
  { campo: "conductor", titulo: "Conductor", obligatorio: false, pistas: /conductor|chofer|driver/i },
];

export type UnidadTiempo = "hhmm" | "minutos" | "horas";

export interface Mapeo {
  columnas: Partial<Record<CampoStrix, string>>;
  /** Cómo vienen los tiempos de marcha y ralentí. */
  unidadTiempo: UnidadTiempo;
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
  for (const def of CAMPOS_STRIX) {
    const anterior = guardado?.columnas?.[def.campo];
    const elegida = anterior && encabezados.includes(anterior)
      ? anterior
      : encabezados.find((e) => !usadas.has(e) && def.pistas.test(e));
    if (elegida) {
      columnas[def.campo] = elegida;
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

/** "1.234,5" o "1234.5" -> 1234.5 */
export function leerNumero(valor: string): number | null {
  const limpio = valor.replace(/[^\d,.-]/g, "");
  if (!limpio) return null;
  const normalizado = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Tiempo -> minutos. Acepta "hh:mm[:ss]", "1h 20m", o un número en la unidad indicada. */
export function leerMinutos(valor: string, unidad: UnidadTiempo): number | null {
  const v = valor.trim();
  if (!v) return null;
  const hhmm = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]) + Number(hhmm[3] ?? 0) / 60;
  const textual = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/i.exec(v);
  if (textual && (textual[1] || textual[2] || textual[3])) {
    return Number(textual[1] ?? 0) * 60 + Number(textual[2] ?? 0) + Number(textual[3] ?? 0) / 60;
  }
  const n = leerNumero(v);
  if (n === null) return null;
  return unidad === "horas" ? n * 60 : n;
}

/** Fecha y hora local de Argentina -> ISO con zona (-03:00). Acepta DD/MM/AAAA, AAAA-MM-DD y hora opcional. */
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
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${anio}-${dos(mes)}-${dos(dia)}T${dos(h)}:${dos(m)}:${dos(s)}-03:00`;
}

/** "AAAA-MM-DDTHH:MM:SS-03:00" del día siguiente, misma hora. */
function sumarUnDia(iso: string) {
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  const siguiente = new Date(Date.UTC(anio, mes - 1, dia + 1)).toISOString().slice(0, 10);
  return siguiente + iso.slice(10);
}

export interface RecorridoLeido {
  dominio: string;
  inicio: string;
  fin: string;
  km: number | null;
  minutos_marcha: number | null;
  minutos_ralenti: number | null;
  velocidad_maxima: number | null;
  excesos: number | null;
  origen: string;
  destino: string;
  conductor: string;
  datos: Record<string, string>;
}

export interface ResultadoLectura { recorridos: RecorridoLeido[]; errores: { fila: number; motivo: string }[] }

/** Convierte las filas del CSV en recorridos según el mapeo. Las filas inválidas se informan aparte. */
export function convertirFilas(encabezados: string[], filas: string[][], mapeo: Mapeo): ResultadoLectura {
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
    const numeroFila = n + 2; // +1 por el encabezado, +1 porque las planillas cuentan desde 1
    const dominio = valor(fila, "dominio");
    const inicio = leerFechaHora(valor(fila, "inicio"), valor(fila, "fecha"));
    let fin = leerFechaHora(valor(fila, "fin"), valor(fila, "fecha"));
    if (!dominio) return errores.push({ fila: numeroFila, motivo: "sin dominio" });
    if (!inicio) return errores.push({ fila: numeroFila, motivo: `inicio no reconocido ("${valor(fila, "inicio")}")` });
    if (!fin) return errores.push({ fila: numeroFila, motivo: `fin no reconocido ("${valor(fila, "fin")}")` });
    // Recorrido que cruza la medianoche con la fecha en columna aparte: el fin es del día siguiente.
    if (fin < inicio && valor(fila, "fecha")) fin = sumarUnDia(fin);
    if (new Date(fin) < new Date(inicio)) return errores.push({ fila: numeroFila, motivo: "el fin es anterior al inicio" });

    recorridos.push({
      dominio,
      inicio,
      fin,
      km: leerNumero(valor(fila, "km")),
      minutos_marcha: leerMinutos(valor(fila, "marcha"), mapeo.unidadTiempo),
      minutos_ralenti: leerMinutos(valor(fila, "ralenti"), mapeo.unidadTiempo),
      velocidad_maxima: leerNumero(valor(fila, "velocidad_maxima")),
      excesos: (() => { const e = leerNumero(valor(fila, "excesos")); return e === null ? null : Math.round(e); })(),
      origen: valor(fila, "origen"),
      destino: valor(fila, "destino"),
      conductor: valor(fila, "conductor"),
      datos: Object.fromEntries(encabezados.map((e, i) => [e, fila[i] ?? ""])),
    });
  });
  return { recorridos, errores };
}

// ---------- Base de datos ----------

export interface ResultadoImportacion { importacion_id: number; filas: number; nuevas: number; sin_vehiculo: number; vinculados: number }

const LOTE = 500;

/** Importa los recorridos en lotes. Los repetidos se ignoran en la base. */
export async function importarRecorridos(archivo: string, recorridos: RecorridoLeido[]) {
  const total: ResultadoImportacion = { importacion_id: 0, filas: 0, nuevas: 0, sin_vehiculo: 0, vinculados: 0 };
  for (let i = 0; i < recorridos.length; i += LOTE) {
    const parte = recorridos.length > LOTE ? `${archivo} (${i / LOTE + 1})` : archivo;
    const { data, error } = await getSupabase().rpc("importar_strix", { p_archivo: parte, p_filas: recorridos.slice(i, i + LOTE) });
    if (error) throw new Error(error.message);
    const r = (Array.isArray(data) ? data[0] : data) as ResultadoImportacion;
    total.importacion_id = r.importacion_id;
    total.filas += r.filas;
    total.nuevas += r.nuevas;
    total.sin_vehiculo += r.sin_vehiculo;
    total.vinculados = Math.max(total.vinculados, r.vinculados);
  }
  return total;
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

export interface Importacion { id: number; archivo: string; filas: number; nuevas: number; sin_vehiculo: number; created_at: string }

export interface Recorrido {
  id: number;
  dominio: string;
  vehiculo_id: string | null;
  inicio: string;
  fin: string;
  km: number | null;
  minutos_marcha: number | null;
  minutos_ralenti: number | null;
  velocidad_maxima: number | null;
  excesos: number | null;
  origen: string | null;
  destino: string | null;
  conductor: string | null;
  fuente: string;
}

/** Importaciones y recorridos de un mes (AAAA-MM), para revisar lo cargado. */
export function useStrix(mes: string) {
  const [datos, setDatos] = useState<{ importaciones: Importacion[]; recorridos: Recorrido[] } | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    const [anio, numeroMes] = mes.split("-").map(Number);
    const desde = `${mes}-01T00:00:00-03:00`;
    const siguiente = numeroMes === 12 ? `${anio + 1}-01` : `${anio}-${String(numeroMes + 1).padStart(2, "0")}`;
    const hasta = `${siguiente}-01T00:00:00-03:00`;
    const [importaciones, recorridos] = await Promise.all([
      supabase.from("strix_importaciones").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("strix_recorridos").select("*").gte("inicio", desde).lt("inicio", hasta).order("inicio", { ascending: false }).limit(1000),
    ]);
    const fallo = importaciones.error ?? recorridos.error;
    if (fallo) {
      setError(/does not exist|schema cache/i.test(fallo.message)
        ? "No se encontraron las tablas de Strix. Verificá que la migración de Strix esté aplicada."
        : fallo.message);
      return;
    }
    setDatos({
      importaciones: (importaciones.data ?? []) as Importacion[],
      recorridos: ((recorridos.data ?? []) as Recorrido[]).map((r) => ({
        ...r,
        km: r.km === null ? null : Number(r.km),
        minutos_marcha: r.minutos_marcha === null ? null : Number(r.minutos_marcha),
        minutos_ralenti: r.minutos_ralenti === null ? null : Number(r.minutos_ralenti),
        velocidad_maxima: r.velocidad_maxima === null ? null : Number(r.velocidad_maxima),
      })),
    });
    setError("");
  }, [mes]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { datos, error, refresh };
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
