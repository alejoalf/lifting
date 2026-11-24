import { useCallback, useEffect, useState } from "react";
import { getSupabase, mensajeDeError } from "./supabase";
import { hoy } from "./registros";
import { borrarArchivo, subirArchivo } from "./legajos";

// Checklist vehicular por tipo de flota (planilla CEMSA de flota pesada y su versión liviana),
// datos precargados que se renuevan cada 6 meses y estado del checklist de un vehículo.
// Los documentos se leen del Legajo y de Flota; las reglas de aptitud se recalculan en la base
// (ver migraciones 20261124120000_checklist_flota y 20261125100000_documentos_unificados).

export type TipoFlota = "Pesada" | "Liviana";

/** Referencias de la planilla: ✓ Óptimo, R Regular, X Mal, O Observación, F Falta, N/A. "bien" = checklists viejos. */
export type EstadoItem = "optimo" | "regular" | "mal" | "observacion" | "falta" | "na" | "bien";

export const ESTADOS: { valor: EstadoItem; texto: string; corto: string }[] = [
  { valor: "optimo", texto: "Óptimo", corto: "✓" },
  { valor: "regular", texto: "Regular", corto: "R" },
  { valor: "mal", texto: "Mal", corto: "X" },
  { valor: "observacion", texto: "Observación", corto: "O" },
  { valor: "falta", texto: "Falta", corto: "F" },
  { valor: "na", texto: "No aplica", corto: "N/A" },
];

export const TEXTO_ESTADO: Record<EstadoItem, string> = {
  optimo: "Óptimo", bien: "Óptimo", regular: "Regular", mal: "Mal", observacion: "Observación", falta: "Falta", na: "No aplica",
};

export interface ItemDef {
  id: string;
  texto: string;
  /** Resaltado en amarillo en la planilla: tiene que estar en Óptimo para circular. */
  condicionante?: boolean;
  /** Solo si la unidad lleva semirremolque. */
  semi?: boolean;
  /** Clave del documento (Flota) cuyo vencimiento se muestra junto al control (ej. extintores). */
  vencimiento?: string;
  /** Meses (1 a 12) en los que el control pasa a ser condicionante y no admite N/A (ej. kit de invierno). */
  temporada?: { desde: number; hasta: number };
  nota?: string;
}

export interface PasoDef {
  id: string;
  titulo: string;
  nota?: string;
  /** El paso tiene su propio campo de observaciones (como el paso 7 de la planilla). */
  observaciones?: boolean;
  items: ItemDef[];
}

/** Características de un neumático (planilla: Direccional / Tractora). */
export const CARACTERISTICAS_NEUMATICO = ["Direccional", "Tractora"];

/** Si el control está en temporada (ej. kit de invierno de mayo a septiembre). */
export function enTemporada(item: ItemDef, fecha = new Date()) {
  if (!item.temporada) return false;
  const mes = fecha.getMonth() + 1;
  const { desde, hasta } = item.temporada;
  return desde <= hasta ? mes >= desde && mes <= hasta : mes >= desde || mes <= hasta;
}

/** Condicionante efectivo hoy: el de la planilla o el de temporada. */
export function esCondicionante(item: ItemDef, fecha = new Date()) {
  return item.condicionante === true || enTemporada(item, fecha);
}

/** Dimensión del neumático con el formato de la planilla: ancho / perfil R rodado (ej. 295/80 R22.5). */
export function armarDimension(ancho: string, perfil: string, rodado: string) {
  const [a, p, r] = [ancho, perfil, rodado].map((v) => v.trim().replace(",", "."));
  return a || p || r ? `${a}/${p} R${r}` : "";
}

export function partirDimension(dimension: string) {
  const m = /^\s*([\d.,]*)\s*\/\s*([\d.,]*)\s*R?\s*([\d.,]*)\s*$/i.exec(dimension ?? "");
  return m ? { ancho: m[1], perfil: m[2], rodado: m[3] } : { ancho: "", perfil: "", rodado: "" };
}

