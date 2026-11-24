import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { BotonEliminar } from "../../components/ui/BotonEliminar";
import { contiene, formatFecha, formatFechaHora } from "../../lib/registros";
import { eliminarChecklist, useChecklists, type Checklist, type ItemChecklist } from "../../lib/operaciones";
import { PLANTILLAS, TEXTO_ESTADO, type DocChecklist, type EstadoItem } from "../../lib/checklistVehicular";

/** Estado de un documento el día del checklist (vence ese día = vigente). */
function estadoDocAlDia(d: DocChecklist, fecha: string) {
  if (d.na) return { texto: "No aplica", clase: "" };
  if (d.estado === null) return { texto: "Falta cargar", clase: d.condicionante ? "texto-alto" : "texto-aviso" };
  if (d.estado !== "aprobado") return { texto: "En revisión", clase: d.condicionante ? "texto-alto" : "texto-aviso" };
  if (!d.vencimiento) return { texto: "Vigente", clase: "texto-ok" };
  return { texto: `Vto. ${formatFecha(d.vencimiento)}`, clase: d.vencimiento < fecha ? "texto-alto" : "texto-ok" };
}

const filtrosVacios = { conductor: "", vehiculo: "", desde: "", hasta: "", resultado: "", flota: "" };

function ChipResultado({ checklist }: { checklist: Checklist }) {
  return checklist.apto
    ? <span className="chip vigente">Apto</span>
    : <span className="chip vencido">No apto</span>;
}

