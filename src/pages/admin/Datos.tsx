import { Navigate, useParams } from "react-router-dom";
import { TablaRemota } from "../../components/datos/TablaRemota";

/** Secciones administrativas (Tablas 2 a 6 de la especificación) y su tabla en Supabase. */
export const SECCIONES_ADMIN: Record<string, { tabla: string; titulo: string }> = {
  clientes: { tabla: "clientes", titulo: "Clientes" },
  contratos: { tabla: "contratos", titulo: "Contratos y acuerdos" },
  certificaciones: { tabla: "certificaciones", titulo: "Certificaciones mensuales" },
  caja: { tabla: "caja_gastos", titulo: "Caja y gastos" },
  proveedores: { tabla: "proveedores", titulo: "Proveedores" },
};

export default function DatosAdmin() {
  const { seccion = "" } = useParams();
  const config = SECCIONES_ADMIN[seccion];
  if (!config) return <Navigate to="/admin" replace />;
  return <TablaRemota key={config.tabla} tabla={config.tabla} titulo={config.titulo} />;
}
