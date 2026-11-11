import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import type { Rol } from "../lib/supabase";

export const homeFor = (rol: Rol) =>
  rol === "admin" ? "/admin" : rol === "supervisor" ? "/supervisor" : "/chofer";

export function RequireRole({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { session, operador, loading, perfilError } = useAuth();
  if (loading) return <p className="estado">Cargando…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (perfilError) return <p className="estado error">{perfilError}</p>;
  if (!operador) return <p className="estado">Tu usuario no está vinculado a un operador. En `operadores`, asociá el UUID de Authentication en `auth_user_id`.</p>;
  if (!roles.includes(operador.rol)) return <Navigate to={homeFor(operador.rol)} replace />;
  return <>{children}</>;
}
