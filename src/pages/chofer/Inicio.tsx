import { Link } from "react-router-dom";

export default function ChoferInicio() {
  return (
    <>
      <p className="vacio">No tenés un parte abierto. Elegí vehículo y tarea para empezar.</p>
      <Link to="/chofer/nuevo" className="primary">Abrir parte diario</Link>
    </>
  );
}
