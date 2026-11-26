import { useCallback, useEffect, useState } from "react";
import { anularRegistro, getSupabase } from "./supabase";
import { formatFecha } from "./registros";
import { aAnulacion, type Anulacion } from "../components/ui/BotonAnular";

// Caja y gastos (Supabase, solo Admin): ingresos y egresos con categoría,
// circuito y vínculo opcional a un vehículo, un cliente o un proveedor.

export const TIPOS_MOVIMIENTO = ["Ingreso", "Egreso"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const CIRCUITOS = ["Formal", "Informal"] as const;
export type Circuito = (typeof CIRCUITOS)[number];

/** Categorías de la especificación, agrupadas según el tipo de movimiento al que corresponden. */
export const CATEGORIAS: Record<TipoMovimiento, string[]> = {
  Ingreso: ["Facturación"],
  Egreso: ["Combustible", "Mantenimiento", "Cuota Prendaria", "Intereses Punitorios", "Honorarios", "Pago Subalquiler", "Impuestos"],
};
export const TODAS_LAS_CATEGORIAS = [...CATEGORIAS.Ingreso, ...CATEGORIAS.Egreso];

export interface Movimiento {
  id: string;
  fecha: string;
  tipo: TipoMovimiento | null;
  categoria: string | null;
  monto: number;
  circuito: Circuito | null;
  concepto: string | null;
  comprobante: string | null;
  vehiculo_id: string | null;
  cliente_id: string | null;
  proveedor_id: string | null;
  /** Los movimientos anulados quedan en el libro pero no suman. */
  anulacion: Anulacion | null;
}

/** `activo` false = desactivado o dado de baja: no se ofrece en movimientos nuevos, pero se sigue mostrando. */
export interface Opcion { id: string; nombre: string; activo?: boolean }

export interface DatosCaja {
  movimientos: Movimiento[];
  vehiculos: Opcion[];
  clientes: Opcion[];
  proveedores: Opcion[];
}

function textoOVacio(valor: unknown) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

/** Acepta el valor tal como esté guardado ("egreso", "EGRESO"...) y lo lleva a la opción conocida. */
function normalizar<T extends string>(valor: unknown, opciones: readonly T[]): T | null {
  const limpio = textoOVacio(valor).toLocaleLowerCase("es");
  return opciones.find((opcion) => opcion.toLocaleLowerCase("es") === limpio) ?? null;
}

function aMovimiento(fila: Record<string, unknown>): Movimiento {
  const idOpcional = (valor: unknown) => (valor === null || valor === undefined ? null : String(valor));
  return {
    id: String(fila.id),
    fecha: textoOVacio(fila.fecha).slice(0, 10),
    tipo: normalizar(fila.tipo, TIPOS_MOVIMIENTO),
    categoria: textoOVacio(fila.categoria) || null,
    monto: Number(fila.monto) || 0,
    circuito: normalizar(fila.circuito, CIRCUITOS),
    concepto: textoOVacio(fila.concepto) || null,
    comprobante: textoOVacio(fila.comprobante) || null,
    vehiculo_id: idOpcional(fila.vehiculo_id),
    cliente_id: idOpcional(fila.cliente_id),
    proveedor_id: idOpcional(fila.proveedor_id),
    anulacion: aAnulacion(fila),
  };
}

/** Nombre visible de un proveedor, sea cual sea la columna en la que esté cargado. */
function nombreProveedor(fila: Record<string, unknown>) {
  for (const columna of ["razon_social", "nombre", "nombre_fantasia", "denominacion", "proveedor"]) {
    const valor = textoOVacio(fila[columna]);
    if (valor) return valor;
  }
  const primerTexto = Object.entries(fila).find(([columna, valor]) =>
    columna !== "id" && !columna.endsWith("_id") && typeof valor === "string" && valor.trim() && !/^\d{4}-\d{2}-\d{2}/.test(valor));
  return primerTexto ? String(primerTexto[1]) : `Proveedor ${String(fila.id)}`;
}

export function useCaja() {
  const [datos, setDatos] = useState<DatosCaja | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const [movimientos, vehiculos, clientes, proveedores] = await Promise.all([
        supabase.from("caja_gastos").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("vehiculos").select("id, dominio, estado").order("dominio"),
        supabase.from("clientes").select("id, razon_social, activo").order("razon_social"),
        supabase.from("proveedores").select("*"),
      ]);
      const fallo = [movimientos, vehiculos, clientes, proveedores].find((r) => r.error)?.error;
      if (fallo) throw new Error(fallo.message);
      setDatos({
        movimientos: (movimientos.data ?? []).map(aMovimiento),
        vehiculos: (vehiculos.data ?? []).map((v) => ({ id: String(v.id), nombre: textoOVacio(v.dominio) || "Sin dominio", activo: v.estado !== "Baja" })),
        clientes: (clientes.data ?? []).map((c) => ({ id: String(c.id), nombre: textoOVacio(c.razon_social) || "Sin razón social", activo: c.activo !== false })),
        proveedores: (proveedores.data ?? [])
          .map((p) => ({ id: String(p.id), nombre: nombreProveedor(p), activo: p.activo !== false }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      });
      setError("");
    } catch (fallo) {
      setError(`No se pudo cargar la caja${fallo instanceof Error ? `: ${fallo.message}` : "."} Verificá que la migración de caja y gastos esté aplicada.`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { datos, error, refresh };
}

export type DatosMovimiento = Omit<Movimiento, "id" | "anulacion">;

/** Crea (id null) o modifica un movimiento. Devuelve su id. */
export async function guardarMovimiento(id: string | null, movimiento: DatosMovimiento) {
  const supabase = getSupabase();
  const respuesta = id
    ? await supabase.from("caja_gastos").update(movimiento).eq("id", id).select("id").single()
    : await supabase.from("caja_gastos").insert(movimiento).select("id").single();
  if (respuesta.error) throw new Error(mensajeError(respuesta.error.message));
  return String(respuesta.data.id);
}

export const anularMovimiento = (id: string, motivo: string) => anularRegistro("caja_gastos", id, motivo);

function mensajeError(mensaje: string) {
  if (/row-level security|permission denied/i.test(mensaje)) return "Solo un administrador puede modificar la caja.";
  if (/check constraint/i.test(mensaje)) return "Alguno de los valores no es válido (revisá el monto, la categoría y el circuito).";
  if (/foreign key/i.test(mensaje)) return "El vehículo, cliente o proveedor elegido ya no existe.";
  return mensaje;
}

// ---------- Cálculos ----------

/** Importe con signo: los egresos restan. */
export function importeConSigno(m: Movimiento) {
  return m.tipo === "Egreso" ? -m.monto : m.monto;
}

export interface Totales { ingresos: number; egresos: number; saldo: number }

export function totales(movimientos: Movimiento[]): Totales {
  let ingresos = 0;
  let egresos = 0;
  for (const m of movimientos) {
    if (m.anulacion) continue;
    if (m.tipo === "Ingreso") ingresos += m.monto;
    else if (m.tipo === "Egreso") egresos += m.monto;
  }
  return { ingresos, egresos, saldo: ingresos - egresos };
}

export interface ResumenCategoria { categoria: string; tipo: TipoMovimiento | null; cantidad: number; total: number; porcentaje: number }

/** Total por categoría; el porcentaje es sobre el total de su tipo (ingresos o egresos). */
export function porCategoria(movimientos: Movimiento[]): ResumenCategoria[] {
  const { ingresos, egresos } = totales(movimientos);
  const grupos = new Map<string, ResumenCategoria>();
  for (const m of movimientos) {
    if (m.anulacion) continue;
    const categoria = m.categoria ?? "Sin categoría";
    const clave = `${m.tipo ?? ""}|${categoria}`;
    const grupo = grupos.get(clave) ?? { categoria, tipo: m.tipo, cantidad: 0, total: 0, porcentaje: 0 };
    grupo.cantidad += 1;
    grupo.total += m.monto;
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .map((g) => {
      const base = g.tipo === "Ingreso" ? ingresos : g.tipo === "Egreso" ? egresos : 0;
      return { ...g, porcentaje: base > 0 ? (g.total / base) * 100 : 0 };
    })
    .sort((a, b) => (a.tipo === b.tipo ? b.total - a.total : a.tipo === "Ingreso" ? -1 : 1));
}

// ---------- Formato ----------

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function formatMonto(monto: number) {
  return MONEDA.format(monto);
}

/** "AAAA-MM" del mes actual, para el filtro por período. */
export function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

export function hoyISO() {
  const hoy = new Date();
  return `${mesActual()}-${String(hoy.getDate()).padStart(2, "0")}`;
}

/** N° visible del movimiento: el id si es numérico, o sus primeros caracteres si es un uuid. */
export function numeroMovimiento(id: string) {
  return /^\d+$/.test(id) ? `#${id}` : id.slice(0, 8).toUpperCase();
}

/** Descarga los movimientos como CSV (separado por ";" para que Excel en español lo abra en columnas). */
export function descargarCsv(movimientos: Movimiento[], datos: DatosCaja, nombreArchivo: string) {
  const nombre = (lista: Opcion[], id: string | null) => (id ? lista.find((o) => o.id === id)?.nombre ?? "" : "");
  const celda = (valor: string) => (/[";\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor);
  const filas = [
    ["N°", "Fecha", "Tipo", "Categoría", "Concepto", "Monto", "Circuito", "Comprobante", "Vehículo", "Cliente", "Proveedor", "Anulado (motivo)"],
    ...movimientos.map((m) => [
      numeroMovimiento(m.id),
      m.fecha ? formatFecha(m.fecha) : "",
      m.tipo ?? "",
      m.categoria ?? "",
      m.concepto ?? "",
      importeConSigno(m).toFixed(2).replace(".", ","),
      m.circuito ?? "",
      m.comprobante ?? "",
      nombre(datos.vehiculos, m.vehiculo_id),
      nombre(datos.clientes, m.cliente_id),
      nombre(datos.proveedores, m.proveedor_id),
      m.anulacion?.motivo ?? "",
    ]),
  ];
  const contenido = "﻿" + filas.map((fila) => fila.map(celda).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}
