import { useEffect, useSyncExternalStore } from "react";
import { getSupabase } from "./supabase";

// Notificaciones personales (Supabase). Las genera la base: gerenciamientos
// pendientes o aprobados, checklists con fallas, tarjetas de riesgo alto,
// partes diarios (excepción, cierre, firma) y documentos del legajo
// (pendientes de revisión, aprobados o rechazados).
// La campana y la pantalla de historial comparten este estado.

export interface Notificacion {
  id: number;
  titulo: string;
  mensaje: string;
  /** Ruta de la app a la que lleva la notificación. */
  enlace: string;
  fecha: string;
  leida: boolean;
}

const INTERVALO_MS = 60_000;

let notificaciones: Notificacion[] = [];
const oyentes = new Set<() => void>();
let temporizador: number | undefined;

function publicar(nuevas: Notificacion[]) {
  notificaciones = nuevas;
  oyentes.forEach((avisar) => avisar());
}

export async function recargarNotificaciones() {
  const { data, error } = await getSupabase()
    .from("notificaciones")
    .select("id, titulo, mensaje, enlace, leida, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  // Si la tabla todavía no existe (migración sin aplicar) la campana queda vacía.
  if (error) return;
  publicar((data ?? []).map((n) => ({
    id: Number(n.id),
    titulo: String(n.titulo),
    mensaje: String(n.mensaje),
    enlace: n.enlace ? String(n.enlace) : "",
    fecha: String(n.created_at),
    leida: n.leida === true,
  })));
}

function suscribir(avisar: () => void) {
  oyentes.add(avisar);
  if (oyentes.size === 1) {
    void recargarNotificaciones();
    temporizador = window.setInterval(() => void recargarNotificaciones(), INTERVALO_MS);
  }
  return () => {
    oyentes.delete(avisar);
    if (oyentes.size === 0) {
      window.clearInterval(temporizador);
      // Al salir de la app (por ejemplo, al cerrar sesión) no quedan avisos del usuario anterior.
      notificaciones = [];
    }
  };
}

/** Notificaciones del usuario actual. Se actualizan solas cada minuto y al cambiar de pantalla. */
export function useNotificaciones(ruta?: string) {
  const lista = useSyncExternalStore(suscribir, () => notificaciones);
  useEffect(() => {
    if (ruta !== undefined) void recargarNotificaciones();
  }, [ruta]);
  return lista;
}

export async function marcarLeida(id: number) {
  publicar(notificaciones.map((n) => (n.id === id ? { ...n, leida: true } : n)));
  await getSupabase().from("notificaciones").update({ leida: true }).eq("id", id);
}

export async function marcarTodasLeidas() {
  publicar(notificaciones.map((n) => ({ ...n, leida: true })));
  // Las políticas de la base limitan el cambio a las notificaciones propias.
  await getSupabase().from("notificaciones").update({ leida: true }).eq("leida", false);
}
