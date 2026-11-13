import { useRef, useState, type FormEvent } from "react";
import { formatFecha } from "../../lib/registros";
import {
  ESTADOS_REQUISITO, FORMATOS_ARCHIVO, LECTURA_IA_ACTIVA, abrirArchivo, editarDocumento, eliminarDocumento,
  guardarDocumento, habilitacionesDe, leerDocumentoConIA, nombreActividad, subirArchivo, useLegajos,
  type DatosLegajos, type DocumentoLegajo, type EstadoRequisito, type LecturaIA,
} from "../../lib/legajos";

export function ChipRequisito({ estado }: { estado: EstadoRequisito }) {
  return <span className={`chip ${estado}`}>{ESTADOS_REQUISITO[estado]}</span>;
}

export function ChipHabilitado({ habilitado }: { habilitado: boolean }) {
  return habilitado
    ? <span className="chip vigente">Habilitado</span>
    : <span className="chip vencido">No habilitado</span>;
}

const REVISION: Record<DocumentoLegajo["estado"], { clase: string; texto: string }> = {
  pendiente: { clase: "en-revision", texto: "En revisión" },
  aprobado: { clase: "vigente", texto: "Aprobado" },
  rechazado: { clase: "vencido", texto: "Rechazado" },
};

export function BotonVerArchivo({ path }: { path: string }) {
  const [error, setError] = useState("");
  return (
    <>
      <button type="button" className="secondary" onClick={() => {
        setError("");
        abrirArchivo(path).catch((fallo: Error) => setError(fallo.message));
      }}>Ver</button>
      {error && <span className="error" role="alert"> {error}</span>}
    </>
  );
}

