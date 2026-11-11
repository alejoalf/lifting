import { useState } from "react";
import { TablaPartes } from "../../components/partes/TablaPartes";
import { ESTADOS_PARTE, contiene, useColeccion, type EstadoParte } from "../../lib/registros";

export default function SupervisorPanel() {
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

  return (
    <>
      <div className="stats">
        <div className="stat stat-aviso"><span className="stat-label">EXCEPCIONES PENDIENTES</span><span className="stat-value">{excepciones.length}</span></div>
        <div className="stat stat-info"><span className="stat-label">OPERACIONES EN CURSO</span><span className="stat-value">{enCurso}</span></div>
        <div className="stat stat-total"><span className="stat-label">CERRADOS SIN FIRMA</span><span className="stat-value">{sinFirma.length}</span></div>
        <div className="stat stat-ok"><span className="stat-label">FIRMADOS, LISTOS PARA FACTURAR</span><span className="stat-value">{firmados}</span></div>
      </div>

      {excepciones.length > 0 && (
        <section className="panel">
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
    </>
  );
}
