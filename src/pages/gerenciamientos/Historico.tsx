import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { actualizar, notificar, contiene, formatFecha, hoy, useColeccion, type Gerenciamiento } from "../../lib/registros";

const filtrosVacios = { id: "", conductor: "", destino: "", autorizacion: "", estado: "", desde: "", hasta: "" };

export default function HistoricoGerenciamientos() {
  const { operador } = useAuth();
  const gerenciamientos = useColeccion("gerenciamientos");
  const [busquedaAbierta, setBusquedaAbierta] = useState(false);
  const [filtros, setFiltros] = useState(filtrosVacios);
  const puedeAutorizar = operador?.rol === "supervisor" || operador?.rol === "admin";

  const mesActual = hoy().slice(0, 7);
  const delMes = gerenciamientos.filter((g) => g.fechaSalida.startsWith(mesActual));
  const autorizados = delMes.filter((g) => g.autorizacion === "autorizado").length;
  const porcentaje = delMes.length ? Math.round((autorizados / delMes.length) * 100) : null;

  const filas = gerenciamientos.filter((g) =>
    (!filtros.id || String(g.id) === filtros.id.trim()) &&
    contiene(g.conductor, filtros.conductor) &&
    contiene(g.destino, filtros.destino) &&
    (!filtros.autorizacion || g.autorizacion === filtros.autorizacion) &&
    (!filtros.estado || g.estado === filtros.estado) &&
    (!filtros.desde || g.fechaSalida >= filtros.desde) &&
    (!filtros.hasta || g.fechaSalida <= filtros.hasta));

  const filtro = (campo: keyof typeof filtrosVacios) => ({
    value: filtros[campo],
    onChange: (e: { target: { value: string } }) => setFiltros({ ...filtros, [campo]: e.target.value }),
  });

  function autorizar(g: Gerenciamiento) {
    if (!operador) return;
    actualizar("gerenciamientos", g.id, { autorizacion: "autorizado", responsable: operador.nombre_completo });
    notificar(g.creadoPor, `Gerenciamiento #${g.id} aprobado`, `${operador.nombre_completo} ha aprobado el gerenciamiento #${g.id}`, "/gerenciamientos");
  }

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">TOTAL GERENCIAMIENTOS (MES)</span><span className="stat-value">{delMes.length}</span></div>
        <div className="stat stat-ok"><span className="stat-label">AUTORIZADOS (MES)</span><span className="stat-value">{autorizados}</span></div>
        <div className="stat stat-aviso"><span className="stat-label">PENDIENTES DE AUTORIZACIÓN (MES)</span><span className="stat-value">{delMes.length - autorizados}</span></div>
        <div className="stat stat-info">
          <span className="stat-label">PORCENTAJE DE APROBACIÓN</span>
          <span className="stat-value">{porcentaje === null ? "—" : `${porcentaje}%`}</span>
          {porcentaje !== null && <progress value={porcentaje} max={100} aria-label="Porcentaje de aprobación" />}
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-header">Listado general</h2>
        <div className="panel-body">
          <div className="busqueda">
            <button
              type="button"
              className="busqueda-toggle"
              aria-expanded={busquedaAbierta}
              aria-controls="busqueda-gerenciamientos"
              onClick={() => setBusquedaAbierta((v) => !v)}
            >
              Búsqueda avanzada
            </button>
            {busquedaAbierta && (
              <div id="busqueda-gerenciamientos" className="busqueda-campos">
                <div className="form-grid compacto">
                  <label>ID<input inputMode="numeric" {...filtro("id")} /></label>
                  <label>Salida desde<input type="date" {...filtro("desde")} /></label>
                  <label>Salida hasta<input type="date" {...filtro("hasta")} /></label>
                  <label>Conductor<input placeholder="Ingresá el nombre" {...filtro("conductor")} /></label>
                  <label>Destino<input placeholder="Ingresá el destino" {...filtro("destino")} /></label>
                  <label>Autorización
                    <select {...filtro("autorizacion")}>
                      <option value="">Todos</option><option value="autorizado">Autorizado</option><option value="pendiente">Pendiente</option>
                    </select>
                  </label>
                  <label>Estado
                    <select {...filtro("estado")}>
                      <option value="">Todos</option><option value="abierto">Abierto</option><option value="cerrado">Cerrado</option>
                    </select>
                  </label>
                </div>
                <div className="actions"><button type="button" className="secondary" onClick={() => setFiltros(filtrosVacios)}>Limpiar parámetros</button></div>
              </div>
            )}
          </div>

          {gerenciamientos.length === 0 ? (
            <p className="vacio">Todavía no hay gerenciamientos cargados. <Link to="/gerenciamientos/nuevo">Crear gerenciamiento</Link></p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>ID</th><th>Vehículo</th><th>Salida</th><th>Conductor</th><th>Línea</th><th>Destino</th>
                      <th>Responsable</th><th>Autorización</th><th>Estado</th><th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((g) => {
                      const puedeCerrar = g.estado === "abierto" && g.autorizacion === "autorizado" && (puedeAutorizar || g.creadoPor === operador?.id);
                      return (
                        <tr key={g.id}>
                          <td>{g.id}</td>
                          <td>{g.vehiculo}</td>
                          <td>{formatFecha(g.fechaSalida)} - {g.horaSalida}</td>
                          <td>{g.conductor}</td>
                          <td>{g.linea}</td>
                          <td>{g.destino}</td>
                          <td>{g.responsable || "—"}</td>
                          <td className={g.autorizacion === "autorizado" ? "texto-ok" : "texto-aviso"}>{g.autorizacion === "autorizado" ? "Autorizado" : "Pendiente"}</td>
                          <td className={g.estado === "cerrado" ? "texto-alto" : "texto-ok"}>{g.estado === "cerrado" ? "Cerrado" : "Abierto"}</td>
                          <td>
                            {puedeAutorizar && g.autorizacion === "pendiente" && <button type="button" className="secondary" onClick={() => autorizar(g)}>Autorizar</button>}
                            {puedeCerrar && <button type="button" className="secondary" onClick={() => actualizar("gerenciamientos", g.id, { estado: "cerrado" })}>Cerrar</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="resultados">Cantidad de resultados: {filas.length}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
