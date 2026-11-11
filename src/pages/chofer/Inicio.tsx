import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { EstadoParteChip, TablaPartes } from "../../components/partes/TablaPartes";
import { useColeccion, type EstadoParte } from "../../lib/registros";

const siguientePaso: Record<EstadoParte, string> = {
  excepcion: "Hay documentación vencida. Esperá la respuesta de Base antes de salir.",
  en_curso: "Operación en curso. Cerrá el servicio al terminar la jornada.",
  frenado: "",
  cerrado: "",
};

export default function ChoferInicio() {
  const { operador } = useAuth();
  const propios = useColeccion("partesDiarios").filter((p) => p.creadoPor === operador?.id);
  const abierto = propios.find((p) => p.estado === "excepcion" || p.estado === "en_curso");
  const anteriores = propios.filter((p) => p !== abierto);

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Parte abierto</h2>
        <div className="panel-body">
          {abierto ? (
            <>
              <p className="parte-resumen">
                <strong>Parte N° {abierto.id}</strong> · {abierto.vehiculo} · {abierto.tarea}
                <EstadoParteChip estado={abierto.estado} />
              </p>
              <p>{siguientePaso[abierto.estado]}</p>
              <div className="actions"><Link to={`/partes/${abierto.id}`} className="primary inline">Ver parte</Link></div>
            </>
          ) : (
            <>
              <p className="vacio">No tenés un parte abierto. Elegí vehículo y tarea para empezar.</p>
              <div className="actions"><Link to="/chofer/nuevo" className="primary inline">Abrir parte diario</Link></div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Partes anteriores</h2>
        <div className="panel-body">
          {anteriores.length === 0
            ? <p className="vacio">Todavía no tenés partes anteriores.</p>
            : <TablaPartes partes={anteriores} />}
        </div>
      </section>
    </>
  );
}
