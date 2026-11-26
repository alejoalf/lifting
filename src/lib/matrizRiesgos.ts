import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, mensajeDeError } from "./supabase";

export type TipoTramo = "asfalto" | "ripio" | "locacion";
export type TipoEquipo = "izaje" | "barquilla" | "transporte" | "otro";
export type CategoriaPeligro = "vial" | "clima" | "electrico" | "izaje" | "altura" | "otro";
export type CondicionViento = "precaucion" | "suspendido";
export type EstadoOperacion = "habilitado" | CondicionViento | "sin-datos";

export interface Tramo {
  id: string;
  nombre: string;
  tipo: TipoTramo;
  descripcion: string | null;
  latitud: number | null;
  longitud: number | null;
  velocidad_maxima: number | null;
  lineas_electricas: boolean;
  activo: boolean;
  orden: number;
}

export interface Equipo {
  id: string;
  nombre: string;
  tipo: TipoEquipo;
  viento_precaucion_kmh: number | null;
  viento_maximo_kmh: number | null;
  rafaga_maxima_kmh: number | null;
  riesgo_electrico: boolean;
  distancia_lineas_m: number | null;
  aislado: boolean;
  /** Altura de la pluma o canasta (m): define a qué altura se evalúa el viento. */
  altura_trabajo_m: number;
  /** Suspende la maniobra si hay tormenta eléctrica. */
  suspender_tormenta: boolean;
  notas: string | null;
  activo: boolean;
  orden: number;
}

export interface Peligro {
  id: string;
  nombre: string;
  categoria: CategoriaPeligro;
  descripcion: string | null;
  severidad: number;
  probabilidad: number;
  tramo_ids: string[];
  equipo_tipos: TipoEquipo[];
  activo: boolean;
}

export interface Medida {
  id: string;
  descripcion: string;
  tramo_id: string | null;
  equipo_id: string | null;
  peligro_id: string | null;
  condicion: CondicionViento | null;
  activo: boolean;
  orden: number;
}

export interface Matriz {
  tramos: Tramo[];
  equipos: Equipo[];
  peligros: Peligro[];
  medidas: Medida[];
}

export const TIPOS_TRAMO: Record<TipoTramo, string> = { asfalto: "Asfalto", ripio: "Ripio", locacion: "Locación" };
export const TIPOS_EQUIPO: Record<TipoEquipo, string> = { izaje: "Izaje", barquilla: "Barquilla", transporte: "Transporte", otro: "Otro" };
export const CATEGORIAS_PELIGRO: Record<CategoriaPeligro, string> = {
  vial: "Vial", clima: "Clima", electrico: "Eléctrico", izaje: "Izaje", altura: "Altura", otro: "Otro",
};
export const ESTADOS: Record<EstadoOperacion, string> = {
  habilitado: "Habilitado", precaucion: "Precaución", suspendido: "Suspendido", "sin-datos": "Sin datos",
};

const TABLAS = ["riesgo_tramos", "riesgo_equipos", "riesgo_peligros", "riesgo_medidas"] as const;
export type TablaRiesgo = (typeof TABLAS)[number];

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function cargarMatriz(): Promise<Matriz> {
  const supabase = getSupabase();
  const [tramos, equipos, peligros, medidas] = await Promise.all([
    supabase.from("riesgo_tramos").select("*").order("orden").order("nombre"),
    supabase.from("riesgo_equipos").select("*").order("orden").order("nombre"),
    supabase.from("riesgo_peligros").select("*").order("nombre"),
    supabase.from("riesgo_medidas").select("*").order("orden").order("descripcion"),
  ]);
  const fallo = tramos.error ?? equipos.error ?? peligros.error ?? medidas.error;
  if (fallo) throw new Error(fallo.message);
  return {
    tramos: (tramos.data ?? []).map((t) => ({ ...t, latitud: num(t.latitud), longitud: num(t.longitud), velocidad_maxima: num(t.velocidad_maxima) })),
    equipos: (equipos.data ?? []).map((e) => ({
      ...e,
      viento_precaucion_kmh: num(e.viento_precaucion_kmh),
      viento_maximo_kmh: num(e.viento_maximo_kmh),
      rafaga_maxima_kmh: num(e.rafaga_maxima_kmh),
      distancia_lineas_m: num(e.distancia_lineas_m),
      altura_trabajo_m: num(e.altura_trabajo_m) ?? 10,
      suspender_tormenta: e.suspender_tormenta ?? true,
    })),
    peligros: (peligros.data ?? []).map((p) => ({ ...p, tramo_ids: p.tramo_ids ?? [], equipo_tipos: p.equipo_tipos ?? [] })),
    medidas: medidas.data ?? [],
  };
}

