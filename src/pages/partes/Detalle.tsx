import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { DatosRiesgo, TEXTO_RIESGO, TablaTrabajos, TextoAts, TotalesStrix, hayRiesgo } from "../../components/partes/ResumenParte";
import { EstadoParteChip } from "../../components/partes/TablaPartes";
import { BotonEliminar } from "../../components/ui/BotonEliminar";
import { StatusChip } from "../../components/ui/StatusChip";
import { eliminarParteDiario } from "../../lib/operaciones";
import { formatFecha, formatFechaHora, type Parte } from "../../lib/registros";
import { cerrarParte, controlarParte, firmarParte, resolverExcepcion, usePartes, useResumenParte } from "../../lib/usePartes";

/** Ubicación, evaluación de riesgo, ATS y trabajos (gerenciamientos) del parte. */
function ResumenDelParte({ parte }: { parte: Parte }) {
  const { resumen, error } = useResumenParte(parte.id);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!resumen) return null;
  const estado = resumen.riesgo.estado ? TEXTO_RIESGO[resumen.riesgo.estado] : null;
  const puedeSumarTrabajos = parte.estado === "en_curso";

  return (
    <>
      {(hayRiesgo(resumen.riesgo) || resumen.ats) && (
        <section className="panel">
          <h2 className="panel-header panel-header-fila">
            Ubicación y condiciones
            {estado && <span className={`chip ${estado.clase}`}>{estado.texto}</span>}
          </h2>
          <div className="panel-body">
            <DatosRiesgo riesgo={resumen.riesgo} />
            <h3 className="checklist-subtitulo">Análisis de trabajo seguro (ATS)</h3>
            <TextoAts ats={resumen.ats} />
            {resumen.conformidadEn && <p className="exito">Conformidad del operador: {formatFechaHora(resumen.conformidadEn)}.</p>}
          </div>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-header panel-header-fila">
          Trabajos del día (gerenciamientos)
          {puedeSumarTrabajos && <Link className="secondary enlace-boton" to="/gerenciamientos/nuevo">Nuevo gerenciamiento</Link>}
        </h2>
        <div className="panel-body">
          <p className="ayuda">Los gerenciamientos que se cargan para este vehículo mientras el parte está en curso quedan dentro del parte.</p>
          <TablaTrabajos resumen={resumen} />
          <h3 className="checklist-subtitulo">Strix</h3>
          <TotalesStrix resumen={resumen} />
        </div>
      </section>
    </>
  );
}

const HORAS_EQUIPO: Record<string, string> = {
  "Izaje Hidrogrua": "Horas de hidrogrúa",
  "Altura Barquilla": "Horas de barquilla",
};

interface Permisos {
  /** El operador que cargó el parte. */
  esDueno: boolean;
  /** Supervisor o Admin. */
  esBase: boolean;
  esAdmin: boolean;
}

type Ejecutar = (accion: () => Promise<void>, mensaje: string) => Promise<boolean>;

function ListaVencidos({ parte }: { parte: Parte }) {
  if (parte.documentosVencidos.length === 0) return null;
  return (
    <ul className="lista-requisitos">
      {parte.documentosVencidos.map((d) => <li key={d}><span className="chip vencido">{d.startsWith("Matriz de riesgos") ? "Suspender" : "Vencido"}</span> {d}</li>)}
    </ul>
  );
}

function CerrarServicio({ parte, ocupado, ejecutar }: { parte: Parte; ocupado: boolean; ejecutar: Ejecutar }) {
  const etiquetaHoras = HORAS_EQUIPO[parte.tarea];
  const [kmFinal, setKmFinal] = useState("");
  const [horas, setHoras] = useState("");
  const [trabajo, setTrabajo] = useState("");

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ejecutar(() => cerrarParte(parte.id, {
      kmFinal: Number(kmFinal),
      horas: horas.trim() === "" ? null : Number(horas),
      trabajo: trabajo.trim(),
    }), "Servicio cerrado. El parte queda esperando la firma del supervisor.");
  }

  return (
    <form onSubmit={enviar}>
      <h3 className="checklist-subtitulo">Cerrar el servicio</h3>
      <p className="ayuda">Completalo al terminar la jornada.</p>
      <div className="form-grid">
        <label>Kilometraje final
          <input type="number" min={parte.kmInicial} step="any" value={kmFinal} onChange={(e) => setKmFinal(e.target.value)} required />
          <small className="ayuda">Inicial: {parte.kmInicial} km</small>
        </label>
        {etiquetaHoras ? (
          <label>{etiquetaHoras}
            <input type="number" min="0" max="24" step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} required />
          </label>
        ) : (
          <label>Horas de trabajo <small>(opcional)</small>
            <input type="number" min="0" max="24" step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} />
          </label>
        )}
      </div>
      <label>Trabajo realizado
        <textarea rows={3} value={trabajo} onChange={(e) => setTrabajo(e.target.value)} placeholder="Detalle de las tareas del día" required />
      </label>
      <div className="actions">
        <button type="submit" className="primary inline" disabled={ocupado}>{ocupado ? "Guardando…" : "Cerrar servicio"}</button>
      </div>
    </form>
  );
}

