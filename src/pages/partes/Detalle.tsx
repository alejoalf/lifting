import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { EstadoParteChip } from "../../components/partes/TablaPartes";
import { StatusChip } from "../../components/ui/StatusChip";
import { PARA_SUPERVISORES, actualizar, formatFecha, formatFechaHora, notificar, useColeccion } from "../../lib/registros";

export default function DetalleParte() {
  const { id } = useParams();
  const { operador } = useAuth();
  const parte = useColeccion("partesDiarios").find((p) => p.id === Number(id));
  const [frenando, setFrenando] = useState(false);
  const [error, setError] = useState("");

  const esAdmin = operador?.rol === "admin";
  const esSupervisor = esAdmin || operador?.rol === "supervisor";
  const volver = esSupervisor ? "/supervisor" : "/chofer";

  if (!parte || !operador) {
    return <p className="vacio">No se encontró el parte. <Link to={volver}>Volver</Link></p>;
  }
  const esPropio = parte.creadoPor === operador.id;
  if (!esPropio && !esSupervisor) {
    return <p className="vacio">No tenés permiso para ver este parte. <Link to={volver}>Volver</Link></p>;
  }

  const p = parte;
  const yo = operador.nombre_completo;
  const enlace = `/partes/${p.id}`;
  const ahora = () => new Date().toISOString();

  function autorizar() {
    actualizar("partesDiarios", p.id, { estado: "en_curso", resueltoPor: yo, resueltoEn: ahora(), salidaEn: ahora() });
    notificar(p.creadoPor, `Parte N° ${p.id}: salida excepcional autorizada`, `${yo} autorizó la salida de ${p.vehiculo}.`, enlace);
    notificar(PARA_SUPERVISORES, `Operación en curso: parte N° ${p.id}`, `${p.operador} salió con ${p.vehiculo} hacia ${p.destino} (salida excepcional).`, enlace);
  }

  function frenar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const motivo = String(new FormData(event.currentTarget).get("motivo") ?? "").trim();
    actualizar("partesDiarios", p.id, { estado: "frenado", resueltoPor: yo, resueltoEn: ahora(), motivoFreno: motivo });
    notificar(p.creadoPor, `Parte N° ${p.id}: unidad frenada`, `${yo} no autorizó la salida de ${p.vehiculo}.${motivo ? ` Motivo: ${motivo}` : ""}`, enlace);
    setFrenando(false);
  }

  function cerrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const kmFinal = Number(datos.get("kmFinal"));
    const horas = String(datos.get("horasDeclaradas") ?? "").trim();
    if (kmFinal < p.kmInicial) {
      setError(`El kilometraje final no puede ser menor al inicial (${p.kmInicial}).`);
      return;
    }
    actualizar("partesDiarios", p.id, {
      estado: "cerrado",
      cerradoEn: ahora(),
      kmFinal,
      horasDeclaradas: horas ? Number(horas) : null,
      trabajoRealizado: String(datos.get("trabajoRealizado") ?? "").trim(),
    });
    notificar(PARA_SUPERVISORES, `Servicio cerrado: parte N° ${p.id}`, `${p.operador} cerró el servicio para ${p.cliente}. Falta la firma del supervisor.`, enlace);
  }

  function firmar() {
    actualizar("partesDiarios", p.id, { firmadoPor: yo, firmadoEn: ahora() });
    notificar(p.creadoPor, `Parte N° ${p.id} firmado`, `${yo} firmó el parte. Queda listo para facturar.`, enlace);
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-header panel-header-fila">Parte N° {p.id}<EstadoParteChip estado={p.estado} /></h2>
        <div className="panel-body">
          <dl className="detalle">
            <div><dt>Fecha</dt><dd>{formatFecha(p.fecha)}</dd></div>
            <div><dt>Operador</dt><dd>{p.operador}</dd></div>
            <div><dt>Cliente</dt><dd>{p.cliente}</dd></div>
            <div><dt>Contrato</dt><dd>{p.contrato || "—"}</dd></div>
            <div><dt>Vehículo</dt><dd>{p.vehiculo}</dd></div>
            <div><dt>Tarea</dt><dd>{p.tarea}</dd></div>
            <div><dt>Origen</dt><dd>{p.origen}</dd></div>
            <div><dt>Destino</dt><dd>{p.destino}</dd></div>
            <div><dt>Semáforo de salida</dt><dd><StatusChip estado={p.semaforo} /></dd></div>
            <div><dt>Kilometraje inicial</dt><dd>{p.kmInicial} km</dd></div>
            {p.kmFinal !== null && (
              <>
                <div><dt>Kilometraje final</dt><dd>{p.kmFinal} km</dd></div>
                <div><dt>Kilómetros declarados</dt><dd>{p.kmFinal - p.kmInicial} km</dd></div>
              </>
            )}
            {p.horasDeclaradas !== null && <div><dt>Horas declaradas</dt><dd>{p.horasDeclaradas} h</dd></div>}
            <div><dt>Firma del supervisor</dt><dd>{p.firmadoPor ? `${p.firmadoPor} · ${formatFechaHora(p.firmadoEn)}` : "Sin firmar"}</dd></div>
            {p.documentosVencidos.length > 0 && (
              <div className="detalle-ancho"><dt>Documentación vencida al abrir el parte</dt><dd>{p.documentosVencidos.join("; ")}</dd></div>
            )}
            {p.observaciones && <div className="detalle-ancho"><dt>Observaciones</dt><dd>{p.observaciones}</dd></div>}
            {p.trabajoRealizado && <div className="detalle-ancho"><dt>Trabajo realizado</dt><dd>{p.trabajoRealizado}</dd></div>}
          </dl>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Seguimiento</h2>
        <div className="panel-body">
          <ol className="historial">
            <li><strong>Parte abierto</strong> · {p.operador} · {formatFechaHora(p.creadoEn)}</li>
            {p.documentosVencidos.length > 0 && <li><strong>Autorización a Base solicitada</strong> por documentación vencida</li>}
            {p.resueltoEn && (
              <li>
                <strong>{p.estado === "frenado" ? "Unidad frenada" : "Salida excepcional autorizada"}</strong> · {p.resueltoPor} · {formatFechaHora(p.resueltoEn)}
                {p.motivoFreno && <><br />Motivo: {p.motivoFreno}</>}
              </li>
            )}
            {p.salidaEn && <li><strong>Operación en curso</strong> · {formatFechaHora(p.salidaEn)}</li>}
            {p.cerradoEn && <li><strong>Servicio cerrado</strong> · {formatFechaHora(p.cerradoEn)}</li>}
            {p.firmadoEn && <li><strong>Firmado por el supervisor</strong> · {p.firmadoPor} · {formatFechaHora(p.firmadoEn)}</li>}
          </ol>

          {p.estado === "excepcion" && !esAdmin && <p className="ayuda">Esperando la respuesta de Base. La unidad no puede salir.</p>}

          {p.estado === "excepcion" && esAdmin && !frenando && (
            <div className="actions">
              <button type="button" className="secondary peligro" onClick={() => setFrenando(true)}>No, frenar unidad</button>
              <button type="button" className="primary inline" onClick={autorizar}>Sí, autorizar salida excepcional</button>
            </div>
          )}

          {p.estado === "excepcion" && esAdmin && frenando && (
            <form onSubmit={frenar}>
              <label>Motivo <small>(opcional)</small><textarea name="motivo" rows={3} autoFocus /></label>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => setFrenando(false)}>Cancelar</button>
                <button type="submit" className="secondary peligro">Confirmar: frenar unidad</button>
              </div>
            </form>
          )}

          {p.estado === "en_curso" && esPropio && (
            <form onSubmit={cerrar}>
              <h3>Cerrar servicio</h3>
              <div className="form-grid">
                <label>Kilometraje final<input type="number" name="kmFinal" min={p.kmInicial} step="1" required /></label>
                <label>Horas de hidrogrúa / barquilla <small>(si corresponde)</small><input type="number" name="horasDeclaradas" min="0" step="0.5" /></label>
              </div>
              <label>Trabajo realizado<textarea name="trabajoRealizado" rows={3} required /></label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions"><button type="submit" className="primary inline">Cerrar servicio</button></div>
            </form>
          )}

          {p.estado === "cerrado" && !p.firmadoEn && esSupervisor && (
            <div className="actions"><button type="button" className="primary inline" onClick={firmar}>Firmar parte</button></div>
          )}
        </div>
      </section>

      {p.estado === "cerrado" && (
        <section className="panel">
          <h2 className="panel-header">Emitir informe</h2>
          <div className="panel-body">
            {!p.firmadoEn && <p className="ayuda">El parte todavía no tiene la firma del supervisor; el informe va a salir sin firma.</p>}
            <div className="actions actions-inicio">
              <Link className="secondary enlace-boton" to={`/partes/${p.id}/informe/1`}>Perfil 1 · Parte comercial</Link>
              <Link className="secondary enlace-boton" to={`/partes/${p.id}/informe/2`}>Perfil 2 · Dossier operativo + HSE</Link>
              {esAdmin && <Link className="secondary enlace-boton" to={`/partes/${p.id}/informe/3`}>Perfil 3 · Auditoría interna</Link>}
            </div>
          </div>
        </section>
      )}

      <p><Link to={volver}>← Volver a partes</Link></p>
    </>
  );
}
