import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BotonVerArchivo, ChipHabilitado, LegajoOperador } from "../../components/legajo/LegajoOperador";
import { contiene, formatFecha } from "../../lib/registros";
import {
  ESTADOS_REQUISITO, habilitacionesDe, nombreActividad, revisarDocumento, useLegajos, useOperadoresLegajo,
  type DocumentoLegajo,
} from "../../lib/legajos";

/** Legajo de un operador, visto por Supervisor o Admin. */
export function LegajoDetalle() {
  const { operadorId = "" } = useParams();
  const { operadores, error } = useOperadoresLegajo();
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!operadores) return <p className="estado">Cargando…</p>;
  const operador = operadores.find((o) => o.id === operadorId);
  if (!operador) return <p className="estado">El operador no existe. <Link to="/admin/legajos">Volver a legajos</Link></p>;

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin/legajos">← Legajos del personal</Link>
        <strong>{operador.nombre}</strong><span className="ayuda">{operador.rol}</span>
      </p>
      <LegajoOperador operadorId={operador.id} gestor />
    </>
  );
}

export default function Legajos() {
  const { datos, error, refresh } = useLegajos();
  const { operadores, error: errorOperadores } = useOperadoresLegajo();
  const [busqueda, setBusqueda] = useState("");
  const [revisando, setRevisando] = useState("");
  const [errorRevision, setErrorRevision] = useState("");

  if (error || errorOperadores) return <p className="error" role="alert">{error || errorOperadores}</p>;
  if (!datos || !operadores) return <p className="estado">Cargando legajos…</p>;

  const nombre = (id: string) => operadores.find((o) => o.id === id)?.nombre ?? "—";
  const tipo = (id: string) => datos.tipos.find((t) => t.id === id)?.nombre ?? "—";
  const pendientes = datos.documentos.filter((d) => d.estado === "pendiente");
  const actividades = datos.actividades.filter((a) => a.activa);
  const visibles = operadores.filter((o) => o.activo && contiene(`${o.nombre} ${o.rol}`, busqueda));

  async function revisar(documento: DocumentoLegajo, aprobar: boolean) {
    const motivo = aprobar ? "" : window.prompt("Motivo del rechazo (lo ve el operador):")?.trim();
    if (!aprobar && !motivo) return;
    setErrorRevision("");
    setRevisando(documento.id);
    try {
      await revisarDocumento(documento.id, aprobar, motivo);
      await refresh();
    } catch (fallo) {
      setErrorRevision(fallo instanceof Error ? fallo.message : "No se pudo guardar la revisión.");
    } finally {
      setRevisando("");
    }
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Documentos pendientes de revisión</h2>
        <div className="panel-body">
          {errorRevision && <p className="error" role="alert">{errorRevision}</p>}
          {pendientes.length === 0 ? <p className="vacio">No hay documentos para revisar.</p> : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Operador</th><th>Documento</th><th>Vencimiento</th><th>Lectura automática</th><th>Archivo</th><th>Acciones</th></tr></thead>
                <tbody>
                  {pendientes.map((d) => {
                    const ia = d.lectura_ia;
                    const difiere = ia?.fecha_vencimiento && d.vencimiento && ia.fecha_vencimiento !== d.vencimiento;
                    return (
                      <tr key={d.id}>
                        <td><Link to={`/admin/legajos/${d.operador_id}`}>{nombre(d.operador_id)}</Link></td>
                        <td>{tipo(d.tipo_documento_id)}</td>
                        <td>{d.vencimiento ? formatFecha(d.vencimiento) : "No vence"}</td>
                        <td>
                          {!ia?.legible ? "Sin lectura" : (
                            <>
                              {ia.tipo ?? "Tipo no reconocido"}{ia.titular && ` · ${ia.titular}`}
                              {ia.fecha_vencimiento && ` · vence ${formatFecha(ia.fecha_vencimiento)}`}
                              {difiere && <><br /><small className="texto-alto">La fecha cargada no coincide con la leída.</small></>}
                            </>
                          )}
                        </td>
                        <td><BotonVerArchivo path={d.archivo_path} /></td>
                        <td>
                          <div className="row">
                            <button type="button" className="secondary" disabled={revisando !== ""} onClick={() => void revisar(d, true)}>
                              {revisando === d.id ? "Guardando…" : "Aprobar"}
                            </button>
                            <button type="button" className="secondary peligro" disabled={revisando !== ""} onClick={() => void revisar(d, false)}>
                              Rechazar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Habilitaciones del personal</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Nombre o rol" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          </div>
          {actividades.length === 0 && <p className="ayuda">Todavía no hay actividades definidas. Un administrador puede crearlas en «Requisitos por actividad».</p>}
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead>
                <tr><th>Operador</th><th>Rol</th>{actividades.map((a) => <th key={a.id}>{nombreActividad(a)}</th>)}</tr>
              </thead>
              <tbody>
                {visibles.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/admin/legajos/${o.id}`}>{o.nombre}</Link></td>
                    <td>{o.rol}</td>
                    {habilitacionesDe(datos, o.id).map(({ actividad, habilitado, requisitos }) => {
                      const faltantes = requisitos.filter((r) => r.estado !== "vigente" && r.estado !== "por-vencer");
                      const porVencer = requisitos.filter((r) => r.estado === "por-vencer");
                      return (
                        <td key={actividad.id}>
                          <ChipHabilitado habilitado={habilitado} />
                          {[...faltantes, ...porVencer].map((r) => (
                            <small key={r.tipo.id} className={r.estado === "por-vencer" ? "texto-aviso" : "ayuda"}>
                              <br />{r.tipo.nombre}: {ESTADOS_REQUISITO[r.estado].toLocaleLowerCase("es")}
                            </small>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visibles.length === 0 && <tr><td colSpan={2 + actividades.length} className="vacio">Ningún operador coincide con la búsqueda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
