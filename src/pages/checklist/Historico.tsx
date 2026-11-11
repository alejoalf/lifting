import { useState } from "react";
import { contiene, formatFecha, useColeccion } from "../../lib/registros";

const filtrosVacios = { conductor: "", vehiculo: "", desde: "", hasta: "" };

export default function HistoricoChecklist() {
  const checklists = useColeccion("checklists");
  const [filtros, setFiltros] = useState(filtrosVacios);

  const filas = checklists.filter((c) =>
    contiene(c.conductor, filtros.conductor) &&
    contiene(c.vehiculo, filtros.vehiculo) &&
    (!filtros.desde || c.fechaCarga >= filtros.desde) &&
    (!filtros.hasta || c.fechaCarga <= filtros.hasta));

  const filtro = (campo: keyof typeof filtrosVacios) => ({
    value: filtros[campo],
    onChange: (e: { target: { value: string } }) => setFiltros({ ...filtros, [campo]: e.target.value }),
  });

  return (
    <section className="panel">
      <h2 className="panel-header">Listado general</h2>
      <div className="panel-body">
        <div className="form-grid compacto">
          <label>Conductor<input placeholder="Filtrar por nombre" {...filtro("conductor")} /></label>
          <label>N° interno<input placeholder="Filtrar por N° interno" {...filtro("vehiculo")} /></label>
          <label>Fecha inicio<input type="date" {...filtro("desde")} /></label>
          <label>Fecha fin<input type="date" {...filtro("hasta")} /></label>
        </div>

        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>ID</th><th>Vehículo</th><th>Conductor</th><th>Fecha de carga</th><th>Usuario</th></tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td><td>{c.vehiculo}</td><td>{c.conductor}</td><td>{formatFecha(c.fechaCarga)}</td><td>{c.usuario}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={5} className="vacio">{checklists.length === 0 ? "Todavía no hay checklists cargados." : "Ningún checklist coincide con los filtros."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
