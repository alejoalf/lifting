import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { EstadoParteChip } from "../../components/partes/TablaPartes";
import { PARA_SUPERVISORES, actualizar, formatFecha, formatFechaHora, notificar, useColeccion } from "../../lib/registros";

export default function DetalleParte() {
  const { id } = useParams();
  const { operador } = useAuth();
  const parte = useColeccion("partes").find((p) => p.id === Number(id));
  const [rechazando, setRechazando] = useState(false);
  const [error, setError] = useState("");

  const esSupervisor = operador?.rol === "supervisor" || operador?.rol === "admin";
  const volver = esSupervisor ? "/supervisor" : "/chofer";

  if (!parte || !operador) {
    return <p className="vacio">No se encontró el parte. <Link to={volver}>Volver</Link></p>;
  }
  const esPropio = parte.creadoPor === operador.id;
  if (!esPropio && !esSupervisor) {
    return <p className="vacio">No tenés permiso para ver este parte. <Link to={volver}>Volver</Link></p>;
  }

  const enlace = `/partes/${parte.id}`;
  const ahora = () => new Date().toISOString();

  function autorizar() {
    actualizar("partes", parte!.id, { estado: "autorizado", resueltoPor: operador!.nombre_completo, resueltoEn: ahora() });
    notificar(parte!.creadoPor, `Parte N° ${parte!.id} autorizado`, `${operador!.nombre_completo} autorizó la salida de ${parte!.vehiculo}.`, enlace);
  }

  function rechazar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const motivo = String(new FormData(event.currentTarget).get("motivo") ?? "").trim();
    if (!motivo) return;
    actualizar("partes", parte!.id, { estado: "rechazado", resueltoPor: operador!.nombre_completo, resueltoEn: ahora(), motivoRechazo: motivo });
    notificar(parte!.creadoPor, `Parte N° ${parte!.id} rechazado`, `${operador!.nombre_completo} no autorizó la salida: ${motivo}`, enlace);
    setRechazando(false);
  }

  function registrarSalida() {
    actualizar("partes", parte!.id, { estado: "en_curso", salidaEn: ahora() });
    notificar(PARA_SUPERVISORES, `Operación en curso: parte N° ${parte!.id}`, `${parte!.operador} salió con ${parte!.vehiculo} hacia ${parte!.locacion}.`, enlace);
  }

  function cerrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const kmFinal = Number(datos.get("kmFinal"));
    if (kmFinal < parte!.kmInicial) {
      setError(`El kilometraje final no puede ser menor al inicial (${parte!.kmInicial}).`);
      return;
    }
    actualizar("partes", parte!.id, {
      estado: "cerrado",
      cerradoEn: ahora(),
      kmFinal,
      trabajoRealizado: String(datos.get("trabajoRealizado") ?? "").trim(),
    });
    notificar(PARA_SUPERVISORES, `Servicio cerrado: parte N° ${parte!.id}`, `${parte!.operador} cerró el servicio para ${parte!.cliente}. Listo para facturar.`, enlace);
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-header panel-header-fila">Parte N° {parte.id}<EstadoParteChip estado={parte.estado} /></h2>
        <div className="panel-body">
          <dl className="detalle">
            <div><dt>Fecha</dt><dd>{formatFecha(parte.fecha)}</dd></div>
            <div><dt>Operador</dt><dd>{parte.operador}</dd></div>
            <div><dt>Vehículo</dt><dd>{parte.vehiculo}</dd></div>
            <div><dt>Tarea</dt><dd>{parte.tarea}</dd></div>
            <div><dt>Cliente</dt><dd>{parte.cliente}</dd></div>
            <div><dt>Ruta / locación</dt><dd>{parte.locacion}</dd></div>
            <div><dt>Kilometraje inicial</dt><dd>{parte.kmInicial} km</dd></div>
            {parte.kmFinal !== null && (
              <>
                <div><dt>Kilometraje final</dt><dd>{parte.kmFinal} km</dd></div>
                <div><dt>Kilómetros recorridos</dt><dd>{parte.kmFinal - parte.kmInicial} km</dd></div>
              </>
            )}
            {parte.observaciones && <div className="detalle-ancho"><dt>Observaciones</dt><dd>{parte.observaciones}</dd></div>}
            {parte.trabajoRealizado && <div className="detalle-ancho"><dt>Trabajo realizado</dt><dd>{parte.trabajoRealizado}</dd></div>}
          </dl>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Seguimiento</h2>
        <div className="panel-body">
          <ol className="historial">
            <li><strong>Pedido de autorización</strong> · {parte.operador} · {formatFechaHora(parte.creadoEn)}</li>
            {parte.resueltoEn && (
              <li>
                <strong>{parte.estado === "rechazado" ? "Rechazado" : "Autorizado"}</strong> · {parte.resueltoPor} · {formatFechaHora(parte.resueltoEn)}
                {parte.motivoRechazo && <><br />Motivo: {parte.motivoRechazo}</>}
              </li>
            )}
            {parte.salidaEn && <li><strong>Salida registrada</strong> · {formatFechaHora(parte.salidaEn)}</li>}
            {parte.cerradoEn && <li><strong>Servicio cerrado</strong> · {formatFechaHora(parte.cerradoEn)}</li>}
          </ol>

          {parte.estado === "pendiente" && !esSupervisor && <p className="ayuda">Esperando la autorización de Base.</p>}

          {parte.estado === "pendiente" && esSupervisor && !rechazando && (
            <div className="actions">
              <button type="button" className="secondary peligro" onClick={() => setRechazando(true)}>Rechazar</button>
              <button type="button" className="primary inline" onClick={autorizar}>Autorizar salida</button>
            </div>
          )}

          {parte.estado === "pendiente" && esSupervisor && rechazando && (
            <form onSubmit={rechazar}>
              <label>Motivo del rechazo<textarea name="motivo" rows={3} required autoFocus /></label>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => setRechazando(false)}>Cancelar</button>
                <button type="submit" className="secondary peligro">Confirmar rechazo</button>
              </div>
            </form>
          )}

          {parte.estado === "autorizado" && esPropio && (
            <div className="actions"><button type="button" className="primary inline" onClick={registrarSalida}>Registrar salida</button></div>
          )}

          {parte.estado === "en_curso" && esPropio && (
            <form onSubmit={cerrar}>
              <h3>Cerrar servicio</h3>
              <div className="form-grid">
                <label>Kilometraje final<input type="number" name="kmFinal" min={parte.kmInicial} step="1" required /></label>
              </div>
              <label>Trabajo realizado<textarea name="trabajoRealizado" rows={3} required /></label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions"><button type="submit" className="primary inline">Cerrar servicio</button></div>
            </form>
          )}
        </div>
      </section>

      <p><Link to={volver}>← Volver a partes</Link></p>
    </>
  );
}