/** Matriz de riesgos, recargada en vivo cuando un Admin la modifica. */
export function useMatrizRiesgos() {
  const [datos, setDatos] = useState<Matriz | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDatos(await cargarMatriz());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la matriz de riesgos.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const supabase = getSupabase();
    let canal = supabase.channel(`matriz-riesgos-${Math.random().toString(36).slice(2)}`);
    for (const tabla of TABLAS) {
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, () => { void refresh(); });
    }
    canal.subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [refresh]);

  return { datos, error, refresh };
}

// ---------- Clima real del momento (Open-Meteo, libre y sin clave) ----------

/** Lugar donde se consulta el clima: un tramo o la ubicación actual del usuario. */
export interface PuntoClima {
  id: string;
  latitud: number;
  longitud: number;
}

export interface Clima {
  /** Momento al que corresponden los datos (ms desde 1970, UTC). */
  momento: number;
  /** Cada cuánto el servicio publica datos nuevos (ms). */
  intervalo: number;
  esDia: boolean;
  codigo: number; // código WMO
  temperatura: number; // °C
  sensacion: number; // °C
  humedad: number; // %
  precipitacion: number; // mm
  nubosidad: number; // %
  presion: number; // hPa
  visibilidad: number; // m
  viento10: number; // km/h
  viento80: number;
  viento120: number;
  rafaga: number; // km/h, a 10 m
  direccion: number; // grados
  elevacion: number; // m s. n. m.
}

/** Cada cuánto Open-Meteo publica datos nuevos del momento (si la respuesta no lo informa). */
const INTERVALO_DATOS_MS = 15 * 60 * 1000;
/** Espera después de cada publicación antes de consultar. */
const MARGEN_PUBLICACION_MS = 60 * 1000;
/** Reintento si la consulta falla o el servicio todavía no publicó el dato nuevo. */
const REINTENTO_MS = 60 * 1000;
/** Cada cuánto se revisa si ya toca actualizar. */
const REVISION_MS = 30 * 1000;
/** Tiempo máximo de espera de una consulta. */
const TIEMPO_MAXIMO_MS = 20 * 1000;
/** Datos más viejos que esto se marcan como desactualizados. */
export const DATOS_VIEJOS_MS = 30 * 60 * 1000;

const VARIABLES = [
  "is_day", "weather_code", "temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation",
  "cloud_cover", "pressure_msl", "visibility", "wind_speed_10m", "wind_speed_80m", "wind_speed_120m",
  "wind_gusts_10m", "wind_direction_10m",
];

export async function consultarClima(puntos: PuntoClima[]): Promise<Record<string, Clima>> {
  if (puntos.length === 0) return {};
  const params = new URLSearchParams({
    latitude: puntos.map((p) => p.latitud).join(","),
    longitude: puntos.map((p) => p.longitud).join(","),
    current: VARIABLES.join(","),
    wind_speed_unit: "kmh",
    timezone: "auto",
    timeformat: "unixtime",
  });
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  let json: unknown;
  let estado = 0;
  try {
    // no-store: nunca reutilizar una respuesta guardada por el navegador o un proxy.
    const respuesta = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: "no-store", signal: control.signal });
    estado = respuesta.status;
    if (respuesta.ok) json = await respuesta.json();
  } catch {
    throw new Error(control.signal.aborted
      ? "El servicio meteorológico tardó demasiado en responder."
      : "No se pudo conectar con el servicio meteorológico. Revisá la conexión.");
  } finally {
    clearTimeout(limite);
  }
  if (json === undefined) {
    throw new Error(estado === 429
      ? "Se superó el límite de consultas del servicio meteorológico. Se reintenta en un minuto."
      : `El servicio meteorológico respondió con un error (${estado}).`);
  }
  const lista = (Array.isArray(json) ? json : [json]) as { elevation: number; current?: Record<string, number | string> }[];
  const resultado: Record<string, Clima> = {};
  puntos.forEach((p, i) => {
    const c = lista[i]?.current;
    if (!c) return;
    const n = (clave: string) => Number(c[clave] ?? 0);
    resultado[p.id] = {
      momento: n("time") * 1000,
      intervalo: (n("interval") || INTERVALO_DATOS_MS / 1000) * 1000,
      esDia: n("is_day") === 1,
      codigo: n("weather_code"),
      temperatura: n("temperature_2m"),
      sensacion: n("apparent_temperature"),
      humedad: n("relative_humidity_2m"),
      precipitacion: n("precipitation"),
      nubosidad: n("cloud_cover"),
      presion: n("pressure_msl"),
      visibilidad: n("visibility"),
      viento10: n("wind_speed_10m"),
      viento80: n("wind_speed_80m"),
      viento120: n("wind_speed_120m"),
      rafaga: n("wind_gusts_10m"),
      direccion: n("wind_direction_10m"),
      elevacion: lista[i].elevation,
    };
  });
  return resultado;
}

