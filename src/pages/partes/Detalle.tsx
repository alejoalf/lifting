import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { EstadoParteChip } from "../../components/partes/TablaPartes";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import { usePartes } from "../../lib/usePartes";

export default function DetalleParte() {
  const { id } = useParams();
  const { operador } = useAuth();
  const { partes, loading, error } = usePartes();
  const parte = partes.find((item) => item.id === id);
  const esSupervisor = operador?.rol === "admin" || operador?.rol === "supervisor";
  const volver = esSupervisor ? "/supervisor" : "/chofer";

  if (loading) return <p className="estado">Cargando parte…</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!parte || !operador) {
    return <p className="vacio">No se encontró el parte. <Link to={volver}>Volver</Link></p>;
  }
  if (parte.creadoPor !== operador.id && !esSupervisor) {
    return <p className="vacio">No tenés permiso para ver este parte. <Link to={volver}>Volver</Link></p>;
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-header panel-header-fila">
          Parte N° {parte.numero}
          <EstadoParteChip estado={parte.estado} />
        </h2>
        <div className="panel-body">
          <dl className="detalle">
            <div><dt>Fecha</dt><dd>{formatFecha(parte.fecha)}</dd></div>
            <div><dt>Operador</dt><dd>{parte.operador}</dd></div>
            <div><dt>Cliente</dt><dd>{parte.cliente}</dd></div>
            <div><dt>Contrato</dt><dd>{parte.contrato || "—"}</dd></div>
            <div><dt>Vehículo</dt><dd>{parte.vehiculo}</dd></div>
            <div><dt>Tarea</dt><dd>{parte.tarea}</dd></div>
            <div><dt>Origen</dt><dd>{parte.origen}</dd></div>
            <div><dt>Destino</dt><dd>{parte.destino}</dd></div>
            <div><dt>Kilometraje inicial</dt><dd>{parte.kmInicial} km</dd></div>
            {parte.kmFinal !== null && <div><dt>Kilometraje final</dt><dd>{parte.kmFinal} km</dd></div>}
            {parte.horasDeclaradas !== null && <div><dt>Horas declaradas</dt><dd>{parte.horasDeclaradas} h</dd></div>}
            {parte.resueltoPor && <div><dt>Revisado por</dt><dd>{parte.resueltoPor}</dd></div>}
            {parte.resueltoEn && <div><dt>Fecha de revisión</dt><dd>{formatFechaHora(parte.resueltoEn)}</dd></div>}
            {parte.firmadoPor && <div><dt>Firma del supervisor</dt><dd>{parte.firmadoPor}</dd></div>}
            {parte.observaciones && <div className="detalle-ancho"><dt>Observaciones</dt><dd>{parte.observaciones}</dd></div>}
            {parte.trabajoRealizado && <div className="detalle-ancho"><dt>Trabajo realizado</dt><dd>{parte.trabajoRealizado}</dd></div>}
            {parte.motivoFreno && <div className="detalle-ancho"><dt>Motivo</dt><dd>{parte.motivoFreno}</dd></div>}
          </dl>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Seguimiento</h2>
        <div className="panel-body">
          <p><strong>Registrado por {parte.operador}</strong> · {formatFechaHora(parte.creadoEn)}</p>
          {parte.estado === "pendiente" ? (
            <p className="aviso-local" role="status">
              El parte quedó pendiente. El control documental todavía no está conectado a Supabase; este registro no autoriza la salida del vehículo.
            </p>
          ) : (
            <p className="ayuda">El parte está en estado «{parte.estado}».</p>
          )}
        </div>
      </section>

      <p><Link to={volver}>← Volver a partes</Link></p>
    </>
  );
}