export interface EjeDef {
  id: string;
  nombre: string;
  semi?: boolean;
  auxilio?: boolean;
  caracteristica: string;
}

/** Qué documentos pide cada flota se configura en los tipos de documento (Legajo y Flota), no acá. */
export interface Plantilla {
  tipo: TipoFlota;
  titulo: string;
  pasos: PasoDef[];
  ejes: EjeDef[];
  presiones: number[];
}

// ---------- Flota pesada: transcripción de la planilla del cliente ----------

const PESADA: Plantilla = {
  tipo: "Pesada",
  titulo: "Check list de flota pesada",
  presiones: [80, 90, 100, 110, 120],
  pasos: [
    {
      id: "p1", titulo: "Paso 1 · Control nivel de fluidos",
      nota: "Levantar el capot del tractor para el posterior levantamiento de la cabina.",
      items: [
        { id: "aceite_motor", texto: "Nivel aceite de motor", condicionante: true },
        { id: "liquido_embrague", texto: "Nivel líquido de embrague", condicionante: true },
        { id: "refrigerante", texto: "Nivel de refrigerante motor", condicionante: true },
        { id: "combustible", texto: "Nivel combustible" },
        { id: "limpiaparabrisas_liq", texto: "Nivel de líq. limpia-parabrisas" },
        { id: "urea", texto: "Nivel de urea" },
      ],
    },
    {
      id: "p2", titulo: "Paso 2 · Puesta en marcha",
      nota: "Corte la corriente una vez terminada la jornada laboral.",
      items: [{ id: "toma_corriente", texto: "Toma corriente" }],
    },
    {
      id: "p3", titulo: "Paso 3 · Transpiración / pérdidas",
      items: [
        { id: "diferencial_delantero", texto: "Diferencial delantero" },
        { id: "caja_transmision", texto: "Caja transmisión" },
        { id: "diferencial_trasero", texto: "Diferencial trasero" },
        { id: "recipiente_hidraulico", texto: "Recipiente de líquido hidráulico" },
        { id: "amortiguadores", texto: "Amortiguadores" },
        { id: "acoples_hidraulicos", texto: "Acoples de mangueras hidráulicas" },
      ],
    },
    {
      id: "p4", titulo: "Paso 4 · Iluminación",
      items: [
        { id: "luz_posicion", texto: "Luz de posición" },
        { id: "instrumental_tablero", texto: "Instrumental lumínico del tablero" },
        { id: "luz_baja", texto: "Luz baja", condicionante: true },
        { id: "luces_testigos", texto: "Luces de testigos" },
        { id: "luz_alta", texto: "Luz alta", condicionante: true },
        { id: "luz_interior", texto: "Luz interior" },
        { id: "luz_giro", texto: "Luz de giro", condicionante: true },
        { id: "mensajes_computadora", texto: "Mensajes en la computadora de abordo" },
        { id: "luz_balizas", texto: "Luz de balizas", condicionante: true },
        { id: "lamparas_repuesto", texto: "Lámparas de repuesto / fusibles" },
      ],
    },
    {
      id: "p5", titulo: "Paso 5 · Cabina / estado",
      items: [
        { id: "levanta_vidrios", texto: "Ventanilla / levanta vidrios" },
        { id: "chaleco", texto: "Chaleco reflectivo" },
        { id: "parabrisas", texto: "Parabrisas" },
        { id: "grabado_cristales", texto: "Grabado de cristales" },
        { id: "escobillas", texto: "Escobillas" },
        { id: "carteleria", texto: "Cartelería y cintas reflectivas obligatorias", condicionante: true },
        { id: "espejos", texto: "Espejos retrovisores", condicionante: true },
        { id: "tacos", texto: "Tacos / cuñas (2)" },
        { id: "butaca", texto: "Butaca", condicionante: true },
        { id: "baliza_triangulo", texto: "Baliza triángulo" },
        { id: "apoya_cabezas", texto: "Apoya cabezas", condicionante: true },
        { id: "conos", texto: "Conos (2)" },
        { id: "cinturones", texto: "Cinturones de seguridad", condicionante: true },
        { id: "limpieza_cabina", texto: "Limpieza general de cabina" },
        { id: "inerciales", texto: "Sistemas inerciales de cinturones", condicionante: true },
        { id: "parasoles", texto: "Parasoles" },
        { id: "elementos_sueltos", texto: "Elementos sueltos contundentes", condicionante: true, nota: "Óptimo = sin elementos sueltos en cabina." },
        { id: "botiquin", texto: "Botiquín de primeros auxilios" },
        { id: "bocina", texto: "Bocina del tractor", condicionante: true },
        { id: "climatizacion", texto: "Calefacción / aire acondicionado" },
        { id: "bocina_retroceso", texto: "Bocina de retroceso" },
        { id: "logos", texto: "Logos y N° de interno visibles" },
        { id: "kit_invierno", texto: "Kit de invierno", nota: "Obligatorio de mayo a septiembre.", temporada: { desde: 5, hasta: 9 } },
        { id: "gps", texto: "GPS / tacógrafo", condicionante: true },
        { id: "llave_ruedas", texto: "Llave de ruedas" },
        { id: "crique", texto: "Crique y elementos correspondientes" },
        { id: "ticket_card", texto: "Ticket Card", vencimiento: "ticket_card" },
        { id: "extintor_cabina_estado", texto: "Extintor de cabina 1 kg: estado", vencimiento: "extintor_cabina" },
        { id: "extintor_cabina_presion", texto: "Extintor de cabina 1 kg: presión", vencimiento: "extintor_cabina" },
      ],
    },
    {
      id: "p7", titulo: "Paso 7 · Estado general tractor y semi",
      observaciones: true,
      items: [
        { id: "arrestallamas", texto: "Arrestallamas" },
        { id: "cadena_cardan", texto: "Cadena de seguridad del cardán" },
        { id: "paquetes_elastico", texto: "Paquetes de elástico" },
        { id: "sueltos_semi", texto: "Elementos sueltos en semi", condicionante: true, semi: true },
        { id: "anclaje_pulmones", texto: "Anclaje de pulmones", condicionante: true },
        { id: "estaqueras", texto: "Lugar de guardado de estaqueras", semi: true },
        { id: "escaleras", texto: "Escaleras y amarre" },
        { id: "extintor_tractor_estado", texto: "Extintor de tractor 10 kg: estado", condicionante: true, vencimiento: "extintor_tractor" },
        { id: "extintor_tractor_presion", texto: "Extintor de tractor 10 kg: presión", condicionante: true, vencimiento: "extintor_tractor" },
        { id: "fisura_chasis", texto: "Fisura de chasis" },
        { id: "mangueras", texto: "Estado de mangueras" },
        { id: "camada_semi", texto: "Limpieza de la camada del semi", semi: true },
        { id: "extintor_semi_estado", texto: "Extintor de semi 10 kg: estado", condicionante: true, semi: true, vencimiento: "extintor_semi" },
        { id: "extintor_semi_presion", texto: "Extintor de semi 10 kg: presión", condicionante: true, semi: true, vencimiento: "extintor_semi" },
        { id: "grasa_mazas", texto: "Grasa de mazas" },
        { id: "grasa_plato", texto: "Grasa de plato", semi: true },
        { id: "seguro_plato", texto: "Seguro de plato", condicionante: true, semi: true },
        { id: "chapa_izq_puerta", texto: "Chapa lateral izquierda: puerta delantera" },
        { id: "chapa_izq_guardabarro_del", texto: "Chapa lateral izquierda: guardabarro delantero" },
        { id: "chapa_izq_guardabarro_tras", texto: "Chapa lateral izquierda: guardabarro trasero" },
        { id: "chapa_der_puerta", texto: "Chapa lateral derecha: puerta delantera" },
        { id: "chapa_der_guardabarro_del", texto: "Chapa lateral derecha: guardabarro delantero" },
        { id: "chapa_der_guardabarro_tras", texto: "Chapa lateral derecha: guardabarro trasero" },
        { id: "frente_paragolpe", texto: "Frente: paragolpe" },
        { id: "frente_capot", texto: "Frente: capot" },
        { id: "frente_parrilla", texto: "Frente: parrilla" },
        { id: "spoiler", texto: "Spoiler bajo" },
        { id: "micas_delanteras", texto: "Micas delanteras" },
        { id: "opticas_delanteras", texto: "Ópticas delanteras" },
        { id: "trasera_paragolpe", texto: "Parte trasera: paragolpe" },
        { id: "micas_traseras", texto: "Micas traseras (tractor y semi)" },
        { id: "micas_laterales", texto: "Micas laterales" },
        { id: "tres_marias", texto: "Tres Marías" },
      ],
    },
    {
      id: "p8", titulo: "Paso 8 · Sistema de frenos tractor y semi",
      items: [
        { id: "fuga_permanente", texto: "1° paso: fuga circuito permanente", condicionante: true },
        { id: "fuga_servicio", texto: "1° paso: fuga circuito servicio", condicionante: true },
        { id: "purga_tanque", texto: "2° paso: purga de tanque", condicionante: true },
        { id: "capacidad_aire", texto: "2° paso: capacidad de aire" },
        { id: "potencia_frenos_tractor", texto: "3° paso: potencia de frenos del tractor", condicionante: true },
        { id: "potencia_frenos_semi", texto: "3° paso: potencia de frenos del semi", condicionante: true, semi: true },
      ],
    },
    {
      id: "p9", titulo: "Paso 9 · Control con compañero",
      nota: "Para completar la veracidad del control, debe realizarlo con un compañero.",
      items: [
        { id: "luz_freno", texto: "Luz de freno del tractor y semi", condicionante: true },
        { id: "luz_retroceso", texto: "Luz de retroceso del tractor", condicionante: true },
      ],
    },
  ],
  ejes: [
    { id: "delantero", nombre: "Eje delantero", caracteristica: "Direccional" },
    { id: "tractor_dual", nombre: "1° y 2° eje dual tractor", caracteristica: "Tractora" },
    { id: "semi_1", nombre: "1° eje dual del semi", caracteristica: "Tractora", semi: true },
    { id: "semi_2", nombre: "2° eje dual del semi", caracteristica: "Tractora", semi: true },
    { id: "auxilio", nombre: "1° auxilio", caracteristica: "Direccional", auxilio: true },
  ],
};