export default function HistoricoChecklist() {
  const { operador } = useAuth();
  const { filas: checklists, error } = useChecklists();
  const [filtros, setFiltros] = useState(filtrosVacios);

  if (!checklists) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando checklists…</p>;

  const filas = checklists.filter((c) =>
    contiene(c.conductor, filtros.conductor) &&
    contiene(c.vehiculo, filtros.vehiculo) &&
    (!filtros.desde || c.fechaCarga >= filtros.desde) &&
    (!filtros.hasta || c.fechaCarga <= filtros.hasta) &&
    (!filtros.flota || c.tipoFlota === filtros.flota) &&
    (!filtros.resultado || (c.apto ? "apto" : "fallas") === filtros.resultado));

  const filtro = (campo: keyof typeof filtrosVacios) => ({
    value: filtros[campo],
    onChange: (e: { target: { value: string } }) => setFiltros({ ...filtros, [campo]: e.target.value }),
  });

  return (
    <section className="panel">
      <h2 className="panel-header panel-header-fila">
        Listado general
        <span className="row">
          {operador?.rol === "admin" && <Link className="secondary enlace-boton" to="/checklist/documentos">Documentos del checklist</Link>}
          <Link className="secondary enlace-boton" to="/checklist/nuevo">Nuevo checklist</Link>
        </span>
      </h2>
      <div className="panel-body">
        <div className="form-grid compacto">
          <label>Conductor<input placeholder="Filtrar por nombre" {...filtro("conductor")} /></label>
          <label>Vehículo<input placeholder="Dominio" {...filtro("vehiculo")} /></label>
          <label>Flota
            <select {...filtro("flota")}>
              <option value="">Todas</option><option value="Pesada">Pesada</option><option value="Liviana">Liviana</option>
            </select>
          </label>
          <label>Fecha inicio<input type="date" {...filtro("desde")} /></label>
          <label>Fecha fin<input type="date" {...filtro("hasta")} /></label>
          <label>Resultado
            <select {...filtro("resultado")}>
              <option value="">Todos</option><option value="apto">Apto</option><option value="fallas">No apto</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>ID</th><th>Vehículo</th><th>Flota</th><th>Conductor</th><th>Fecha de carga</th><th>Resultado</th><th>Detalle</th></tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.vehiculo}</td>
                  <td>{c.tipoFlota ?? "—"}</td>
                  <td>{c.conductor}</td>
                  <td>{c.creadoEn ? formatFechaHora(c.creadoEn) : formatFecha(c.fechaCarga)}</td>
                  <td><ChipResultado checklist={c} /></td>
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

function claseEstado(item: ItemChecklist) {
  if (item.estado === "optimo" || item.estado === "bien") return "texto-ok";
  if (item.estado === "mal" || (item.condicionante && item.estado !== "na")) return "texto-alto";
  if (item.estado === "na") return "";
  return "texto-aviso";
}

const TEXTO_NEUMATICO: Record<string, string> = { bueno: "Bueno", regular: "Regular", malo: "Malo", si: "Correcto", no: "Con falla" };

/** Constancia de un checklist cargado. Se puede imprimir o guardar como PDF. */
export function DetalleChecklist() {
  const { checklistId = "" } = useParams();
  const navigate = useNavigate();
  const { operador } = useAuth();
  const { filas: checklists, error } = useChecklists();

  if (!checklists) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando checklist…</p>;
  const checklist = checklists.find((c) => String(c.id) === checklistId);
  if (!checklist) return <p className="estado">El checklist no existe o no tenés permiso para verlo. <Link to="/checklist">Volver</Link></p>;

  const plantilla = checklist.tipoFlota ? PLANTILLAS[checklist.tipoFlota] : null;
  const pv = checklist.precargaVehiculo;
  // Checklists anteriores a la unificación guardaban DNI y legajo en su propia precarga.
  const dni = checklist.conductorDatos?.dni || String(checklist.precargaConductorVieja?.dni ?? "");
  const nroLegajo = checklist.conductorDatos?.nroLegajo || String(checklist.precargaConductorVieja?.legajo ?? "");
  const documentos = checklist.documentos;
  const enc = checklist.encabezado;
  const puedeBorrar = operador?.rol === "supervisor" || operador?.rol === "admin" || checklist.creadoPor === operador?.operadorId;

  // Agrupa los controles por paso (los checklists viejos no tienen paso).
  const pasos = new Map<string, ItemChecklist[]>();
  for (const item of checklist.items) {
    const paso = item.paso ?? "Controles";
    pasos.set(paso, [...(pasos.get(paso) ?? []), item]);
  }

  return (
    <>
      <p className="parte-resumen no-print">
        <Link to="/checklist">← Checklists</Link>
        <button type="button" className="secondary" onClick={() => window.print()}>Imprimir / guardar PDF</button>
        {puedeBorrar && (
          <BotonEliminar
            tipo="el checklist"
            nombre={`#${checklist.id} · ${checklist.vehiculo} · ${formatFecha(checklist.fechaCarga)}`}
            consecuencias={["Si este checklist habilitó un gerenciamiento, primero hay que borrar el gerenciamiento."]}
            onEliminar={async () => { await eliminarChecklist(checklist.id); navigate("/checklist"); }}
          />
        )}
      </p>

      <section className="panel panel-angosto">
        <h2 className="panel-header panel-header-fila">
          {plantilla?.titulo ?? "Checklist"} #{checklist.id}
          <ChipResultado checklist={checklist} />
        </h2>
        <div className="panel-body">
          <dl className="detalle">
            <div><dt>Fecha y hora</dt><dd>{checklist.creadoEn ? formatFechaHora(checklist.creadoEn) : formatFecha(checklist.fechaCarga)}</dd></div>
            <div><dt>Lugar</dt><dd>{enc.lugar || "—"}</dd></div>
            <div><dt>Empresa / sector</dt><dd>{[pv?.empresa, pv?.sector].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>Dominio</dt><dd>{checklist.vehiculo}</dd></div>
            <div><dt>N° de interno</dt><dd>{pv?.interno || "—"}</dd></div>
            <div><dt>Marca</dt><dd>{pv?.marca || "—"}</dd></div>
            {pv?.potenciaHp && <div><dt>Potencia</dt><dd>{pv.potenciaHp} HP</dd></div>}
            <div><dt>Kilometraje</dt><dd>{checklist.km !== null ? `${checklist.km.toLocaleString("es-AR")} km` : "—"}</dd></div>
            {enc.horometro && <div><dt>Horómetro</dt><dd>{enc.horometro}</dd></div>}
            {pv?.conSemi && <div><dt>Semi</dt><dd>{pv.semiDominio}{pv.semiInterno ? ` · Int. ${pv.semiInterno}` : ""}{enc.semiMillaje ? ` · ${enc.semiMillaje}` : ""}</dd></div>}
            <div><dt>Conductor</dt><dd>{checklist.conductor}</dd></div>
            {dni && <div><dt>DNI</dt><dd>{dni}</dd></div>}
            {nroLegajo && <div><dt>N° de legajo</dt><dd>{nroLegajo}</dd></div>}
            {enc.companero && <div><dt>Compañero (paso 9)</dt><dd>{enc.companero}</dd></div>}
          </dl>
        </div>

        {checklist.fallas.length > 0 && (
          <>
            <h2 className="panel-header">Motivos de no aptitud</h2>
            <div className="panel-body">
              <ul className="lista-fallas">{checklist.fallas.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          </>
        )}

        {documentos.length > 0 && (
          <>
            <h2 className="panel-header">Documentación</h2>
            <div className="panel-body">
              <ul className="checklist-resultado">
                {documentos.map((d) => {
                  const estado = estadoDocAlDia(d, checklist.fechaCarga);
                  return (
                  <li key={d.clave}>
                    <span>
                      {d.condicionante && <span className="marca-condicionante" title="Condicionante">●</span>} {d.nombre}
                      {d.clase ? <small> · Clase {d.clase}</small> : null}
                      <small className="ayuda"> · {d.aplicaA === "vehiculo" ? "Flota" : "Legajo"}</small>
                    </span>
                    <strong className={estado.clase}>{estado.texto}</strong>
                  </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {[...pasos].map(([paso, items]) => (
          <div key={paso}>
            <h2 className="panel-header">{paso}</h2>
            <div className="panel-body">
              <ul className="checklist-resultado">
                {items.map((i) => (
                  <li key={i.id ?? i.item}>
                    <span>{i.condicionante && <span className="marca-condicionante" title="Condicionante">●</span>} {i.item}</span>
                    <strong className={claseEstado(i)}>{TEXTO_ESTADO[i.estado as EstadoItem] ?? i.estado}</strong>
                  </li>
                ))}
              </ul>
              {(() => {
                const idPaso = plantilla?.pasos.find((p) => p.titulo === paso)?.id;
                const obs = idPaso ? checklist.observacionesPasos[idPaso] : "";
                return obs ? <p><strong>Observaciones del paso:</strong> {obs}</p> : null;
              })()}
            </div>
          </div>
        ))}

        {checklist.neumaticos.length > 0 && (
          <>
            <h2 className="panel-header">Paso 6 · Neumáticos</h2>
            <div className="panel-body table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Ubicación</th><th>Presión (PSI)</th><th>Estado</th><th>Características</th><th>Dimensiones</th><th>Control de tuercas / soporte</th></tr></thead>
                <tbody>
                  {checklist.neumaticos.map((n) => (
                    <tr key={n.eje}>
                      <td>{n.eje}</td>
                      <td>{n.presion}</td>
                      <td className={n.estado === "malo" ? "texto-alto" : undefined}>{TEXTO_NEUMATICO[n.estado] ?? n.estado}</td>
                      <td>{n.caracteristica}</td>
                      <td>{n.dimension || "—"}</td>
                      <td>
                        {n.soporte ? `Soporte: ${TEXTO_NEUMATICO[n.soporte]}`
                          : `Ajuste: ${TEXTO_NEUMATICO[n.tuercas ?? ""] ?? "—"} · Check point: ${TEXTO_NEUMATICO[n.checkpoint ?? ""] ?? "—"}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h2 className="panel-header">Observaciones</h2>
        <div className="panel-body">
          <p>{checklist.observaciones || "Sin observaciones."}</p>
          <p className="checklist-subtitulo">Responsable de la verificación</p>
          <div className="informe-firma checklist-firma">
            <div><p>&nbsp;</p><span>Firma</span></div>
            <div><p>{checklist.conductor}</p><span>Aclaración</span></div>
            <div><p>{dni}</p><span>DNI</span></div>
          </div>
          <p className="ayuda">
            Los ítems condicionantes (●) tienen que estar en estado óptimo para la circulación del vehículo.
            Este checklist se firma en carácter de declaración jurada.
          </p>
        </div>
      </section>
    </>
  );
}