function ResolverExcepcion({ parte, ocupado, ejecutar }: { parte: Parte; ocupado: boolean; ejecutar: Ejecutar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");

  function frenar() {
    if (!motivo.trim()) {
      setError("Escribí el motivo por el que se frena la salida (lo ve el operador).");
      return;
    }
    setError("");
    void ejecutar(() => resolverExcepcion(parte.id, false, motivo.trim()), "Salida frenada. Se avisó al operador.");
  }

  return (
    <>
      <label>Motivo <small>(obligatorio para frenar la salida)</small>
        <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary peligro" disabled={ocupado} onClick={frenar}>Frenar salida</button>
        <button
          type="button"
          className="primary inline"
          disabled={ocupado}
          onClick={() => void ejecutar(() => resolverExcepcion(parte.id, true, ""), "Salida excepcional autorizada. Se avisó al operador.")}
        >
          Autorizar salida
        </button>
      </div>
    </>
  );
}

/** Qué pasa con el parte ahora y qué puede hacer cada uno. */
function Seguimiento({ parte, permisos, ocupado, ejecutar }: { parte: Parte; permisos: Permisos; ocupado: boolean; ejecutar: Ejecutar }) {
  const { esDueno, esBase, esAdmin } = permisos;
  const puedeOperar = esDueno || esBase;
  const controlar = (mensaje: string) => ejecutar(() => controlarParte(parte.id), mensaje);

  switch (parte.estado) {
    case "pendiente":
      return (
        <>
          <p className="aviso-local" role="status">Falta hacer el control documental del vehículo y del legajo del operador. Hasta entonces no se puede salir.</p>
          {puedeOperar && (
            <div className="actions">
              <button type="button" className="primary inline" disabled={ocupado} onClick={() => void controlar("Control documental realizado.")}>
                Hacer el control documental
              </button>
            </div>
          )}
        </>
      );
    case "excepcion":
      return (
        <>
          <p className="aviso-local" role="status">
            Hay documentación vencida o la matriz de riesgos indica suspender. La salida necesita la autorización de un administrador.
          </p>
          <ListaVencidos parte={parte} />
          {esAdmin && <ResolverExcepcion parte={parte} ocupado={ocupado} ejecutar={ejecutar} />}
          {!esAdmin && esDueno && <p className="ayuda">Esperá la respuesta de Base antes de salir.</p>}
          {puedeOperar && (
            <>
              <p className="ayuda">Si ya se renovó el documento vencido, volvé a hacer el control.</p>
              <div className="actions actions-inicio">
                <button type="button" className="secondary" disabled={ocupado} onClick={() => void controlar("Control documental realizado de nuevo.")}>
                  Volver a hacer el control
                </button>
              </div>
            </>
          )}
        </>
      );
    case "en_curso":
      return (
        <>
          <p>
            <strong>En curso</strong>{parte.salidaEn && <> desde el {formatFechaHora(parte.salidaEn)}</>}.
            {parte.resueltoPor && <> Salida excepcional autorizada por {parte.resueltoPor}.</>}
          </p>
          {puedeOperar
            ? <CerrarServicio parte={parte} ocupado={ocupado} ejecutar={ejecutar} />
            : <p className="ayuda">El operador cierra el servicio al terminar la jornada.</p>}
        </>
      );
    case "frenado":
      return (
        <>
          <p className="error" role="status">
            {parte.resueltoPor ? `${parte.resueltoPor} frenó la salida` : "La salida fue frenada"}
            {parte.motivoFreno ? `: ${parte.motivoFreno}` : "."}
          </p>
          <ListaVencidos parte={parte} />
          {esDueno && (
            <p className="ayuda">Cuando la documentación esté al día podés <Link to="/chofer/nuevo">crear un parte nuevo</Link>.</p>
          )}
        </>
      );
    case "cerrado":
      return (
        <>
          <p>
            Servicio cerrado{parte.cerradoEn && <> el {formatFechaHora(parte.cerradoEn)}</>}
            {parte.kmFinal !== null && <> · {(parte.kmFinal - parte.kmInicial).toLocaleString("es-AR", { maximumFractionDigits: 1 })} km recorridos</>}.
          </p>
          {parte.firmadoEn ? (
            <p className="exito">Firmado por {parte.firmadoPor} el {formatFechaHora(parte.firmadoEn)}.</p>
          ) : esBase ? (
            <div className="actions actions-inicio">
              <button type="button" className="primary inline" disabled={ocupado} onClick={() => void ejecutar(() => firmarParte(parte.id), "Parte firmado.")}>
                Firmar parte
              </button>
            </div>
          ) : (
            <p className="ayuda">Falta la firma del supervisor.</p>
          )}
        </>
      );
  }
}

export default function DetalleParte() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { operador } = useAuth();
  const { partes, loading, error, refresh } = usePartes();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [fallo, setFallo] = useState("");
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

  const permisos: Permisos = { esDueno: parte.creadoPor === operador.id, esBase: esSupervisor, esAdmin: operador.rol === "admin" };
  // Misma regla que la base: admin siempre; supervisor si no está firmado; el operador antes de salir.
  const puedeBorrar = permisos.esAdmin
    || (esSupervisor && !parte.firmadoEn)
    || (permisos.esDueno && ["pendiente", "excepcion", "frenado"].includes(parte.estado));

  const ejecutar: Ejecutar = async (accion, mensaje) => {
    setAviso("");
    setFallo("");
    setOcupado(true);
    try {
      await accion();
      await refresh();
      setAviso(mensaje);
      return true;
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo actualizar el parte.");
      return false;
    } finally {
      setOcupado(false);
    }
  };

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
            <div>
              <dt>Control documental</dt>
              <dd>{parte.estado === "pendiente" ? "Sin hacer" : <StatusChip estado={parte.semaforo} />}</dd>
            </div>
            {parte.kmFinal !== null && <div><dt>Kilometraje final</dt><dd>{parte.kmFinal} km</dd></div>}
            {parte.horasDeclaradas !== null && <div><dt>Horas declaradas</dt><dd>{parte.horasDeclaradas} h</dd></div>}
            {parte.resueltoPor && <div><dt>Excepción resuelta por</dt><dd>{parte.resueltoPor}</dd></div>}
            {parte.resueltoEn && <div><dt>Fecha de resolución</dt><dd>{formatFechaHora(parte.resueltoEn)}</dd></div>}
            {parte.firmadoPor && <div><dt>Firma del supervisor</dt><dd>{parte.firmadoPor}</dd></div>}
            {parte.observaciones && <div className="detalle-ancho"><dt>Observaciones</dt><dd>{parte.observaciones}</dd></div>}
            {parte.trabajoRealizado && <div className="detalle-ancho"><dt>Trabajo realizado</dt><dd>{parte.trabajoRealizado}</dd></div>}
            {parte.motivoFreno && <div className="detalle-ancho"><dt>Motivo del freno</dt><dd>{parte.motivoFreno}</dd></div>}
          </dl>
        </div>
      </section>

      <ResumenDelParte parte={parte} />

      <section className="panel">
        <h2 className="panel-header">Seguimiento</h2>
        <div className="panel-body">
          <p><strong>Registrado por {parte.operador}</strong> · {formatFechaHora(parte.creadoEn)}</p>
          {aviso && <p className="exito" role="status">{aviso}</p>}
          {fallo && <p className="error" role="alert">{fallo}</p>}
          <Seguimiento parte={parte} permisos={permisos} ocupado={ocupado} ejecutar={ejecutar} />
        </div>
      </section>

      {parte.estado === "cerrado" && (
        <section className="panel">
          <h2 className="panel-header">Informes</h2>
          <div className="panel-body">
            <p className="ayuda">Se abren listos para imprimir o guardar como PDF.</p>
            <div className="actions actions-inicio">
              <Link className="secondary enlace-boton" to={`/partes/${parte.id}/informe/1`}>Parte comercial</Link>
              <Link className="secondary enlace-boton" to={`/partes/${parte.id}/informe/2`}>Dossier operativo + HSE</Link>
              {permisos.esAdmin && <Link className="secondary enlace-boton" to={`/partes/${parte.id}/informe/3`}>Auditoría interna</Link>}
            </div>
          </div>
        </section>
      )}

      <div className="actions actions-inicio">
        <Link to={volver}>← Volver a partes</Link>
        {puedeBorrar && (
          <BotonEliminar
            tipo="el parte diario"
            nombre={`N° ${parte.numero} · ${parte.vehiculo} · ${formatFecha(parte.fecha)}`}
            consecuencias={["Los gerenciamientos que agrupaba quedan cargados, pero sin parte."]}
            onEliminar={async () => { await eliminarParteDiario(parte.id); navigate(volver); }}
          />
        )}
      </div>
    </>
  );
}