// ---------- Flota liviana: misma lógica, controles de pick-ups y utilitarios ----------

const LIVIANA: Plantilla = {
  tipo: "Liviana",
  titulo: "Check list de flota liviana",
  presiones: [28, 30, 32, 35, 38, 40, 45, 50],
  pasos: [
    {
      id: "p1", titulo: "Paso 1 · Control nivel de fluidos",
      items: [
        { id: "aceite_motor", texto: "Nivel aceite de motor", condicionante: true },
        { id: "refrigerante", texto: "Nivel de refrigerante motor", condicionante: true },
        { id: "liquido_frenos", texto: "Nivel líquido de frenos", condicionante: true },
        { id: "direccion_hidraulica", texto: "Nivel líquido de dirección hidráulica" },
        { id: "combustible", texto: "Nivel combustible" },
        { id: "limpiaparabrisas_liq", texto: "Nivel de líq. limpia-parabrisas" },
      ],
    },
    {
      id: "p2", titulo: "Paso 2 · Transpiración / pérdidas",
      items: [
        { id: "perdidas_motor", texto: "Motor" },
        { id: "caja_transmision", texto: "Caja de transmisión" },
        { id: "diferenciales", texto: "Diferenciales" },
        { id: "amortiguadores", texto: "Amortiguadores" },
      ],
    },
    {
      id: "p3", titulo: "Paso 3 · Iluminación",
      items: [
        { id: "luz_posicion", texto: "Luz de posición" },
        { id: "luz_baja", texto: "Luz baja", condicionante: true },
        { id: "luz_alta", texto: "Luz alta", condicionante: true },
        { id: "luz_giro", texto: "Luz de giro", condicionante: true },
        { id: "luz_balizas", texto: "Luz de balizas", condicionante: true },
        { id: "luz_freno", texto: "Luz de freno (con compañero)", condicionante: true },
        { id: "luz_retroceso", texto: "Luz de retroceso", condicionante: true },
        { id: "luz_interior", texto: "Luz interior" },
        { id: "instrumental_tablero", texto: "Instrumental y testigos del tablero" },
      ],
    },
    {
      id: "p4", titulo: "Paso 4 · Cabina / estado",
      items: [
        { id: "parabrisas", texto: "Parabrisas", condicionante: true },
        { id: "escobillas", texto: "Escobillas" },
        { id: "espejos", texto: "Espejos retrovisores", condicionante: true },
        { id: "cinturones", texto: "Cinturones de seguridad (todas las plazas)", condicionante: true },
        { id: "apoya_cabezas", texto: "Apoya cabezas", condicionante: true },
        { id: "butacas", texto: "Butacas" },
        { id: "bocina", texto: "Bocina", condicionante: true },
        { id: "bocina_retroceso", texto: "Alarma de retroceso" },
        { id: "levanta_vidrios", texto: "Ventanillas / levanta vidrios" },
        { id: "elementos_sueltos", texto: "Elementos sueltos contundentes", condicionante: true, nota: "Óptimo = sin elementos sueltos en cabina." },
        { id: "climatizacion", texto: "Calefacción / aire acondicionado" },
        { id: "gps", texto: "GPS / rastreo satelital", condicionante: true },
        { id: "limpieza_cabina", texto: "Limpieza general de cabina" },
        { id: "logos", texto: "Logos y N° de interno visibles" },
        { id: "pertiga", texto: "Pértiga con banderín (si corresponde)" },
      ],
    },
    {
      id: "p5", titulo: "Paso 5 · Elementos de seguridad",
      items: [
        { id: "extintor_cabina_estado", texto: "Extintor 1 kg: estado", condicionante: true, vencimiento: "extintor_cabina" },
        { id: "extintor_cabina_presion", texto: "Extintor 1 kg: presión", condicionante: true, vencimiento: "extintor_cabina" },
        { id: "baliza_triangulo", texto: "Balizas triángulo (2)", condicionante: true },
        { id: "chaleco", texto: "Chaleco reflectivo", condicionante: true },
        { id: "botiquin", texto: "Botiquín de primeros auxilios" },
        { id: "tacos", texto: "Tacos / cuñas" },
        { id: "conos", texto: "Conos" },
        { id: "eslinga", texto: "Eslinga / linga de remolque" },
        { id: "crique", texto: "Crique y llave de ruedas" },
        { id: "kit_invierno", texto: "Kit de invierno", nota: "Obligatorio de mayo a septiembre.", temporada: { desde: 5, hasta: 9 } },
        { id: "ticket_card", texto: "Ticket Card", vencimiento: "ticket_card" },
      ],
    },
    {
      id: "p7", titulo: "Paso 7 · Estado general",
      observaciones: true,
      items: [
        { id: "carroceria", texto: "Carrocería y chapa" },
        { id: "paragolpes", texto: "Paragolpes" },
        { id: "opticas", texto: "Ópticas y micas" },
        { id: "barra_antivuelco", texto: "Barra antivuelco / jaula (si corresponde)" },
        { id: "caja_carga", texto: "Caja de carga y amarre de la carga" },
        { id: "arrestallamas", texto: "Arrestallamas (si corresponde)" },
      ],
    },
    {
      id: "p8", titulo: "Paso 8 · Frenos y dirección",
      items: [
        { id: "freno_servicio", texto: "Freno de servicio", condicionante: true },
        { id: "freno_mano", texto: "Freno de mano", condicionante: true },
        { id: "direccion", texto: "Dirección (juego y ruidos)", condicionante: true },
      ],
    },
  ],
  ejes: [
    { id: "delantero", nombre: "Eje delantero", caracteristica: "Direccional" },
    { id: "trasero", nombre: "Eje trasero", caracteristica: "Tractora" },
    { id: "auxilio", nombre: "Auxilio", caracteristica: "Direccional", auxilio: true },
  ],
};

