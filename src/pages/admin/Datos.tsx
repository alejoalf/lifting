import { Navigate, useParams } from "react-router-dom";
import { TablaRemota } from "../../components/datos/TablaRemota";

/** Secciones administrativas de solo lectura y su tabla en Supabase. Clientes, contratos y certificaciones tienen pantallas propias. */
export const SECCIONES_ADMIN: Record<string, { tabla: string; titulo: string }> = {
  caja: { tabla: "caja_gastos", titulo: "Caja y gastos" },
  proveedores: { tabla: "proveedores", titulo: "Proveedores" },
};

export default function DatosAdmin() {
  const { seccion = "" } = useParams();
  const config = SECCIONES_ADMIN[seccion];
  if (!config) return <Navigate to="/admin" replace />;
  return <TablaRemota key={config.tabla} tabla={config.tabla} titulo={config.titulo} />;
}
