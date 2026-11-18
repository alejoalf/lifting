import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { contiene, formatFecha, formatFechaHora } from "../../lib/registros";
import { useChecklists, type Checklist, type EstadoItem } from "../../lib/operaciones";

const filtrosVacios = { conductor: "", vehiculo: "", desde: "", hasta: "", resultado: "" };

function ChipResultado({ checklist }: { checklist: Checklist }) {
  return checklist.apto
    ? <span className="chip vigente">Apto</span>
    : <span className="chip vencido">Con fallas</span>;
}

export default function HistoricoChecklist() {
  const { filas: checklists, error } = useChecklists();
  const [filtros, setFiltros] = useState(filtrosVacios);

  if (!checklists) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando checklists…</p>;

  const filas = checklists.filter((c) =>
    contiene(c.conductor, filtros.conductor) &&
    contiene(c.vehiculo, filtros.vehiculo) &&
    (!filtros.desde || c.fechaCarga >= filtros.desde) &&
    (!filtros.hasta || c.fechaCarga <= filtros.hasta) &&
    (!filtros.resultado || (c.apto ? "apto" : "fallas") === filtros.resultado));

  const filtro = (campo: keyof typeof filtrosVacios) => ({
    value: filtros[campo],
    onChange: (e: { target: { value: string } }) => setFiltros({ ...filtros, [campo]: e.target.value }),
  });

  return (
    <section className="panel">
      <h2 className="panel-header panel-header-fila">
        Listado general
        <Link className="secondary enlace-boton" to="/checklist/nuevo">Nuevo checklist</Link>
      </h2>
      <div className="panel-body">
        <div className="form-grid compacto">
          <label>Conductor<input placeholder="Filtrar por nombre" {...filtro("conductor")} /></label>
          <label>Vehículo<input placeholder="Dominio o N° interno" {...filtro("vehiculo")} /></label>
          <label>Fecha inicio<input type="date" {...filtro("desde")} /></label>
          <label>Fecha fin<input type="date" {...filtro("hasta")} /></label>
          <label>Resultado
            <select {...filtro("resultado")}>
              <option value="">Todos</option><option value="apto">Apto</option><option value="fallas">Con fallas</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>ID</th><th>Vehículo</th><th>Conductor</th><th>Fecha de carga</th><th>Resultado</th><th>Usuario</th><th>Detalle</th></tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.vehiculo}</td>
                  <td>{c.conductor}</td>
                  <td>{formatFecha(c.fechaCarga)}</td>
                  <td><ChipResultado checklist={c} /></td>
                  <td>{c.usuario}</td>
                  <td><Link className="secondary enlace-boton" to={`/checklist/${c.id}`}>Ver</Link></td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={7} className="vacio">
                    {checklists.length === 0
                      ? <>Todavía no hay checklists cargados. <Link to="/checklist/nuevo">Cargar el primero</Link></>
                      : "Ningún checklist coincide con los filtros."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="resultados">Cantidad de resultados: {filas.length}</p>
      </div>
    </section>
  );
}

const TEXTO_ESTADO: Record<EstadoItem, string> = { bien: "Bien", mal: "Mal", na: "No aplica" };
const CLASE_ESTADO: Record<EstadoItem, string> = { bien: "texto-ok", mal: "texto-alto", na: "" };

/** Constancia de un checklist cargado. Se puede imprimir o guardar como PDF. */
export function DetalleChecklist() {
  const { checklistId = "" } = useParams();
  const { filas: checklists, error } = useChecklists();

  if (!checklists) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando checklist…</p>;
  const checklist = checklists.find((c) => String(c.id) === checklistId);
  if (!checklist) return <p className="estado">El checklist no existe o no tenés permiso para verlo. <Link to="/checklist">Volver</Link></p>;

  return (
    <>
      <p className="parte-resumen no-print">
        <Link to="/checklist">← Checklists</Link>
        <button type="button" className="secondary" onClick={() => window.print()}>Imprimir / guardar PDF</button>
      </p>

      <section className="panel panel-angosto">
        <h2 className="panel-header panel-header-fila">
          Checklist #{checklist.id}
          <ChipResultado checklist={checklist} />
        </h2>
        <div className="panel-body">
          <dl className="detalle">
            <div><dt>Vehículo</dt><dd>{checklist.vehiculo}</dd></div>
            <div><dt>Conductor</dt><dd>{checklist.conductor}</dd></div>
            <div><dt>Kilometraje</dt><dd>{checklist.km !== null ? `${checklist.km.toLocaleString("es-AR")} km` : "—"}</dd></div>
            <div><dt>Cargado por</dt><dd>{checklist.usuario}</dd></div>
            <div><dt>Fecha y hora</dt><dd>{checklist.creadoEn ? formatFechaHora(checklist.creadoEn) : formatFecha(checklist.fechaCarga)}</dd></div>
          </dl>
        </div>

        <h2 className="panel-header">Controles</h2>
        <div className="panel-body">
          <ul className="checklist-resultado">
            {checklist.items.map((i) => (
              <li key={i.item}>
                <span>{i.item}</span>
                <strong className={CLASE_ESTADO[i.estado] ?? ""}>{TEXTO_ESTADO[i.estado] ?? i.estado}</strong>
              </li>
            ))}
          </ul>
          {checklist.observaciones && (
            <>
              <h3 className="checklist-subtitulo">Observaciones</h3>
              <p>{checklist.observaciones}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
