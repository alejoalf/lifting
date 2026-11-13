import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormFila, TablaFilas, ZonaEliminar, textoFila } from "../../components/datos/FormFila";
import { BotonVerArchivo } from "../../components/legajo/LegajoOperador";
import { StatusChip } from "../../components/ui/StatusChip";
import { FORMATOS_ARCHIVO } from "../../lib/legajos";
import { contiene, formatFecha, semaforoDe } from "../../lib/registros";
import {
  eliminarCertificado, eliminarFila, estadoCobro, guardarCertificado, guardarFila, nombreCliente,
  nombreContrato, referencias, texto, useComercial,
  type Certificado, type DatosComerciales,
} from "../../lib/comercial";
import { CeldaCobro, ChipCobro } from "./Clientes";

function Mensuales({ datos }: { datos: DatosComerciales }) {
  const [busqueda, setBusqueda] = useState("");
  const [cobro, setCobro] = useState("");
  const refs = referencias(datos);
  const visibles = datos.certificaciones.filter((c) =>
    (!cobro || estadoCobro(c).texto === cobro) &&
    contiene(textoFila(datos.columnas.certificaciones, c, refs), busqueda));

  return (
    <section className="panel">
      <h2 className="panel-header panel-header-fila">
        Certificaciones mensuales
        <Link className="secondary enlace-boton" to="/admin/certificaciones/nueva">Agregar certificación</Link>
      </h2>
      <div className="panel-body">
        <p className="ayuda">Liquidación de cada contrato por período: es lo que respalda la factura al cliente.</p>
        <div className="form-grid compacto">
          <label>Buscar<input placeholder="Cliente, contrato, período, factura…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          <label>Cobro
            <select value={cobro} onChange={(e) => setCobro(e.target.value)}>
              <option value="">Todos</option>
              <option>Sin facturar</option><option>Facturada, falta cobro</option><option>Cobrada</option>
            </select>
          </label>
        </div>
        <TablaFilas
          columnas={datos.columnas.certificaciones}
          filas={visibles}
          referencias={refs}
          enlace={(c) => `/admin/certificaciones/${c.id}`}
          extra={{ titulo: "Importe y cobro", celda: (c) => <CeldaCobro datos={datos} certificacion={c} /> }}
          vacio={datos.certificaciones.length ? "Ninguna certificación coincide con los filtros." : "Todavía no hay certificaciones cargadas."}
        />
        <p className="resultados">Cantidad de resultados: {visibles.length}</p>
      </div>
    </section>
  );
}