/**
 * Cuándo volver a consultar: apenas el servicio publica el próximo dato, más un
 * margen. Nunca antes de REINTENTO_MS (si todavía no lo publicó, se reintenta al
 * minuto) ni después de un intervalo completo más el margen.
 */
export function proximaConsulta(datos: Record<string, Clima>, ahora: number) {
  const siguientes = Object.values(datos).map((c) => c.momento + c.intervalo);
  const siguiente = siguientes.length ? Math.min(...siguientes) : ahora + INTERVALO_DATOS_MS;
  return Math.min(
    Math.max(siguiente + MARGEN_PUBLICACION_MS, ahora + REINTENTO_MS),
    ahora + INTERVALO_DATOS_MS + MARGEN_PUBLICACION_MS,
  );
}

/**
 * Clima actual de cada punto. Se actualiza solo apenas el servicio publica datos
 * nuevos (cada 15 minutos), al volver a la pestaña y al recuperar la conexión.
 */
export function useClima(puntos: PuntoClima[]) {
  const [clima, setClima] = useState<Record<string, Clima>>({});
  const [consultado, setConsultado] = useState<Date | null>(null);
  const [proxima, setProxima] = useState<Date | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const puntosRef = useRef<PuntoClima[]>([]);
  puntosRef.current = puntos;
  const proximaRef = useRef(0);
  const ultimoPedido = useRef(0);
  // Se vuelve a consultar de inmediato si cambian los puntos (redondeados a ~100 m).
  const clave = puntos.map((p) => `${p.id}:${p.latitud.toFixed(3)}:${p.longitud.toFixed(3)}`).join("|");

  const actualizar = useCallback(async () => {
    const consulta = puntosRef.current;
    if (consulta.length === 0) return;
    const numero = ++ultimoPedido.current;
    // Mientras la consulta está en curso, la revisión periódica no lanza otra.
    proximaRef.current = Date.now() + REINTENTO_MS;
    setCargando(true);
    try {
      const datos = await consultarClima(consulta);
      if (numero !== ultimoPedido.current) return; // ya se pidió una consulta más nueva
      const ahora = Date.now();
      proximaRef.current = proximaConsulta(datos, ahora);
      setClima(datos);
      setConsultado(new Date(ahora));
      setError("");
    } catch (e) {
      if (numero !== ultimoPedido.current) return;
      proximaRef.current = Date.now() + REINTENTO_MS;
      setError(e instanceof Error ? e.message : "No se pudo consultar el clima.");
    } finally {
      if (numero === ultimoPedido.current) {
        setCargando(false);
        setProxima(new Date(proximaRef.current));
      }
    }
  }, []);

  useEffect(() => {
    if (!clave) return;
    void actualizar();
    // En lugar de un único temporizador largo (que el navegador pausa con la
    // pestaña en segundo plano, el celular bloqueado o la compu suspendida), se
    // revisa seguido si ya toca actualizar, y también al volver a la pestaña o a la red.
    const revisar = () => {
      if (document.visibilityState === "visible" && Date.now() >= proximaRef.current) void actualizar();
    };
    const id = window.setInterval(revisar, REVISION_MS);
    document.addEventListener("visibilitychange", revisar);
    window.addEventListener("focus", revisar);
    window.addEventListener("online", revisar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revisar);
      window.removeEventListener("focus", revisar);
      window.removeEventListener("online", revisar);
    };
  }, [clave, actualizar]);

  // Momento de los datos que se muestran: el más viejo, por precaución.
  const momentos = Object.values(clima).map((c) => c.momento);
  const datosDe = momentos.length ? new Date(Math.min(...momentos)) : null;

  return { clima, datosDe, consultado, proxima, cargando, error, actualizar };
}

