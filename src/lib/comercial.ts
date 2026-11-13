import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { borrarArchivo, subirArchivo } from "./legajos";

// Clientes, contratos y certificaciones (Supabase, solo Admin). Las columnas de
// esas tres tablas se leen de la base, así los formularios muestran las reales.

export type Tabla = "clientes" | "contratos" | "certificaciones";
export type Fila = { id: string } & Record<string, unknown>;
export interface Opcion { id: string; nombre: string }

/** Columna editable de una tabla, tal como la informa la base. */
export interface Columna {
  columna: string;
  /** "lista" = varios textos (por ejemplo los emails del cliente). */
  tipo: "texto" | "numero" | "fecha" | "booleano" | "enum" | "lista";
  obligatoria: boolean;
  opciones: string[] | null;
}

/** Certificado o requisito que exigen los clientes. */
export interface Certificado {
  id: string;
  nombre: string;
  emisor: string | null;
  fecha_emision: string | null;
  vencimiento: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  aplica_a_todos: boolean;
  observaciones: string | null;
}

export interface NotaHistorial {
  id: string;
  cliente_id: string;
  fecha: string;
  tipo: string;
  detalle: string;
}

export const TIPOS_NOTA = ["Nota", "Llamada", "Reunión", "Email", "Reclamo", "Pago"];

export interface DatosComerciales {
  columnas: Record<Tabla, Columna[]>;
  clientes: Fila[];
  contratos: Fila[];
  certificaciones: Fila[];
  vehiculos: Opcion[];
  certificados: Certificado[];
  certificadoClientes: { certificado_id: string; cliente_id: string }[];
  certificadoContratos: { certificado_id: string; contrato_id: string }[];
}

const ETIQUETAS: Record<string, string> = {
  dominio: "Dominio",
  marca_modelo: "Marca / modelo",
  equipo: "Equipo",
  estado: "Estado",
  titularidad: "Titularidad",
  venc_seguro: "Vencimiento seguro",
  venc_patente: "Vencimiento patente",
  ultimo_service: "Último service",
  proximo_service: "Próximo service",
  razon_social: "Razón social",
  cuit: "CUIT",
  condicion_iva: "Condición de IVA",
  contacto: "Contacto",
  emails: "Emails para partes y certificaciones",
  modalidad: "Modalidad",
  tarifa_unitaria: "Tarifa unitaria",
  porcentaje_infoauto: "% sobre Infoauto",
  vigente: "Vigente (disponible para partes)",
  periodo: "Período",
  cantidad: "Cantidad (días / horas / km)",
  valor_infoauto_mes: "Valor Infoauto del mes",
  localidad: "Localidad",
  provincia: "Provincia",
  observaciones: "Observaciones",
  domicilio_fiscal: "Domicilio fiscal",
  codigo_postal: "Código postal",
  telefono: "Teléfono",
  condicion_pago_dias: "Plazo de pago (días)",
  cliente_id: "Cliente",
  vehiculo_id: "Vehículo",
  contrato_id: "Contrato",
  estado_contrato: "Estado del contrato",
  fecha_inicio: "Inicio",
  fecha_fin: "Fin",
  unidad_medida: "Unidad de medida",
  nro_factura: "N° de factura",
  fecha_factura: "Fecha de factura",
  fecha_cobro: "Fecha de cobro",
};

export function etiquetaColumna(columna: string) {
  return ETIQUETAS[columna] ?? columna.replace(/_/g, " ").replace(/^./, (letra) => letra.toUpperCase());
}

export function texto(valor: unknown) {
  return valor === null || valor === undefined || valor === "" ? "" : String(valor);
}