export const PLANTILLAS: Record<TipoFlota, Plantilla> = { Pesada: PESADA, Liviana: LIVIANA };

// ---------- Datos precargados del vehículo (se renuevan cada 6 meses) ----------

/** Vigencia de los datos precargados. */
export const MESES_VIGENCIA_PRECARGA = 6;

/** Datos técnicos del vehículo. Los documentos no van acá: están en Flota. */
export interface PrecargaVehiculo {
  tipoFlota: TipoFlota;
  interno: string;
  marca: string;
  potenciaHp: string;
  empresa: string;
  sector: string;
  conSemi: boolean;
  semiDominio: string;
  semiInterno: string;
  /** Dimensión de neumático por eje (autocompleta el paso 6). */
  dimensiones: Record<string, string>;
}

export interface Precarga<T> {
  datos: T;
  actualizadoEn: string;
  actualizadoPor: string;
  vigenteHasta: string;
  vigente: boolean;
}

function sumarMeses(iso: string, meses: number) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + meses);
  return d;
}

function aPrecarga<T>(fila: Record<string, unknown> | null): Precarga<T> | null {
  if (!fila) return null;
  const actualizadoEn = String(fila.actualizado_en ?? "");
  const hasta = sumarMeses(actualizadoEn, MESES_VIGENCIA_PRECARGA);
  return {
    datos: (fila.datos ?? {}) as T,
    actualizadoEn,
    actualizadoPor: String(fila.actualizado_por_nombre ?? ""),
    vigenteHasta: hasta.toISOString(),
    vigente: hasta.getTime() > Date.now(),
  };
}

