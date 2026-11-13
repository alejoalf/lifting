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
  const cerrados = anteriores.filter((p) => p.estado === "cerrado");
  const pendientesFirma = cerrados.filter((p) => !p.firmadoEn);
  const nombre = operador?.nombre_completo.trim().split(/\s+/)[0] || "operador";

  return (
    <div className="dashboard-page dashboard-driver">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">PORTAL DEL OPERADOR</span>
          <h2>Buen día, {nombre}</h2>
          <p>Tené a mano tus partes y accesos para empezar la jornada.</p>
        </div>
        <Link className="dashboard-button" to={abierto ? `/partes/${abierto.id}` : "/chofer/nuevo"}>
          {abierto ? "Continuar parte" : "Iniciar parte"}
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="dashboard-stats" aria-label="Resumen de tus partes">
        <article className="dashboard-stat">
          <span className="dashboard-stat-icon" aria-hidden="true">↗</span>
          <span className="dashboard-stat-label">PARTES REGISTRADOS</span>
          <strong>{propios.length}</strong>
          <span className="dashboard-stat-detail">En tu historial</span>
        </article>
        <article className="dashboard-stat">
          <span className="dashboard-stat-icon" aria-hidden="true">◷</span>
          <span className="dashboard-stat-label">PARTE ABIERTO</span>
          <strong>{abierto ? "1" : "0"}</strong>
          <span className="dashboard-stat-detail">{abierto ? "Requiere seguimiento" : "Listo para iniciar"}</span>
        </article>
        <article className="dashboard-stat">
          <span className="dashboard-stat-icon" aria-hidden="true">✓</span>
          <span className="dashboard-stat-label">PENDIENTES DE FIRMA</span>
          <strong>{pendientesFirma.length}</strong>
          <span className="dashboard-stat-detail">Partes cerrados sin firma</span>
        </article>
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-heading">
          <div>
            <span className="dashboard-section-kicker">ESTADO ACTUAL</span>
            <h2>Parte abierto</h2>
          </div>
          {abierto && <EstadoParteChip estado={abierto.estado} />}
        </div>
        {abierto ? (
          <>
            <p className="parte-resumen">
              <strong>Parte N° {abierto.id}</strong> · {abierto.vehiculo} · {abierto.tarea}
            </p>
            <p className="dashboard-supporting-text">{siguientePaso[abierto.estado]}</p>
            <div className="actions"><Link to={`/partes/${abierto.id}`} className="dashboard-text-link">Ver detalle del parte <span aria-hidden="true">→</span></Link></div>
          </>
        ) : (
          <>
            <p className="dashboard-supporting-text">No tenés un parte abierto. Elegí vehículo y tarea para empezar.</p>
            <div className="actions"><Link to="/chofer/nuevo" className="dashboard-text-link">Abrir parte diario <span aria-hidden="true">→</span></Link></div>
          </>
        )}
      </section>

      <nav className="dashboard-shortcuts" aria-label="Accesos rápidos">
        <Link className="dashboard-shortcut" to="/legajo">
          <span className="dashboard-shortcut-icon" aria-hidden="true">01</span>
          <span><strong>Mi legajo</strong><small>Consultá tu documentación</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
        <Link className="dashboard-shortcut" to="/checklist">
          <span className="dashboard-shortcut-icon" aria-hidden="true">02</span>
          <span><strong>Checklist vehicular</strong><small>Revisá los controles</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
        <Link className="dashboard-shortcut" to="/gerenciamientos/nuevo">
          <span className="dashboard-shortcut-icon" aria-hidden="true">03</span>
          <span><strong>Nuevo gerenciamiento</strong><small>Organizá un traslado</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
      </nav>

      <section className="panel dashboard-history">
        <h2 className="panel-header">Partes anteriores</h2>
        <div className="panel-body">
          {anteriores.length === 0
            ? <p className="vacio">Todavía no tenés partes anteriores.</p>
            : <TablaPartes partes={anteriores} />}
        </div>
      </section>
    </div>
  );
}