function Habilitaciones({ datos, operadorId }: { datos: DatosLegajos; operadorId: string }) {
  const habilitaciones = habilitacionesDe(datos, operadorId);
  if (habilitaciones.length === 0) return <p className="vacio">Todavía no hay actividades definidas.</p>;

  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead><tr><th>Actividad</th><th>Estado</th><th>Documentos requeridos</th></tr></thead>
        <tbody>
          {habilitaciones.map(({ actividad, habilitado, requisitos }) => (
            <tr key={actividad.id}>
              <td>
                {nombreActividad(actividad)}
                {actividad.descripcion && <><br /><small className="ayuda">{actividad.descripcion}</small></>}
              </td>
              <td><ChipHabilitado habilitado={habilitado} /></td>
              <td>
                {requisitos.length === 0 ? "No exige documentos" : (
                  <ul className="lista-requisitos">
                    {requisitos.map(({ tipo, estado, vencimiento }) => (
                      <li key={tipo.id}>
                        <ChipRequisito estado={estado} /> {tipo.nombre}
                        {vencimiento && <small className="ayuda"> · vence {formatFecha(vencimiento)}</small>}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Documentos({ datos, gestor, ocupado, onEditar, onEliminar }: {
  datos: DatosLegajos;
  gestor: boolean;
  ocupado: boolean;
  onEditar: (documento: DocumentoLegajo) => void;
  onEliminar: (documento: DocumentoLegajo) => void;
}) {
  if (datos.documentos.length === 0) return <p className="vacio">Todavía no hay documentos cargados.</p>;
  const tipo = (id: string) => datos.tipos.find((t) => t.id === id)?.nombre ?? "—";

  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead><tr><th>Documento</th><th>Emisión</th><th>Vencimiento</th><th>Revisión</th><th>Cargado</th><th>Archivo</th><th>Acciones</th></tr></thead>
        <tbody>
          {datos.documentos.map((d) => (
            <tr key={d.id}>
              <td>{tipo(d.tipo_documento_id)}</td>
              <td>{d.fecha_emision ? formatFecha(d.fecha_emision) : "—"}</td>
              <td>{d.vencimiento ? formatFecha(d.vencimiento) : "No vence"}</td>
              <td>
                <span className={`chip ${REVISION[d.estado].clase}`}>{REVISION[d.estado].texto}</span>
                {d.motivo_rechazo && <><br /><small className="texto-alto">{d.motivo_rechazo}</small></>}
              </td>
              <td>{new Date(d.created_at).toLocaleDateString("es-AR")}</td>
              <td><BotonVerArchivo path={d.archivo_path} /></td>
              <td>
                <div className="row">
                  <button type="button" className="secondary" disabled={ocupado} onClick={() => onEditar(d)}>Editar</button>
                  {/* El operador no puede eliminar un documento ya aprobado. */}
                  {(gestor || d.estado !== "aprobado") && (
                    <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => onEliminar(d)}>Eliminar</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Carga un documento nuevo o, con `editando`, corrige o renueva uno existente. */
function FormDocumentoLegajo({ datos, operadorId, gestor, editando, onCancelar, onGuardado }: {
  datos: DatosLegajos;
  operadorId: string;
  gestor: boolean;
  editando: DocumentoLegajo | null;
  onCancelar: () => void;
  onGuardado: (mensaje: string) => Promise<void>;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  /** Ruta del archivo elegido, una vez subido (se sube una sola vez). */
  const [path, setPath] = useState("");
  const [tipoId, setTipoId] = useState(editando?.tipo_documento_id ?? "");
  const [fechaEmision, setFechaEmision] = useState(editando?.fecha_emision ?? "");
  const [vencimiento, setVencimiento] = useState(editando?.vencimiento ?? "");
  const [lectura, setLectura] = useState<LecturaIA | null>(null);
  const [ocupado, setOcupado] = useState<"" | "leyendo" | "guardando">("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  const tipos = datos.tipos.filter((t) => t.activo || t.id === editando?.tipo_documento_id);
  const requiereVencimiento = tipos.find((t) => t.id === tipoId)?.requiere_vencimiento ?? true;

  async function asegurarSubida(elegido: File) {
    if (path) return path;
    const nuevo = await subirArchivo(operadorId, elegido);
    setPath(nuevo);
    return nuevo;
  }

  async function leer() {
    if (!archivo) return;
    setError("");
    setOcupado("leyendo");
    try {
      const resultado = await leerDocumentoConIA(await asegurarSubida(archivo));
      setLectura(resultado);
      if (!resultado.legible) {
        setError("La IA no pudo leer el archivo. Revisá que la foto sea nítida o cargá los datos a mano.");
        return;
      }
      if (resultado.tipo_documento_id) setTipoId(resultado.tipo_documento_id);
      if (resultado.fecha_emision) setFechaEmision(resultado.fecha_emision);
      if (resultado.fecha_vencimiento) setVencimiento(resultado.fecha_vencimiento);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo leer el documento.");
    } finally {
      setOcupado("");
    }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archivo && !editando) return;
    setError("");
    setOcupado("guardando");
    try {
      const campos = {
        tipoId,
        fechaEmision,
        vencimiento: requiereVencimiento ? vencimiento : "",
        path: archivo ? await asegurarSubida(archivo) : "",
        archivoNombre: archivo?.name ?? "",
      };
      const estado = gestor ? "aprobado" : "en revisión hasta que Base lo apruebe";
      if (editando) {
        await editarDocumento(editando, campos);
        await onGuardado(`Documento actualizado. Queda ${estado}.`);
        return;
      }
      await guardarDocumento({ ...campos, operadorId, lectura });
      setArchivo(null);
      setPath("");
      setTipoId("");
      setFechaEmision("");
      setVencimiento("");
      setLectura(null);
      setVersion((n) => n + 1);
      await onGuardado(`Documento cargado. Queda ${estado}.`);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el documento.");
    } finally {
      setOcupado("");
    }
  }

  if (tipos.length === 0) return <p className="vacio">Todavía no hay tipos de documento definidos.</p>;

  return (
    <form onSubmit={enviar}>
      <div className="form-grid">
        <label>{editando ? "Reemplazar archivo" : "Archivo"} <small>({editando ? "opcional; " : ""}PDF o foto, hasta 10 MB)</small>
          <input
            key={version}
            type="file"
            accept={FORMATOS_ARCHIVO}
            required={!editando}
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              setPath("");
              setLectura(null);
            }}
          />
        </label>
        <label>Tipo de documento
          <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} required>
            <option value="" disabled>Elegí un tipo</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label>Fecha de emisión <small>(opcional)</small>
          <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
        </label>
        {requiereVencimiento && (
          <label>Fecha de vencimiento
            <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} required />
          </label>
        )}
      </div>
      {lectura?.legible && (
        <p className="aviso-local" role="status">
          Lectura automática: {lectura.tipo ?? "tipo no reconocido"}
          {lectura.titular && ` · titular ${lectura.titular}`}
          {lectura.identificacion && ` (${lectura.identificacion})`}
          {lectura.emisor && ` · emitido por ${lectura.emisor}`}
          {lectura.observaciones && ` · ${lectura.observaciones}`}. Revisá los datos antes de guardar.
        </p>
      )}
      {editando && (
        <p className="ayuda">
          Archivo actual: {editando.archivo_nombre}.
          {!gestor && " Al guardar, el documento vuelve a revisión y no cuenta para las habilitaciones hasta que Base lo apruebe."}
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {editando && <button type="button" className="secondary" disabled={ocupado !== ""} onClick={onCancelar}>Cancelar</button>}
        {LECTURA_IA_ACTIVA && (
          <button type="button" className="secondary" disabled={!archivo || ocupado !== ""} onClick={() => void leer()}>
            {ocupado === "leyendo" ? "Leyendo…" : "Leer datos con IA"}
          </button>
        )}
        <button type="submit" className="primary inline" disabled={ocupado !== ""}>
          {ocupado === "guardando" ? "Guardando…" : editando ? "Guardar cambios" : "Cargar documento"}
        </button>
      </div>
    </form>
  );
}

/** Legajo de un operador: habilitaciones por actividad, documentos, carga y edición. */
export function LegajoOperador({ operadorId, gestor }: { operadorId: string; gestor: boolean }) {
  const { datos, error, refresh } = useLegajos(operadorId);
  const [editando, setEditando] = useState<DocumentoLegajo | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [fallo, setFallo] = useState("");
  const formulario = useRef<HTMLElement>(null);
  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando legajo…</p>;

  const tipo = (id: string) => datos.tipos.find((t) => t.id === id)?.nombre ?? "documento";

  async function eliminar(documento: DocumentoLegajo) {
    if (!window.confirm(`¿Eliminar "${tipo(documento.tipo_documento_id)}" del legajo? El archivo también se borra y no se puede recuperar.`)) return;
    setAviso("");
    setFallo("");
    setEliminando(true);
    try {
      await eliminarDocumento(documento);
      if (editando?.id === documento.id) setEditando(null);
      await refresh();
      setAviso("Documento eliminado.");
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo eliminar el documento.");
    } finally {
      setEliminando(false);
    }
  }

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="panel">
        <h2 className="panel-header">Habilitaciones por actividad</h2>
        <div className="panel-body">
          <p className="ayuda">
            Una actividad queda habilitada cuando todos los documentos que exige están aprobados y vigentes.
          </p>
          <Habilitaciones datos={datos} operadorId={operadorId} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Documentos cargados</h2>
        <div className="panel-body">
          <p className="ayuda">
            Para una renovación podés cargar el documento nuevo (el anterior queda como historial) o editar el existente.
          </p>
          {fallo && <p className="error" role="alert">{fallo}</p>}
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <Documentos
            datos={datos}
            gestor={gestor}
            ocupado={eliminando}
            onEliminar={(documento) => void eliminar(documento)}
            onEditar={(documento) => {
              setAviso("");
              setFallo("");
              setEditando(documento);
              formulario.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </div>
      </section>

      <section className="panel" ref={formulario}>
        <h2 className="panel-header">{editando ? `Editar documento: ${tipo(editando.tipo_documento_id)}` : "Cargar documento"}</h2>
        <div className="panel-body">
          <FormDocumentoLegajo
            key={editando?.id ?? "nuevo"}
            datos={datos}
            operadorId={operadorId}
            gestor={gestor}
            editando={editando}
            onCancelar={() => setEditando(null)}
            onGuardado={async (mensaje) => {
              setEditando(null);
              setFallo("");
              await refresh();
              setAviso(mensaje);
            }}
          />
        </div>
      </section>
    </>
  );
}