/** Días que faltan para que venza la precarga (negativo si ya venció). */
export function diasParaRenovar(precarga: Precarga<unknown>) {
  return Math.floor((new Date(precarga.vigenteHasta).getTime() - Date.now()) / 86_400_000);
}

/** Precarga del vehículo: undefined mientras carga, null si no tiene. */
export function usePrecargaVehiculo(vehiculoId: string) {
  const [precarga, setPrecarga] = useState<Precarga<PrecargaVehiculo> | null | undefined>(undefined);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!vehiculoId) return;
    const { data, error: fallo } = await getSupabase()
      .from("checklist_precarga_vehiculo").select("*").eq("vehiculo_id", vehiculoId).maybeSingle();
    if (fallo) {
      setError(mensajeDeError(fallo));
      return;
    }
    setError("");
    setPrecarga(aPrecarga<PrecargaVehiculo>(data));
  }, [vehiculoId]);

  useEffect(() => {
    setPrecarga(undefined);
    void refresh();
  }, [refresh]);

  return { precarga, error, refresh };
}

export async function guardarPrecargaVehiculo(vehiculoId: string, datos: PrecargaVehiculo) {
  const { error } = await getSupabase().rpc("guardar_precarga_vehiculo", { p_vehiculo_id: vehiculoId, p_datos: datos });
  if (error) throw new Error(mensajeDeError(error));
}

