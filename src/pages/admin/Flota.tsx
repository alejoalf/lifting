import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BotonVerArchivo } from "../../components/legajo/LegajoOperador";
import { TiposDocumento } from "../../components/legajo/TiposDocumento";
import { StatusChip } from "../../components/ui/StatusChip";
import { contiene, formatFecha, semaforoDe } from "../../lib/registros";
import { FORMATOS_ARCHIVO } from "../../lib/legajos";
import {
  eliminarDocumentoVehiculo, eliminarVehiculo, estadoDocumental, etiquetaColumna, guardarDocumentoVehiculo,
  guardarVehiculo, texto, useColumnasVehiculo, useFlota,
  type ColumnaVehiculo, type DatosFlota, type DocumentoVehiculo, type Vehiculo,
} from "../../lib/flota";

function FechaConEstado({ fecha }: { fecha: unknown }) {
  const valor = texto(fecha);
  if (!valor) return <>Sin fecha</>;
  return <>{formatFecha(valor)} <StatusChip estado={semaforoDe(valor)} /></>;
}

/** Listado de la flota para el panel del administrador. */
export function ListaFlota() {
  const { datos, error } = useFlota();
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando flota…</p>;

  const estados = [...new Set(datos.vehiculos.map((v) => texto(v.estado)).filter(Boolean))].sort();
  const visibles = datos.vehiculos.filter((v) =>
    (!estado || texto(v.estado) === estado) &&
    contiene(`${texto(v.dominio)} ${texto(v.marca_modelo)} ${texto(v.equipo)}`, busqueda));

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">TOTAL</span><span className="stat-value">{datos.vehiculos.length}</span></div>
        {estados.map((e) => (
          <div className="stat" key={e}>
            <span className="stat-label">ESTADO: {e.toLocaleUpperCase("es")}</span>
            <span className="stat-value">{datos.vehiculos.filter((v) => texto(v.estado) === e).length}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2 className="panel-header panel-header-fila">
          Unidades
          <Link className="secondary enlace-boton" to="/admin/flota/nuevo">Agregar vehículo</Link>
        </h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Dominio, marca o equipo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option>
                {estados.map((e) => <option key={e}>{e}</option>)}
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead>
                <tr><th>Dominio</th><th>Marca / modelo</th><th>Equipo</th><th>Estado</th><th>Último service</th><th>Próximo service</th><th>Documentos</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {visibles.map((v) => {
                  const documental = estadoDocumental(datos.documentos, v.id);
                  const ultimo = texto(v.ultimo_service);
                  return (
                    <tr key={v.id}>
                      <td><Link to={`/admin/flota/${v.id}`}>{texto(v.dominio) || "—"}</Link></td>
                      <td>{texto(v.marca_modelo) || "—"}</td>
                      <td>{texto(v.equipo) || "—"}</td>
                      <td>{texto(v.estado) || "—"}</td>
                      <td>{ultimo ? formatFecha(ultimo) : "Sin fecha"}</td>
                      <td><FechaConEstado fecha={v.proximo_service} /></td>
                      <td>
                        <StatusChip estado={documental.peor} />
                        {documental.vencidos > 0 && <small className="texto-alto"> {documental.vencidos} vencido{documental.vencidos > 1 ? "s" : ""}</small>}
                      </td>
                      <td><Link className="secondary enlace-boton" to={`/admin/flota/${v.id}`}>Editar</Link></td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={8} className="vacio">{datos.vehiculos.length ? "Ningún vehículo coincide con la búsqueda." : "Todavía no hay vehículos cargados."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="resultados">Cantidad de resultados: {visibles.length}</p>
        </div>
      </section>
    </>
  );
}

type Valores = Record<string, string | boolean>;

function valoresIniciales(columnas: ColumnaVehiculo[], vehiculo: Vehiculo | null): Valores {
  return Object.fromEntries(columnas.map((c) => {
    const valor = vehiculo?.[c.columna];
    return [c.columna, c.tipo === "booleano" ? valor === true : texto(valor)];
  }));
}

/** Formulario con todos los datos del vehículo, armado a partir de las columnas de la base. */
function FormVehiculo({ columnas, vehiculo, onGuardado }: {
  columnas: ColumnaVehiculo[];
  vehiculo: Vehiculo | null;
  onGuardado: (id: string) => Promise<void>;
}) {
  const [valores, setValores] = useState(() => valoresIniciales(columnas, vehiculo));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cambiar = (columna: string, valor: string | boolean) => setValores((actuales) => ({ ...actuales, [columna]: valor }));

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setGuardando(true);
    try {
      const datos = Object.fromEntries(columnas.map((c) => {
        const valor = valores[c.columna];
        if (typeof valor === "boolean") return [c.columna, valor];
        const limpio = valor.trim();
        return [c.columna, limpio === "" ? null : c.tipo === "numero" ? Number(limpio) : limpio];
      }));
      await onGuardado(await guardarVehiculo(vehiculo?.id ?? null, datos));
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el vehículo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="form-grid">
        {columnas.map((c) => {
          const valor = valores[c.columna];
          const etiqueta = <>{etiquetaColumna(c.columna)}{!c.obligatoria && c.tipo !== "booleano" && <small> (opcional)</small>}</>;
          if (typeof valor === "boolean") {
            return (
              <div key={c.columna}>
                <label className="check"><input type="checkbox" checked={valor} onChange={(e) => cambiar(c.columna, e.target.checked)} /> {etiquetaColumna(c.columna)}</label>
              </div>
            );
          }
          if (c.tipo === "enum") {
            return (
              <label key={c.columna}>{etiqueta}
                <select value={valor} onChange={(e) => cambiar(c.columna, e.target.value)} required={c.obligatoria}>
                  <option value="">{c.obligatoria ? "Elegí una opción" : "Sin definir"}</option>
                  {(c.opciones ?? []).map((opcion) => <option key={opcion}>{opcion}</option>)}
                </select>
              </label>
            );
          }
          return (
            <label key={c.columna}>{etiqueta}
              <input
                type={c.tipo === "fecha" ? "date" : c.tipo === "numero" ? "number" : "text"}
                step={c.tipo === "numero" ? "any" : undefined}
                value={valor}
                onChange={(e) => cambiar(c.columna, e.target.value)}
                required={c.obligatoria}
              />
            </label>
          );
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary inline" disabled={guardando}>
          {guardando ? "Guardando…" : vehiculo ? "Guardar cambios" : "Agregar vehículo"}
        </button>
      </div>
    </form>
  );
}

function DocumentosVehiculo({ datos, vehiculoId, onCambio }: {
  datos: DatosFlota;
  vehiculoId: string;
  onCambio: () => Promise<void>;
}) {
  const [editando, setEditando] = useState<DocumentoVehiculo | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tipoId, setTipoId] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const documentos = datos.documentos.filter((d) => d.vehiculo_id === vehiculoId);
  const tipos = datos.tipos.filter((t) => t.activo || t.id === editando?.tipo_documento_id);
  const nombreTipo = (id: string) => datos.tipos.find((t) => t.id === id)?.nombre ?? "documento";
  const requiereVencimiento = datos.tipos.find((t) => t.id === tipoId)?.requiere_vencimiento ?? true;

  function cargarEnFormulario(documento: DocumentoVehiculo | null) {
    setEditando(documento);
    setArchivo(null);
    setTipoId(documento?.tipo_documento_id ?? "");
    setFechaEmision(documento?.fecha_emision ?? "");
    setVencimiento(documento?.vencimiento ?? "");
    setVersion((n) => n + 1);
    setError("");
  }

  async function ejecutar(accion: () => Promise<void>, mensaje: string) {
    setError("");
    setAviso("");
    setOcupado(true);
    try {
      await accion();
      cargarEnFormulario(null);
      await onCambio();
      setAviso(mensaje);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el documento.");
    } finally {
      setOcupado(false);
    }
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ejecutar(() => guardarDocumentoVehiculo({
      vehiculoId,
      tipoId,
      fechaEmision,
      vencimiento: requiereVencimiento ? vencimiento : "",
      archivo,
      anterior: editando,
    }), editando ? "Documento actualizado." : "Documento cargado.");
  }

  function eliminar(documento: DocumentoVehiculo) {
    if (!window.confirm(`¿Eliminar "${nombreTipo(documento.tipo_documento_id)}"? El archivo también se borra y no se puede recuperar.`)) return;
    void ejecutar(() => eliminarDocumentoVehiculo(documento), "Documento eliminado.");
  }

  return (
    <section className="panel">
      <h2 className="panel-header">Documentos del vehículo</h2>
      <div className="panel-body">
        <p className="ayuda">Para una renovación podés cargar el documento nuevo (el anterior queda como historial) o editar el existente.</p>
        {aviso && <p className="exito" role="status">{aviso}</p>}
        {documentos.length === 0 ? <p className="vacio">Todavía no hay documentos cargados.</p> : (
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>Documento</th><th>Emisión</th><th>Vencimiento</th><th>Cargado</th><th>Archivo</th><th>Acciones</th></tr></thead>
              <tbody>
                {documentos.map((d) => (
                  <tr key={d.id}>
                    <td>{nombreTipo(d.tipo_documento_id)}</td>
                    <td>{d.fecha_emision ? formatFecha(d.fecha_emision) : "—"}</td>
                    <td>{d.vencimiento ? <FechaConEstado fecha={d.vencimiento} /> : "No vence"}</td>
                    <td>{new Date(d.created_at).toLocaleDateString("es-AR")}</td>
                    <td><BotonVerArchivo path={d.archivo_path} bucket="flota" /></td>
                    <td>
                      <div className="row">
                        <button type="button" className="secondary" disabled={ocupado} onClick={() => { setAviso(""); cargarEnFormulario(d); }}>Editar</button>
                        <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => eliminar(d)}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="panel-header">{editando ? `Editar documento: ${nombreTipo(editando.tipo_documento_id)}` : "Cargar documento"}</h2>
      {tipos.length === 0 ? <p className="panel-body vacio">Primero creá los tipos de documento de vehículo, más abajo.</p> : (
        <form className="panel-body" onSubmit={enviar}>
          <div className="form-grid">
            <label>{editando ? "Reemplazar archivo" : "Archivo"} <small>({editando ? "opcional; " : ""}PDF o foto, hasta 10 MB)</small>
              <input key={version} type="file" accept={FORMATOS_ARCHIVO} required={!editando} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
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
          {editando && <p className="ayuda">Archivo actual: {editando.archivo_nombre}.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            {editando && <button type="button" className="secondary" disabled={ocupado} onClick={() => cargarEnFormulario(null)}>Cancelar</button>}
            <button type="submit" className="primary inline" disabled={ocupado}>
              {ocupado ? "Guardando…" : editando ? "Guardar cambios" : "Cargar documento"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Ficha de un vehículo (Admin): datos, service, documentos y baja. Con "nuevo" da de alta uno. */
export default function Vehiculo() {
  const { vehiculoId = "" } = useParams();
  const navigate = useNavigate();
  const { datos, error, refresh } = useFlota();
  const { columnas, error: errorColumnas } = useColumnasVehiculo();
  const [aviso, setAviso] = useState("");
  const [errorBaja, setErrorBaja] = useState("");
  const [eliminando, setEliminando] = useState(false);

  if (error || errorColumnas) return <p className="error" role="alert">{error || errorColumnas}</p>;
  if (!datos || !columnas) return <p className="estado">Cargando vehículo…</p>;

  const nuevo = vehiculoId === "nuevo";
  const vehiculo = nuevo ? null : datos.vehiculos.find((v) => v.id === vehiculoId) ?? null;
  if (!nuevo && !vehiculo) return <p className="estado">El vehículo no existe. <Link to="/admin">Volver a la flota</Link></p>;

  async function eliminar(actual: Vehiculo) {
    if (!window.confirm(`¿Quitar ${texto(actual.dominio) || "este vehículo"} de la flota? Se borran también sus documentos y no se puede deshacer.`)) return;
    setErrorBaja("");
    setEliminando(true);
    try {
      await eliminarVehiculo(actual.id, datos?.documentos ?? []);
      navigate("/admin");
    } catch (fallo) {
      setErrorBaja(fallo instanceof Error ? fallo.message : "No se pudo eliminar el vehículo.");
      setEliminando(false);
    }
  }

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin">← Flota</Link>
        {vehiculo && <><strong>{texto(vehiculo.dominio)}</strong><span className="ayuda">{texto(vehiculo.marca_modelo)}</span></>}
      </p>

      <section className="panel">
        <h2 className="panel-header">{vehiculo ? "Datos del vehículo" : "Nuevo vehículo"}</h2>
        <div className="panel-body">
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <FormVehiculo
            key={vehiculo?.id ?? "nuevo"}
            columnas={columnas}
            vehiculo={vehiculo}
            onGuardado={async (id) => {
              await refresh();
              setAviso(vehiculo ? "Cambios guardados." : "Vehículo agregado. Ya podés cargarle documentos.");
              if (!vehiculo) navigate(`/admin/flota/${id}`, { replace: true });
            }}
          />
        </div>
      </section>

      {vehiculo && (
        <>
          <DocumentosVehiculo datos={datos} vehiculoId={vehiculo.id} onCambio={refresh} />
          <TiposDocumento aplicaA="vehiculo" tipos={datos.tipos} onCambio={refresh} />

          <section className="panel">
            <h2 className="panel-header">Quitar de la flota</h2>
            <div className="panel-body">
              <p className="ayuda">
                Elimina el vehículo y sus documentos. Si ya tiene partes o contratos asociados no se puede eliminar: en ese caso cambiale el estado.
              </p>
              {errorBaja && <p className="error" role="alert">{errorBaja}</p>}
              <div className="actions">
                <button type="button" className="secondary peligro" disabled={eliminando} onClick={() => void eliminar(vehiculo)}>
                  {eliminando ? "Eliminando…" : "Eliminar vehículo"}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
