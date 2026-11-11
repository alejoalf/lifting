import { Link } from "react-router-dom";
import { AppShell } from "../../components/layout/AppShell";

export default function ChoferInicio() {
  return (
    <AppShell titulo="Parte de hoy">
      <p className="vacio">No tenés un parte abierto. Elegí vehículo y tarea para empezar.</p>
      <Link to="/chofer/nuevo" className="primary">Abrir parte diario</Link>
    </AppShell>
  );
}
