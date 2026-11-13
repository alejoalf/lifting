import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import type { EstadoParte, Parte } from "./registros";

export type TipoTarea = "Transporte" | "Izaje Hidrogrua" | "Altura Barquilla";

export interface CatalogoParte {
  clientes: { id: string; nombre: string }[];
  vehiculos: { id: string; nombre: string }[];
  contratos: { id: string; nombre: string; clienteId: string; vehiculoId: string }[];
}

export interface NuevoParte {
  clienteId: string;
  contratoId: string | null;
  vehiculoId: string;
  tipoTarea: TipoTarea;
  origen: string;
  destino: string;
  kmInicial: number;
  observaciones: string;
}

const estados: Record<string, EstadoParte> = {
  Pendiente: "pendiente",
  Excepcion: "excepcion",
  "En Curso": "en_curso",
  Frenado: "frenado",
  Cerrado: "cerrado",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function texto(row: Record<string, unknown>, campo: string) {
  const value = row[campo];
  return typeof value === "string" ? value : "";
}

function numero(row: Record<string, unknown>, campo: string) {
  const value = Number(row[campo]);
  if (!Number.isFinite(value)) throw new Error(`El campo ${campo} del parte no es válido.`);
  return value;
}

function numeroOpcional(row: Record<string, unknown>, campo: string) {
  const value = row[campo];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`El campo ${campo} del parte no es válido.`);
  return parsed;
}

function mapearParte(value: unknown): Parte {
  if (!isRecord(value)) throw new Error("Supabase devolvió un parte con formato inválido.");
  const estado = estados[texto(value, "estado")];
  if (!estado) throw new Error(`El estado "${texto(value, "estado")}" del parte no está reconocido.`);

  return {
    id: texto(value, "id"),
    numero: numero(value, "nro_parte"),
    creadoPor: texto(value, "auth_user_id"),
    operador: texto(value, "operador"),
    creadoEn: texto(value, "creado_en"),
    fecha: texto(value, "fecha"),
    cliente: texto(value, "cliente"),
    contrato: texto(value, "contrato"),
    vehiculo: texto(value, "vehiculo"),
    tarea: texto(value, "tarea"),
    origen: texto(value, "origen"),
    destino: texto(value, "destino"),
    kmInicial: numero(value, "km_inicial"),
    observaciones: texto(value, "observaciones"),
    semaforo: null,
    documentosVencidos: [],
    estado,
    resueltoPor: texto(value, "resuelto_por"),
    resueltoEn: texto(value, "resuelto_en"),
    motivoFreno: texto(value, "motivo_freno"),
    salidaEn: texto(value, "salida_en"),
    cerradoEn: texto(value, "cerrado_en"),
    kmFinal: numeroOpcional(value, "km_final"),
    horasDeclaradas: numeroOpcional(value, "horas_declaradas"),
    trabajoRealizado: texto(value, "trabajo_realizado"),
    firmadoPor: texto(value, "firmado_por"),
    firmadoEn: texto(value, "firmado_en"),
  };
}

export function usePartes() {
  const [partes, setPartes] = useState<Parte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: fallo } = await getSupabase().rpc("listar_partes_diarios");
      if (fallo) throw new Error(fallo.message);
      if (!Array.isArray(data)) throw new Error("La respuesta de Supabase no tiene el formato esperado.");
      setPartes(data.map(mapearParte));
    } catch (fallo) {
      setPartes([]);
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar los partes. Revisá la conexión e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { partes, loading, error, refresh };
}

export function useCatalogoPartes() {
  const [catalogo, setCatalogo] = useState<CatalogoParte>({ clientes: [], vehiculos: [], contratos: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function cargar() {
      setLoading(true);
      setError("");
      try {
        const { data, error: fallo } = await getSupabase().rpc("catalogo_partes_diarios");
        if (fallo) throw new Error(fallo.message);
        if (!Array.isArray(data)) throw new Error("La respuesta del catálogo no tiene el formato esperado.");

        const siguiente: CatalogoParte = { clientes: [], vehiculos: [], contratos: [] };
        for (const value of data) {
          if (!isRecord(value)) throw new Error("Supabase devolvió una opción del catálogo con formato inválido.");
          const item = { id: texto(value, "id"), nombre: texto(value, "nombre") };
          if (!item.id || !item.nombre) throw new Error("Una opción del catálogo no tiene identificador o nombre.");

          if (value.tipo === "cliente") siguiente.clientes.push(item);
          else if (value.tipo === "vehiculo") siguiente.vehiculos.push(item);
          else if (value.tipo === "contrato") {
            siguiente.contratos.push({
              ...item,
              clienteId: texto(value, "cliente_id"),
              vehiculoId: texto(value, "vehiculo_id"),
            });
          } else {
            throw new Error("Supabase devolvió un tipo de catálogo no reconocido.");
          }
        }

        if (active) setCatalogo(siguiente);
      } catch (fallo) {
        if (active) setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el catálogo. Revisá la conexión e intentá de nuevo.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void cargar();
    return () => { active = false; };
  }, []);

  return { catalogo, loading, error };
}

export async function crearParte(input: NuevoParte) {
  const { data, error } = await getSupabase().rpc("crear_parte_diario", {
    p_cliente_id: input.clienteId,
    p_contrato_id: input.contratoId,
    p_vehiculo_id: input.vehiculoId,
    p_tipo_tarea: input.tipoTarea,
    p_origen: input.origen,
    p_destino: input.destino,
    p_km_inicial: input.kmInicial,
    p_observaciones: input.observaciones,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || !isRecord(data[0]) || typeof data[0].parte_id !== "string") {
    throw new Error("No se pudo confirmar la creación del parte. Actualizá la lista antes de volver a intentarlo.");
  }
  const numeroParte = Number(data[0].numero);
  if (!Number.isSafeInteger(numeroParte) || numeroParte < 1) {
    throw new Error("El parte se creó, pero Supabase devolvió un número de parte inválido.");
  }
  return { id: data[0].parte_id, numero: numeroParte };
}
