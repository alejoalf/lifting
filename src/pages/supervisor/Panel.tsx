import { useState } from "react";
import { TablaPartes } from "../../components/partes/TablaPartes";
import { ESTADOS_PARTE, contiene, useColeccion, type EstadoParte } from "../../lib/registros";

export default function SupervisorPanel() {
  const partes = useColeccion("partes");
  const [estado, setEstado] = useState<EstadoParte | "">("");
  const [busqueda, setBusqueda] = useState("");

  const cantidad = (e: EstadoParte) => partes.filter((p) => p.estado === e).length;
  const pendientes = partes.filter((p) => p.estado === "pendiente");
  const filtrados = partes.filter((p) =>
    (!estado || p.estado === estado) &&
    contiene(`${p.operador} ${p.vehiculo} ${p.cliente} ${p.locacion}`, busqueda));

  return (
    <>
      <div className="stats">
        <div className="stat stat-aviso"><span className="stat-label">PENDIENTES DE AUTORIZACIÓN</span><span className="stat-value">{pendientes.length}</span></div>
        <div className="stat stat-ok"><span className="stat-label">AUTORIZADOS SIN SALIR</span><span className="stat-value">{cantidad("autorizado")}</span></div>
        <div className="stat stat-info"><span className="stat-label">OPERACIONES EN CURSO</span><span className="stat-value">{cantidad("en_curso")}</span></div>
        <div className="stat stat-total"><span className="stat-label">SERVICIOS CERRADOS</span><span className="stat-value">{cantidad("cerrado")}</span></div>
      </div>

      <section className="panel">
        <h2 className="panel-header">Pedidos de autorización</h2>
        <div className="panel-body">
          {pendientes.length === 0
            ? <p className="vacio">No hay pedidos de autorización pendientes.</p>
            : <TablaPartes partes={pendientes} mostrarOperador />}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Todos los partes</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Operador, vehículo, cliente o locación" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
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
