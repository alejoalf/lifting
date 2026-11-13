import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { TablaPartes } from "../../components/partes/TablaPartes";
import { ESTADOS_PARTE, contiene, useColeccion, type EstadoParte } from "../../lib/registros";

export default function SupervisorPanel() {
  const { operador } = useAuth();
  const partes = useColeccion("partesDiarios");
  const [estado, setEstado] = useState<EstadoParte | "">("");
  const [busqueda, setBusqueda] = useState("");

  const excepciones = partes.filter((p) => p.estado === "excepcion");
  const sinFirma = partes.filter((p) => p.estado === "cerrado" && !p.firmadoEn);
  const firmados = partes.filter((p) => p.estado === "cerrado" && p.firmadoEn).length;
  const enCurso = partes.filter((p) => p.estado === "en_curso").length;
  const filtrados = partes.filter((p) =>
    (!estado || p.estado === estado) &&
    contiene(`${p.operador} ${p.vehiculo} ${p.cliente} ${p.origen} ${p.destino}`, busqueda));
  const nombre = operador?.nombre_completo.trim().split(/\s+/)[0] || "equipo";

  return (
    <div className="dashboard-page dashboard-supervisor">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">CENTRO DE OPERACIONES</span>
          <h2>Buen día, {nombre}</h2>
          <p>Revisá el estado de los partes y atendé las operaciones que necesitan seguimiento.</p>
        </div>
        <div className="dashboard-hero-actions">
          <Link className="dashboard-button dashboard-button-secondary" to="/observaciones/nueva">Nueva observación <span aria-hidden="true">→</span></Link>
          <Link className="dashboard-button" to="/gerenciamientos/nuevo">Nuevo gerenciamiento <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="dashboard-stats" aria-label="Resumen de operaciones">
        <article className="dashboard-stat dashboard-stat-warning">
          <span className="dashboard-stat-icon" aria-hidden="true">!</span>
          <span className="dashboard-stat-label">EXCEPCIONES PENDIENTES</span>
          <strong>{excepciones.length}</strong>
          <span className="dashboard-stat-detail">Requieren revisión</span>
        </article>
        <article className="dashboard-stat dashboard-stat-blue">
          <span className="dashboard-stat-icon" aria-hidden="true">◷</span>
          <span className="dashboard-stat-label">OPERACIONES EN CURSO</span>
          <strong>{enCurso}</strong>
          <span className="dashboard-stat-detail">Partes activos</span>
        </article>
        <article className="dashboard-stat dashboard-stat-neutral">
          <span className="dashboard-stat-icon" aria-hidden="true">✎</span>
          <span className="dashboard-stat-label">CERRADOS SIN FIRMA</span>
          <strong>{sinFirma.length}</strong>
          <span className="dashboard-stat-detail">Esperan completar firma</span>
        </article>
        <article className="dashboard-stat dashboard-stat-success">
          <span className="dashboard-stat-icon" aria-hidden="true">✓</span>
          <span className="dashboard-stat-label">FIRMADOS</span>
          <strong>{firmados}</strong>
          <span className="dashboard-stat-detail">Listos para facturar</span>
        </article>
      </section>

      {excepciones.length > 0 && (
        <section className="panel dashboard-priority">
          <h2 className="panel-header">Pedidos de salida excepcional</h2>
          <div className="panel-body">
            <p className="ayuda">Unidades con documentación vencida. Solo un administrador puede autorizar o frenar la salida.</p>
            <TablaPartes partes={excepciones} mostrarOperador />
          </div>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-header">Pendientes de firma</h2>
        <div className="panel-body">
          {sinFirma.length === 0
            ? <p className="vacio">No hay partes cerrados esperando firma.</p>
            : <TablaPartes partes={sinFirma} mostrarOperador />}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Todos los partes</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Operador, vehículo, cliente o destino" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoParte | "")}>
                <option value="">Todos</option>
                {Object.entries(ESTADOS_PARTE).map(([clave, label]) => <option key={clave} value={clave}>{label}</option>)}
              </select>
            </label>
          </div>
          {filtrados.length === 0
            ? <p className="vacio">{partes.length === 0 ? "Todavía no hay partes cargados." : "Ningún parte coincide con los filtros."}</p>
            : <><TablaPartes partes={filtrados} mostrarOperador /><p className="resultados">Cantidad de resultados: {filtrados.length}</p></>}
        </div>
      </section>
    </div>
  );
}
