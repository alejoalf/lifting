import { Link } from "react-router-dom";
import { Shell } from "../../components";

export default function ChoferInicio() {
  return (
    <Shell titulo="Parte de hoy">
      <p className="vacio">No tenés un parte abierto. Elegí vehículo y tarea para empezar.</p>
      <Link to="/chofer/nuevo" className="primary">Abrir parte diario</Link>
    </Shell>
  );
}