export interface Ubicacion {
  latitud: number;
  longitud: number;
  precision: number; // m
}

/** Ubicación GPS del usuario (se pide recién cuando se llama a `pedir`). */
export function useUbicacionActual() {
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);

  const pedir = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Este dispositivo no permite obtener la ubicación.");
      return;
    }
    setBuscando(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicacion({ latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision: pos.coords.accuracy });
        setBuscando(false);
      },
      (e) => {
        setError(e.code === e.PERMISSION_DENIED ? "No se dio permiso para usar la ubicación." : "No se pudo obtener la ubicación.");
        setBuscando(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  return { ubicacion, error, buscando, pedir };
}

export interface Lugar {
  nombre: string;
  detalle: string;
  latitud: number;
  longitud: number;
}

/** Busca un lugar por nombre (geocodificación de Open-Meteo). */
export async function buscarLugar(nombre: string): Promise<Lugar[]> {
  const params = new URLSearchParams({ name: nombre.trim(), count: "8", language: "es", countryCode: "AR" });
  const respuesta = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!respuesta.ok) throw new Error("El buscador de lugares no respondió.");
  const json: { results?: { name: string; admin1?: string; admin2?: string; latitude: number; longitude: number }[] } = await respuesta.json();
  return (json.results ?? []).map((r) => ({
    nombre: r.name,
    detalle: [r.admin2, r.admin1].filter(Boolean).join(", "),
    latitud: r.latitude,
    longitud: r.longitude,
  }));
}

const CODIGOS_WMO: [number[], string][] = [
  [[0], "Despejado"], [[1], "Mayormente despejado"], [[2], "Parcialmente nublado"], [[3], "Nublado"],
  [[45, 48], "Niebla"], [[51, 53, 55], "Llovizna"], [[56, 57], "Llovizna helada"],
  [[61, 63, 65], "Lluvia"], [[66, 67], "Lluvia helada"], [[71, 73, 75, 77], "Nieve"],
  [[80, 81, 82], "Chaparrones"], [[85, 86], "Chaparrones de nieve"], [[95], "Tormenta eléctrica"],
  [[96, 99], "Tormenta eléctrica con granizo"],
];

export function descripcionClima(codigo: number) {
  return CODIGOS_WMO.find(([codigos]) => codigos.includes(codigo))?.[1] ?? "Sin dato";
}

export const hayTormenta = (clima: Clima) => clima.codigo >= 95;

/**
 * Viento a la altura de trabajo, interpolando los datos reales a 10, 80 y 120 m.
 * La ráfaga se escala con el mismo factor (nunca por debajo de la ráfaga a 10 m).
 */
export function vientoEnAltura(clima: Clima, altura: number) {
  const niveles: [number, number][] = [[10, clima.viento10], [80, clima.viento80], [120, clima.viento120]];
  let velocidad = clima.viento10;
  if (altura >= 120) velocidad = clima.viento120;
  else if (altura > 10) {
    const i = altura <= 80 ? 0 : 1;
    const [h1, v1] = niveles[i];
    const [h2, v2] = niveles[i + 1];
    velocidad = v1 + ((v2 - v1) * (altura - h1)) / (h2 - h1);
  }
  velocidad = Math.max(velocidad, clima.viento10);
  const factor = clima.viento10 > 0 ? velocidad / clima.viento10 : 1;
  return { velocidad, rafaga: clima.rafaga * factor };
}

// ---------- Evaluación ----------

export interface Evaluacion {
  estado: EstadoOperacion;
  viento: number | null; // a la altura de trabajo
  rafaga: number | null;
  motivos: string[];
}

