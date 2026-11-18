import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { contiene, formatFecha } from "../../lib/registros";
import { TIPOS_OBSERVACION, cerrarObservacion, useObservaciones } from "../../lib/operaciones";

const filtrosVacios = {
  id: "", desde: "", hasta: "", tipo: "", riesgo: "", seguimiento: "", estado: "",
  reportadoPor: "", distrito: "", cliente: "", lugar: "",
};

const claseRiesgo = { Bajo: "texto-ok", Medio: "texto-aviso", Alto: "texto-alto" };

export default function HistoricoObservaciones() {
  const { operador } = useAuth();
  const { filas: cargadas, error: errorCarga, refresh } = useObservaciones();
  const [filtros, setFiltros] = useState(filtrosVacios);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState("");
  const puedeCerrar = operador?.rol === "supervisor" || operador?.rol === "admin";

  if (!cargadas) return errorCarga ? <p className="error" role="alert">{errorCarga}</p> : <p className="estado">Cargando tarjetas…</p>;
  const observaciones = cargadas;

  async function cerrar(id: number) {
    setError("");
    setOcupado(id);
    try {
      await cerrarObservacion(id);
      await refresh();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo cerrar la tarjeta.");
    } finally {
      setOcupado(null);
    }
  }

  const filas = observaciones.filter((o) =>
    (!filtros.id || String(o.id) === filtros.id.trim()) &&
    (!filtros.desde || o.fechaCarga >= filtros.desde) &&
    (!filtros.hasta || o.fechaCarga <= filtros.hasta) &&
    (!filtros.tipo || o.tipos.includes(filtros.tipo)) &&
    (!filtros.riesgo || o.riesgo === filtros.riesgo) &&
    (!filtros.seguimiento || (o.seguimiento ? "si" : "no") === filtros.seguimiento) &&
    (!filtros.estado || o.estado === filtros.estado) &&
    contiene(o.reportadoPor, filtros.reportadoPor) &&
    contiene(o.distrito, filtros.distrito) &&
    contiene(o.cliente, filtros.cliente) &&
    contiene(o.lugar, filtros.lugar));

  const filtro = (campo: keyof typeof filtrosVacios) => ({
    value: filtros[campo],
    onChange: (e: { target: { value: string } }) => setFiltros({ ...filtros, [campo]: e.target.value }),
  });

  return (
    <section className="panel">
      <h2 className="panel-header">Listado general</h2>
      <div className="panel-body">
        <div className="busqueda busqueda-campos">
          <div className="busqueda-titulo">
            <div>
              <h3>Búsqueda avanzada</h3>
              <p className="ayuda">Usá los parámetros para filtrar las tarjetas. Desde y Hasta filtran sobre la fecha de carga, no la de detección.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setFiltros(filtrosVacios)}>Limpiar parámetros</button>
          </div>
          <div className="form-grid compacto">
            <label>ID<input inputMode="numeric" {...filtro("id")} /></label>
            <label>Desde<input type="date" {...filtro("desde")} /></label>
            <label>Hasta<input type="date" {...filtro("hasta")} /></label>
            <label>Tipo de observación
              <select {...filtro("tipo")}>
                <option value="">Todos</option>
                {TIPOS_OBSERVACION.map((tipo) => <option key={tipo}>{tipo}</option>)}
              </select>
            </label>
            <label>Riesgo
              <select {...filtro("riesgo")}><option value="">Todos</option><option>Bajo</option><option>Medio</option><option>Alto</option></select>
            </label>
            <label>Necesita seguimiento
              <select {...filtro("seguimiento")}><option value="">Todos</option><option value="si">Sí</option><option value="no">No</option></select>
            </label>
            <label>Estado
              <select {...filtro("estado")}><option value="">Todos</option><option value="abierta">Abierta</option><option value="cerrada">Cerrada</option></select>
            </label>
            <label>Reportado por<input placeholder="Ingresá el nombre" {...filtro("reportadoPor")} /></label>
            <label>Distrito<input {...filtro("distrito")} /></label>
            <label>Cliente<input {...filtro("cliente")} /></label>
            <label>Lugar específico<input placeholder="Ingresá un lugar específico" {...filtro("lugar")} /></label>
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {observaciones.length === 0 ? (
          <p className="vacio">Todavía no hay tarjetas de observación cargadas. <Link to="/observaciones/nueva">Nueva tarjeta</Link></p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>ID</th><th>Reportado por</th><th>Tipo</th><th>Fecha detección</th><th>Distrito</th><th>Línea / sector</th>
                    <th>Cliente</th><th>Lugar específico</th><th>Riesgo</th><th>Necesita seguimiento</th><th>Estado</th>
                    {puedeCerrar && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((o) => (
                    <tr key={o.id}>
                      <td>{o.id}</td>
                      <td><strong>{o.reportadoPor}</strong></td>
                      <td>{o.tipos.join(", ")}</td>
                      <td>{formatFecha(o.fechaDeteccion)}</td>
                      <td>{o.distrito}</td>
                      <td>{o.sector}</td>
                      <td>{o.cliente || "—"}</td>
                      <td>{o.lugar}</td>
                      <td className={claseRiesgo[o.riesgo]}>{o.riesgo}</td>
                      <td className={o.seguimiento ? "texto-aviso" : "texto-alto"}>{o.seguimiento ? "Sí" : "No"}</td>
                      <td className={o.estado === "cerrada" ? "texto-ok" : "texto-aviso"}>{o.estado === "cerrada" ? "Cerrada" : "Abierta"}</td>
                      {puedeCerrar && (
                        <td>
                          {o.estado === "abierta"
                            ? <button type="button" className="secondary" disabled={ocupado === o.id} onClick={() => void cerrar(o.id)}>Cerrar</button>
                            : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="resultados">Cantidad de resultados: {filas.length}</p>
          </>
        )}
      </div>
    </section>
  );
}