export async function borrarPrecargaVehiculo(vehiculoId: string) {
  const { error } = await getSupabase().rpc("borrar_precarga_vehiculo", { p_vehiculo_id: vehiculoId });
  if (error) throw new Error(mensajeDeError(error, true));
}

// ---------- Documentos: una sola fuente (Legajo del conductor y Flota del vehículo) ----------

/** Un documento que pide el checklist, con su estado en el Legajo o en Flota. */
export interface DocChecklist {
  clave: string;
  nombre: string;
  aplicaA: "operador" | "vehiculo";
  condicionante: boolean;
  admiteNa: boolean;
  conClase: boolean;
  tipoId: string;
  /** null = sin fecha (o no cargado). */
  vencimiento: string | null;
  clase: string | null;
  /** aprobado / pendiente (en revisión) / null (falta cargar). */
  estado: "aprobado" | "pendiente" | null;
  /** Solo en checklists guardados: marcado "No aplica". */
  na?: boolean;
}

export function aDocChecklist(f: Record<string, unknown>): DocChecklist {
  return {
    clave: String(f.clave ?? ""),
    nombre: String(f.nombre ?? ""),
    aplicaA: f.aplica_a === "vehiculo" ? "vehiculo" : "operador",
    condicionante: f.condicionante === true,
    admiteNa: f.admite_na === true,
    conClase: f.con_clase === true,
    tipoId: String(f.tipo_id ?? ""),
    vencimiento: f.vencimiento ? String(f.vencimiento) : null,
    clase: f.clase ? String(f.clase) : null,
    estado: f.estado === "aprobado" || f.estado === "pendiente" ? f.estado : null,
    na: f.na === true,
  };
}