function Seleccion({ titulo, opciones, elegidos, onCambio }: {
  titulo: string;
  opciones: { id: string; nombre: string }[];
  elegidos: string[];
  onCambio: (ids: string[]) => void;
}) {
  return (
    <fieldset className="grupo">
      <legend>{titulo}</legend>
      {opciones.length === 0 && <p className="vacio">No hay opciones cargadas.</p>}
      <div className="check-row">
        {opciones.map((o) => (
          <label className="check" key={o.id}>
            <input
              type="checkbox"
              checked={elegidos.includes(o.id)}
              onChange={(e) => onCambio(e.target.checked ? [...elegidos, o.id] : elegidos.filter((id) => id !== o.id))}
            />
            {o.nombre}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const CERTIFICADO_NUEVO = { nombre: "", emisor: "", fecha_emision: "", vencimiento: "", observaciones: "", aplica_a_todos: false };

function Certificados({ datos, onCambio }: { datos: DatosComerciales; onCambio: () => Promise<void> }) {
  const [editando, setEditando] = useState<Certificado | null>(null);
  const [campos, setCampos] = useState(CERTIFICADO_NUEVO);
  const [clienteIds, setClienteIds] = useState<string[]>([]);
  const [contratoIds, setContratoIds] = useState<string[]>([]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const clientesDe = (id: string) => datos.certificadoClientes.filter((v) => v.certificado_id === id).map((v) => v.cliente_id);
  const contratosDe = (id: string) => datos.certificadoContratos.filter((v) => v.certificado_id === id).map((v) => v.contrato_id);

  function cargarEnFormulario(certificado: Certificado | null) {
    setEditando(certificado);
    setCampos(certificado ? {
      nombre: certificado.nombre,
      emisor: certificado.emisor ?? "",
      fecha_emision: certificado.fecha_emision ?? "",
      vencimiento: certificado.vencimiento ?? "",
      observaciones: certificado.observaciones ?? "",
      aplica_a_todos: certificado.aplica_a_todos,
    } : CERTIFICADO_NUEVO);
    setClienteIds(certificado ? clientesDe(certificado.id) : []);
    setContratoIds(certificado ? contratosDe(certificado.id) : []);
    setArchivo(null);
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
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el certificado.");
    } finally {
      setOcupado(false);
    }
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ejecutar(() => guardarCertificado({
      anterior: editando,
      campos: {
        nombre: campos.nombre.trim(),
        emisor: campos.emisor.trim() || null,
        fecha_emision: campos.fecha_emision || null,
        vencimiento: campos.vencimiento || null,
        observaciones: campos.observaciones.trim() || null,
        aplica_a_todos: campos.aplica_a_todos,
      },
      archivo,
      clienteIds: campos.aplica_a_todos ? [] : clienteIds,
      contratoIds: campos.aplica_a_todos ? [] : contratoIds,
    }), editando ? "Certificado actualizado." : "Certificado cargado.");
  }

  function alcance(certificado: Certificado) {
    if (certificado.aplica_a_todos) return "Todos los clientes";
    const nombres = [
      ...clientesDe(certificado.id).map((id) => nombreCliente(datos, id)),
      ...contratosDe(certificado.id).map((id) => `Contrato: ${nombreContrato(datos, datos.contratos.find((c) => c.id === id))}`),
    ];
    return nombres.length ? nombres.join("; ") : "Sin asignar";
  }

  return (
    <section className="panel">
      <h2 className="panel-header">Certificados y requisitos que exigen los clientes</h2>
      <div className="panel-body">
        <p className="ayuda">
          Certificados de la empresa (normas, seguros, inscripciones, habilitaciones) que piden los clientes. Uno solo puede valer para varios clientes o contratos.
        </p>
        {aviso && <p className="exito" role="status">{aviso}</p>}
        {datos.certificados.length === 0 ? <p className="vacio">Todavía no hay certificados cargados.</p> : (
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>Certificado</th><th>Emisor</th><th>Vencimiento</th><th>Aplica a</th><th>Archivo</th><th>Acciones</th></tr></thead>
              <tbody>
                {datos.certificados.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}{c.observaciones && <><br /><small className="ayuda">{c.observaciones}</small></>}</td>
                    <td>{c.emisor || "—"}</td>
                    <td>{c.vencimiento ? <>{formatFecha(c.vencimiento)} <StatusChip estado={semaforoDe(c.vencimiento)} /></> : "No vence"}</td>
                    <td>{alcance(c)}</td>
                    <td>{c.archivo_path ? <BotonVerArchivo path={c.archivo_path} bucket="certificados" /> : "Sin archivo"}</td>
                    <td>
                      <div className="row">
                        <button type="button" className="secondary" disabled={ocupado} onClick={() => { setAviso(""); cargarEnFormulario(c); }}>Editar</button>
                        <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => {
                          if (window.confirm(`¿Eliminar "${c.nombre}"? El archivo también se borra.`)) void ejecutar(() => eliminarCertificado(c), "Certificado eliminado.");
                        }}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="panel-header">{editando ? `Editar certificado: ${editando.nombre}` : "Nuevo certificado"}</h2>
      <form className="panel-body" onSubmit={enviar}>
        <div className="form-grid">
          <label>Nombre
            <input placeholder="Ej.: ISO 9001, Seguro de RC, ART" value={campos.nombre} onChange={(e) => setCampos({ ...campos, nombre: e.target.value })} required />
          </label>
          <label>Emisor <small>(opcional)</small>
            <input value={campos.emisor} onChange={(e) => setCampos({ ...campos, emisor: e.target.value })} />
          </label>
          <label>Fecha de emisión <small>(opcional)</small>
            <input type="date" value={campos.fecha_emision} onChange={(e) => setCampos({ ...campos, fecha_emision: e.target.value })} />
          </label>
          <label>Vencimiento <small>(vacío = no vence)</small>
            <input type="date" value={campos.vencimiento} onChange={(e) => setCampos({ ...campos, vencimiento: e.target.value })} />
          </label>
          <label>{editando?.archivo_path ? "Reemplazar archivo" : "Archivo"} <small>(opcional; PDF o foto, hasta 10 MB)</small>
            <input key={version} type="file" accept={FORMATOS_ARCHIVO} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          <label>Observaciones <small>(opcional)</small>
            <input value={campos.observaciones} onChange={(e) => setCampos({ ...campos, observaciones: e.target.value })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={campos.aplica_a_todos} onChange={(e) => setCampos({ ...campos, aplica_a_todos: e.target.checked })} />
          Vale para todos los clientes
        </label>
        {!campos.aplica_a_todos && (
          <>
            <Seleccion
              titulo="Clientes que lo exigen"
              opciones={datos.clientes.map((c) => ({ id: c.id, nombre: texto(c.razon_social) }))}
              elegidos={clienteIds}
              onCambio={setClienteIds}
            />
            <Seleccion
              titulo="Contratos puntuales que lo exigen"
              opciones={datos.contratos.map((c) => ({ id: c.id, nombre: nombreContrato(datos, c) }))}
              elegidos={contratoIds}
              onCambio={setContratoIds}
            />
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          {editando && <button type="button" className="secondary" disabled={ocupado} onClick={() => cargarEnFormulario(null)}>Cancelar</button>}
          <button type="submit" className="primary inline" disabled={ocupado}>
            {ocupado ? "Guardando…" : editando ? "Guardar cambios" : "Cargar certificado"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Certificaciones: las mensuales por contrato y los certificados que exigen los clientes. */
export default function Certificaciones() {
  const { datos, error, refresh } = useComercial();
  const [parametros, setParametros] = useSearchParams();
  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando certificaciones…</p>;

  const vista = parametros.get("vista") === "certificados" ? "certificados" : "mensuales";
  const vencidos = datos.certificados.filter((c) => c.vencimiento && semaforoDe(c.vencimiento) === "vencido").length;

  return (
    <>
      <div className="tabs" role="tablist">
        <button type="button" className="tab" role="tab" aria-selected={vista === "mensuales"} onClick={() => setParametros({})}>
          Mensuales ({datos.certificaciones.length})
        </button>
        <button type="button" className="tab" role="tab" aria-selected={vista === "certificados"} onClick={() => setParametros({ vista: "certificados" })}>
          Certificados y requisitos ({datos.certificados.length}{vencidos ? `, ${vencidos} vencido${vencidos > 1 ? "s" : ""}` : ""})
        </button>
      </div>
      {vista === "mensuales" ? <Mensuales datos={datos} /> : <Certificados datos={datos} onCambio={refresh} />}
    </>
  );
}

/** Ficha de una certificación mensual. */
export function FichaCertificacion() {
  const { certificacionId = "" } = useParams();
  const [parametros] = useSearchParams();
  const navigate = useNavigate();
  const { datos, error, refresh } = useComercial();
  const [aviso, setAviso] = useState("");

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando certificación…</p>;

  const nueva = certificacionId === "nueva";
  const certificacion = nueva ? null : datos.certificaciones.find((c) => c.id === certificacionId) ?? null;
  if (!nueva && !certificacion) return <p className="estado">La certificación no existe. <Link to="/admin/certificaciones">Volver a certificaciones</Link></p>;

  const contratoId = texto(certificacion?.contrato_id);
  const contrato = datos.contratos.find((c) => c.id === contratoId);

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin/certificaciones">← Certificaciones</Link>
        {contrato && <strong>{nombreContrato(datos, contrato)}</strong>}
        {certificacion && <CeldaCobro datos={datos} certificacion={certificacion} />}
        {contratoId && <Link to={`/admin/contratos/${contratoId}`}>Ver contrato</Link>}
      </p>

      <section className="panel">
        <h2 className="panel-header">{certificacion ? "Certificación mensual" : "Nueva certificación mensual"}</h2>
        <div className="panel-body">
          <p className="ayuda">
            El importe se calcula solo: valor Infoauto del mes × porcentaje del contrato o, si no hay valor Infoauto, cantidad × tarifa unitaria.
            Al cargar el N° de factura queda como «Facturada, falta cobro»; al cargar la fecha de cobro, como «Cobrada».
          </p>
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <FormFila
            key={certificacion?.id ?? "nueva"}
            columnas={datos.columnas.certificaciones}
            fila={certificacion}
            referencias={referencias(datos)}
            iniciales={{ contrato_id: parametros.get("contrato") ?? "" }}
            guardar={(valores) => guardarFila("certificaciones", certificacion?.id ?? null, valores)}
            onGuardado={async (id) => {
              await refresh();
              setAviso(certificacion ? "Cambios guardados." : "Certificación agregada.");
              if (!certificacion) navigate(`/admin/certificaciones/${id}`, { replace: true });
            }}
            textoNuevo="Agregar certificación"
          />
        </div>
      </section>

      {certificacion && (
        <ZonaEliminar
          titulo="Eliminar certificación"
          ayuda="Borra esta certificación mensual."
          confirmacion="¿Eliminar esta certificación? No se puede deshacer."
          eliminar={async () => {
            await eliminarFila("certificaciones", certificacion.id);
            navigate("/admin/certificaciones");
          }}
        />
      )}
    </>
  );
}
