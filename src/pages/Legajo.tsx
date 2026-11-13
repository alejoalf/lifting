import { useAuth } from "../auth/AuthProvider";
import { LegajoOperador } from "../components/legajo/LegajoOperador";

export default function Legajo() {
  const { operador } = useAuth();
  if (!operador) return null;
  return <LegajoOperador operadorId={operador.operadorId} gestor={operador.rol === "admin" || operador.rol === "supervisor"} />;
}