/** Por qué un documento no habilita hoy ("" = habilita). Misma regla que la base: vence hoy = vigente. */
export function problemaDocumento(d: DocChecklist) {
  if (d.estado === null) return "falta cargar";
  if (d.estado !== "aprobado") return "en revisión";
  if (d.vencimiento && d.vencimiento < hoy()) return "vencido";
  return "";
}

/** Documento condicionante que hoy bloquea el checklist. */
export function documentoBloquea(d: DocChecklist, na = false) {
  return d.condicionante && !na && problemaDocumento(d) !== "";
}

/** Documentos que pide el checklist del vehículo para el usuario actual. `version` fuerza la recarga. */
export function useDocumentosChecklist(vehiculoId: string, version: unknown) {
  const [documentos, setDocumentos] = useState<DocChecklist[] | null>(null);
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!vehiculoId) { setDocumentos(null); return; }
    let activo = true;
    getSupabase().rpc("documentos_checklist", { p_vehiculo_id: vehiculoId }).then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(mensajeDeError(fallo));
        setDocumentos([]);
        return;
      }
      setError("");
      setDocumentos((Array.isArray(data) ? data : []).map(aDocChecklist));
    });
    return () => { activo = false; };
  }, [vehiculoId, version, recarga]);

  const refresh = useCallback(() => setRecarga((n) => n + 1), []);
  return { documentos, error, refresh };
}

/** Avisa a los administradores qué documentos del vehículo faltan o vencieron en Flota. */
export async function avisarDocumentosVehiculo(vehiculoId: string, faltantes: string[]) {
  const { error } = await getSupabase().rpc("avisar_documentos_vehiculo", { p_vehiculo_id: vehiculoId, p_faltantes: faltantes });
  if (error) throw new Error(mensajeDeError(error));
}

/** Carga una licencia o habilitación en el legajo (queda en revisión si no la carga un supervisor). */
export async function cargarDocumentoLegajo(doc: { operadorId: string; tipoId: string; vencimiento: string; clase: string; archivo: File }) {
  const path = await subirArchivo(doc.operadorId, doc.archivo);
  const { error } = await getSupabase().from("documentos_legajo").insert({
    operador_id: doc.operadorId,
    tipo_documento_id: doc.tipoId,
    vencimiento: doc.vencimiento || null,
    clase: doc.clase.trim() || null,
    archivo_path: path,
    archivo_nombre: doc.archivo.name,
  });
  if (error) {
    await borrarArchivo(path);
    throw new Error(mensajeDeError(error));
  }
}

// ---------- Datos del conductor (ficha del operador) ----------

export interface DatosConductor { dni: string; nroLegajo: string }