export function useComercial() {
  const [datos, setDatos] = useState<DatosComerciales | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const respuestas = await Promise.all([
        supabase.rpc("columnas_tabla", { p_tabla: "clientes" }),
        supabase.rpc("columnas_tabla", { p_tabla: "contratos" }),
        supabase.rpc("columnas_tabla", { p_tabla: "certificaciones" }),
        supabase.from("clientes").select("*").order("razon_social"),
        supabase.from("contratos").select("*"),
        supabase.from("certificaciones").select("*"),
        supabase.from("vehiculos").select("id, dominio").order("dominio"),
        supabase.from("certificados_empresa").select("*").order("nombre"),
        supabase.from("certificado_clientes").select("*"),
        supabase.from("certificado_contratos").select("*"),
      ]);
      const fallo = respuestas.find((r) => r.error)?.error;
      if (fallo) throw new Error(fallo.message);
      const [colClientes, colContratos, colCertificaciones, clientes, contratos, certificaciones, vehiculos, certificados, deClientes, deContratos] =
        respuestas.map((r) => r.data ?? []);
      // Los ids se comparan como texto (la ruta los trae así), sea cual sea su tipo en la base.
      const conIdTexto = (filas: Fila[]) => filas.map((fila) => ({ ...fila, id: String(fila.id) }));
      setDatos({
        columnas: { clientes: colClientes, contratos: colContratos, certificaciones: colCertificaciones },
        clientes: conIdTexto(clientes),
        contratos: conIdTexto(contratos),
        certificaciones: conIdTexto(certificaciones),
        vehiculos: (vehiculos as { id: string; dominio: unknown }[]).map((v) => ({ id: v.id, nombre: texto(v.dominio) })),
        certificados,
        certificadoClientes: deClientes,
        certificadoContratos: deContratos,
      });
      setError("");
    } catch (fallo) {
      setError(`No se pudieron cargar los datos${fallo instanceof Error ? `: ${fallo.message}` : "."} Verificá que la migración de clientes y contratos esté aplicada.`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { datos, error, refresh };
}

export function nombreCliente(datos: DatosComerciales, id: unknown) {
  return texto(datos.clientes.find((c) => c.id === id)?.razon_social) || "—";
}

export function nombreContrato(datos: DatosComerciales, contrato: Fila | undefined) {
  if (!contrato) return "—";
  const dominio = datos.vehiculos.find((v) => v.id === contrato.vehiculo_id)?.nombre;
  return [nombreCliente(datos, contrato.cliente_id), dominio, texto(contrato.modalidad)].filter(Boolean).join(" · ");
}

/** Opciones para las columnas que apuntan a otra tabla. */
export function referencias(datos: DatosComerciales): Record<string, Opcion[]> {
  return {
    cliente_id: datos.clientes.map((c) => ({ id: c.id, nombre: texto(c.razon_social) })),
    vehiculo_id: datos.vehiculos,
    contrato_id: datos.contratos.map((c) => ({ id: c.id, nombre: nombreContrato(datos, c) })),
  };
}

export function contratosDe(datos: DatosComerciales, clienteId: string) {
  return datos.contratos.filter((c) => c.cliente_id === clienteId);
}

export function certificacionesDe(datos: DatosComerciales, contratos: Fila[]) {
  const ids = new Set(contratos.map((c) => c.id));
  return datos.certificaciones
    .filter((c) => ids.has(texto(c.contrato_id)))
    .sort((a, b) => texto(b.periodo).localeCompare(texto(a.periodo)));
}

/** Certificados que aplican a un cliente (o a alguno de sus contratos) o a un contrato puntual. */
export function certificadosDe(datos: DatosComerciales, clienteId: string | null, contratos: Fila[]) {
  const ids = new Set(contratos.map((c) => c.id));
  return datos.certificados.filter((certificado) =>
    certificado.aplica_a_todos ||
    datos.certificadoClientes.some((v) => v.certificado_id === certificado.id && v.cliente_id === clienteId) ||
    datos.certificadoContratos.some((v) => v.certificado_id === certificado.id && ids.has(v.contrato_id)));
}

export const CLASE_ESTADO_CONTRATO: Record<string, string> = {
  Pendiente: "en-revision",
  "En curso": "vigente",
  "Realizado - falta de pago": "vencido",
  Finalizado: "sin-datos",
};

/**
 * Importe a facturar de una certificación mensual, con la fórmula de la especificación:
 * si hay valor Infoauto del mes, valor × porcentaje del contrato; si no, cantidad × tarifa.
 */
export function importeCertificacion(datos: DatosComerciales, certificacion: Fila) {
  const contrato = datos.contratos.find((c) => c.id === texto(certificacion.contrato_id));
  if (!contrato) return null;
  const infoauto = Number(certificacion.valor_infoauto_mes);
  if (certificacion.valor_infoauto_mes !== null && Number.isFinite(infoauto) && infoauto > 0) {
    const porcentaje = Number(contrato.porcentaje_infoauto);
    // El porcentaje puede estar cargado como 6 o como 0,06.
    return Number.isFinite(porcentaje) && contrato.porcentaje_infoauto !== null
      ? infoauto * (porcentaje > 1 ? porcentaje / 100 : porcentaje) : null;
  }
  const tarifa = Number(contrato.tarifa_unitaria);
  const cantidad = Number(certificacion.cantidad);
  return contrato.tarifa_unitaria !== null && Number.isFinite(tarifa) && Number.isFinite(cantidad) ? cantidad * tarifa : null;
}

export function formatImporte(importe: number | null) {
  return importe === null ? "Sin tarifa" : importe.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/** Situación de cobro de una certificación mensual. */
export function estadoCobro(certificacion: Fila) {
  if (texto(certificacion.fecha_cobro)) return { clase: "vigente", texto: "Cobrada" };
  if (texto(certificacion.nro_factura)) return { clase: "vencido", texto: "Facturada, falta cobro" };
  return { clase: "sin-datos", texto: "Sin facturar" };
}

/** Crea (id null) o modifica una fila. Devuelve su id. */
export async function guardarFila(tabla: Tabla, id: string | null, datos: Record<string, unknown>) {
  const { data, error } = await getSupabase().rpc("guardar_fila", { p_tabla: tabla, p_id: id, p_datos: datos });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function eliminarFila(tabla: Tabla, id: string) {
  const { error } = await getSupabase().rpc("eliminar_fila", { p_tabla: tabla, p_id: id });
  if (error) throw new Error(error.message);
}

export async function agregarNota(nota: Omit<NotaHistorial, "id">) {
  const { error } = await getSupabase().from("cliente_historial").insert(nota);
  if (error) throw new Error(error.message);
}

export async function eliminarNota(id: string) {
  const { error } = await getSupabase().from("cliente_historial").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Crea o edita un certificado y reemplaza los clientes y contratos a los que aplica. */
export async function guardarCertificado(certificado: {
  anterior: Certificado | null;
  campos: Pick<Certificado, "nombre" | "emisor" | "fecha_emision" | "vencimiento" | "aplica_a_todos" | "observaciones">;
  archivo: File | null;
  clienteIds: string[];
  contratoIds: string[];
}) {
  const supabase = getSupabase();
  const { anterior, archivo } = certificado;
  const fila: Record<string, unknown> = { ...certificado.campos };
  if (archivo) {
    fila.archivo_path = await subirArchivo("certificados", archivo, "certificados");
    fila.archivo_nombre = archivo.name;
  }

  const guardado = anterior
    ? await supabase.from("certificados_empresa").update(fila).eq("id", anterior.id).select("id").single()
    : await supabase.from("certificados_empresa").insert(fila).select("id").single();
  if (guardado.error) {
    if (archivo) await borrarArchivo(String(fila.archivo_path), "certificados");
    throw new Error(guardado.error.message);
  }
  if (archivo && anterior?.archivo_path) await borrarArchivo(anterior.archivo_path, "certificados");

  const id: string = guardado.data.id;
  const pasos = [
    await supabase.from("certificado_clientes").delete().eq("certificado_id", id),
    await supabase.from("certificado_contratos").delete().eq("certificado_id", id),
    certificado.clienteIds.length
      ? await supabase.from("certificado_clientes").insert(certificado.clienteIds.map((cliente_id) => ({ certificado_id: id, cliente_id })))
      : null,
    certificado.contratoIds.length
      ? await supabase.from("certificado_contratos").insert(certificado.contratoIds.map((contrato_id) => ({ certificado_id: id, contrato_id })))
      : null,
  ];
  const fallo = pasos.find((paso) => paso?.error)?.error;
  if (fallo) throw new Error(`El certificado se guardó, pero no a quién aplica: ${fallo.message}`);
}

export async function eliminarCertificado(certificado: Certificado) {
  const { error } = await getSupabase().from("certificados_empresa").delete().eq("id", certificado.id);
  if (error) throw new Error(error.message);
  if (certificado.archivo_path) await borrarArchivo(certificado.archivo_path, "certificados");
}