export function evaluarEquipo(equipo: Equipo, clima: Clima | undefined): Evaluacion {
  if (!clima) return { estado: "sin-datos", viento: null, rafaga: null, motivos: [] };
  const { velocidad, rafaga } = vientoEnAltura(clima, equipo.altura_trabajo_m);
  const { viento_precaucion_kmh: precaucion, viento_maximo_kmh: maximo, rafaga_maxima_kmh: rafagaMax } = equipo;
  const suspende: string[] = [];
  if (equipo.suspender_tormenta && hayTormenta(clima)) suspende.push("tormenta eléctrica");
  if (maximo !== null && velocidad >= maximo) suspende.push(`viento ${Math.round(velocidad)} km/h ≥ ${maximo}`);
  if (rafagaMax !== null && rafaga >= rafagaMax) suspende.push(`ráfagas ${Math.round(rafaga)} km/h ≥ ${rafagaMax}`);
  if (suspende.length) return { estado: "suspendido", viento: velocidad, rafaga, motivos: suspende };
  if (precaucion !== null && velocidad >= precaucion) {
    return { estado: "precaucion", viento: velocidad, rafaga, motivos: [`viento ${Math.round(velocidad)} km/h ≥ ${precaucion}`] };
  }
  return { estado: "habilitado", viento: velocidad, rafaga, motivos: [] };
}

export type NivelRiesgo = "bajo" | "moderado" | "alto" | "critico";
export const NIVELES: Record<NivelRiesgo, string> = { bajo: "Bajo", moderado: "Moderado", alto: "Alto", critico: "Crítico" };

/** Matriz 5x5: 1–4 bajo, 5–9 moderado, 10–16 alto, 20–25 crítico. */
export function nivelRiesgo(p: Pick<Peligro, "severidad" | "probabilidad">): NivelRiesgo {
  const valor = p.severidad * p.probabilidad;
  return valor >= 20 ? "critico" : valor >= 10 ? "alto" : valor >= 5 ? "moderado" : "bajo";
}

export function peligrosAplicables(matriz: Matriz, tramo: Tramo | undefined, equipo: Equipo | undefined) {
  return matriz.peligros
    .filter((p) => p.activo)
    .filter((p) => !tramo || p.tramo_ids.length === 0 || p.tramo_ids.includes(tramo.id))
    .filter((p) => !equipo || p.equipo_tipos.length === 0 || p.equipo_tipos.includes(equipo.tipo))
    .filter((p) => p.categoria !== "electrico" || !tramo || tramo.lineas_electricas)
    .sort((a, b) => b.severidad * b.probabilidad - a.severidad * a.probabilidad);
}

const RANGO: Record<EstadoOperacion, number> = { "sin-datos": 0, habilitado: 0, precaucion: 1, suspendido: 2 };

/**
 * Medidas obligatorias para un tramo y equipo: las generales, las del tramo,
 * las del equipo y las de los peligros que aplican, filtradas por la condición
 * climática actual.
 */
export function medidasObligatorias(
  matriz: Matriz, tramo: Tramo | undefined, equipo: Equipo | undefined, estado: EstadoOperacion,
) {
  const peligros = new Set(peligrosAplicables(matriz, tramo, equipo).map((p) => p.id));
  return matriz.medidas.filter((m) => {
    if (!m.activo) return false;
    if (m.tramo_id && m.tramo_id !== tramo?.id) return false;
    if (m.equipo_id && m.equipo_id !== equipo?.id) return false;
    if (m.peligro_id && !peligros.has(m.peligro_id)) return false;
    // Sin dato de clima se muestran todas, por precaución.
    if (m.condicion && estado !== "sin-datos" && RANGO[estado] < RANGO[m.condicion]) return false;
    return true;
  });
}

export function direccionCardinal(grados: number) {
  const puntos = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return puntos[Math.round((grados % 360) / 45) % 8];
}

// ---------- Escritura (solo Admin; lo valida RLS) ----------

export async function guardarFila(tabla: TablaRiesgo, id: string | null, fila: Record<string, unknown>) {
  const supabase = getSupabase();
  const { error } = id
    ? await supabase.from(tabla).update(fila).eq("id", id)
    : await supabase.from(tabla).insert(fila);
  if (error) {
    // Los equipos no pueden tener el viento de precaución por encima del máximo.
    if (error.code === "23514" && tabla === "riesgo_equipos") throw new Error("Revisá los límites: el viento de precaución no puede superar al máximo y ningún valor puede ser negativo.");
    throw new Error(mensajeDeError(error));
  }
}

// Las filas de la matriz no se borran: se desactivan con guardarFila(tabla, id, { activo: false }).