export function useMisDatosConductor() {
  const [datos, setDatos] = useState<DatosConductor | null>(null);
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let activo = true;
    getSupabase().rpc("mis_datos_conductor").then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(mensajeDeError(fallo));
        return;
      }
      const f = Array.isArray(data) ? data[0] : null;
      setDatos({ dni: String(f?.dni ?? ""), nroLegajo: String(f?.nro_legajo ?? "") });
    });
    return () => { activo = false; };
  }, [recarga]);

  const refresh = useCallback(() => setRecarga((n) => n + 1), []);
  return { datos, error, refresh };
}

export async function guardarDatosConductor(dni: string, nroLegajo: string, operadorId?: string) {
  const { error } = await getSupabase().rpc("guardar_datos_conductor", {
    p_dni: dni, p_nro_legajo: nroLegajo, p_operador_id: operadorId ?? null,
  });
  if (error) throw new Error(mensajeDeError(error));
}

// ---------- Vehículos para el checklist ----------

export interface VehiculoChecklist {
  id: string;
  dominio: string;
  marcaModelo: string;
  equipo: string;
  tipoFlota: TipoFlota | null;
  vencSeguro: string;
  vencPatente: string;
}

export function useVehiculosChecklist() {
  const [vehiculos, setVehiculos] = useState<VehiculoChecklist[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    getSupabase().rpc("vehiculos_checklist").then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(mensajeDeError(fallo));
        setVehiculos([]);
        return;
      }
      setVehiculos((Array.isArray(data) ? data : []).map((v: Record<string, unknown>) => ({
        id: String(v.id),
        dominio: String(v.dominio ?? ""),
        marcaModelo: String(v.marca_modelo ?? ""),
        equipo: String(v.equipo ?? ""),
        tipoFlota: v.tipo_flota === "Pesada" || v.tipo_flota === "Liviana" ? v.tipo_flota : null,
        vencSeguro: String(v.venc_seguro ?? ""),
        vencPatente: String(v.venc_patente ?? ""),
      })));
    });
    return () => { activo = false; };
  }, []);

  return { vehiculos, error };
}

// ---------- Estado del checklist de un vehículo (condición del gerenciamiento) ----------

export interface EstadoChecklistVehiculo {
  id: number;
  creadoEn: string;
  apto: boolean;
  usuario: string;
  fallas: string[];
}

/** Último checklist del vehículo en las últimas 24 h, o null si no hay. undefined mientras carga. */
/** Salida de un gerenciamiento en hora argentina (UTC−3, sin horario de verano) como ISO. */
export function salidaIso(fecha: string, hora: string) {
  return fecha && hora ? new Date(`${fecha}T${hora}:00-03:00`).toISOString() : "";
}

/** El checklist de un viaje se hace dentro de las 24 h previas a la salida: ¿todavía falta para poder hacerlo? */
export function salidaLejana(iso: string) {
  return !!iso && new Date(iso).getTime() > Date.now() + 24 * 3_600_000;
}

/** Último checklist del vehículo desde 24 h antes de la salida (sin salida: ahora). */
export function useEstadoChecklistVehiculo(vehiculoId: string, salida?: string) {
  const [estado, setEstado] = useState<EstadoChecklistVehiculo | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vehiculoId) { setEstado(undefined); return; }
    let activo = true;
    setEstado(undefined);
    getSupabase().rpc("estado_checklist_vehiculo", { p_vehiculo_id: vehiculoId, p_salida: salida || null }).then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        setError(/does not exist|schema cache|Could not find/i.test(fallo.message)
          ? "No se pudo verificar el checklist del vehículo: falta aplicar la migración del checklist por flota."
          : fallo.message);
        setEstado(null);
        return;
      }
      setError("");
      const fila = Array.isArray(data) ? data[0] : null;
      setEstado(fila ? {
        id: Number(fila.id),
        creadoEn: String(fila.creado_en),
        apto: fila.apto === true,
        usuario: String(fila.usuario ?? ""),
        fallas: Array.isArray(fila.fallas) ? fila.fallas.map(String) : [],
      } : null);
    });
    return () => { activo = false; };
  }, [vehiculoId, salida]);

  return { estado, error };
}
