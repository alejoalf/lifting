import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import type { Rol } from "../lib/supabase";

export const homeFor = (rol: Rol) =>
  rol === "admin" ? "/admin" : rol === "supervisor" ? "/supervisor" : "/chofer";

export function RequireRole({ roles, children }: { roles: Rol[]; children?: ReactNode }) {
  const { session, operador, loading, perfilError } = useAuth();
  if (loading) return <p className="estado">Cargando…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (perfilError) return <p className="estado error">{perfilError}</p>;
  // Sin operador activo (solicitud pendiente, rechazada o cuenta desactivada): el login muestra el estado de la cuenta.
  if (!operador) return <Navigate to="/login" replace />;
  if (!roles.includes(operador.rol)) return <Navigate to={homeFor(operador.rol)} replace />;
  return <>{children ?? <Outlet />}</>;
}
