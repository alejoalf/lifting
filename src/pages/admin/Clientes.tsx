import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormFila, TablaFilas, ZonaEliminar, textoFila } from "../../components/datos/FormFila";
import { BotonVerArchivo } from "../../components/legajo/LegajoOperador";
import { StatusChip } from "../../components/ui/StatusChip";
import { getSupabase } from "../../lib/supabase";
import { contiene, formatFecha, hoy, semaforoDe } from "../../lib/registros";
import { usePartes } from "../../lib/usePartes";
import {
  CLASE_ESTADO_CONTRATO, TIPOS_NOTA, agregarNota, certificacionesDe, certificadosDe, contratosDe, eliminarFila,
  eliminarNota, estadoCobro, formatImporte, guardarFila, importeCertificacion, referencias, texto, useComercial,
  type Certificado, type DatosComerciales, type Fila, type NotaHistorial,
} from "../../lib/comercial";

export function ChipContrato({ contrato }: { contrato: Fila }) {
  const estado = texto(contrato.estado_contrato);
  return <span className={`chip ${CLASE_ESTADO_CONTRATO[estado] ?? "sin-datos"}`}>{estado || "Sin estado"}</span>;
}

export function ChipCobro({ certificacion }: { certificacion: Fila }) {
  const cobro = estadoCobro(certificacion);
  return <span className={`chip ${cobro.clase}`}>{cobro.texto}</span>;
}

/** Importe a facturar de una certificación mensual y su situación de cobro. */
export function CeldaCobro({ datos, certificacion }: { datos: DatosComerciales; certificacion: Fila }) {
  return <>{formatImporte(importeCertificacion(datos, certificacion))} <ChipCobro certificacion={certificacion} /></>;
}

/** Certificados y requisitos que aplican a un cliente o contrato, con su vencimiento. */
export function TablaCertificados({ certificados, vacio }: { certificados: Certificado[]; vacio: string }) {
  if (certificados.length === 0) return <p className="vacio">{vacio}</p>;
  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead><tr><th>Certificado</th><th>Emisor</th><th>Vencimiento</th><th>Alcance</th><th>Archivo</th></tr></thead>
        <tbody>
          {certificados.map((c) => (
            <tr key={c.id}>
              <td>{c.nombre}</td>
              <td>{c.emisor || "—"}</td>
              <td>{c.vencimiento ? <>{formatFecha(c.vencimiento)} <StatusChip estado={semaforoDe(c.vencimiento)} /></> : "No vence"}</td>
              <td>{c.aplica_a_todos ? "Todos los clientes" : "Asignado"}</td>
              <td>{c.archivo_path ? <BotonVerArchivo path={c.archivo_path} bucket="certificados" /> : "Sin archivo"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resumenContratos(contratos: Fila[]) {
  if (contratos.length === 0) return "Sin contratos";
  const porEstado = new Map<string, number>();
  for (const c of contratos) {
    const estado = texto(c.estado_contrato) || "Sin estado";
    porEstado.set(estado, (porEstado.get(estado) ?? 0) + 1);
  }
  return [...porEstado].map(([estado, cantidad]) => `${cantidad} ${estado.toLocaleLowerCase("es")}`).join(" · ");
}

/** Listado de clientes. */
export default function Clientes() {
  const { datos, error } = useComercial();
  const [busqueda, setBusqueda] = useState("");
  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando clientes…</p>;

  const visibles = datos.clientes.filter((c) => contiene(textoFila(datos.columnas.clientes, c), busqueda));
  const impagos = datos.contratos.filter((c) => texto(c.estado_contrato) === "Realizado - falta de pago").length;

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">CLIENTES</span><span className="stat-value">{datos.clientes.length}</span></div>
        <div className="stat stat-ok"><span className="stat-label">CONTRATOS EN CURSO</span><span className="stat-value">{datos.contratos.filter((c) => texto(c.estado_contrato) === "En curso").length}</span></div>
        <div className="stat stat-aviso"><span className="stat-label">CONTRATOS CON FALTA DE PAGO</span><span className="stat-value">{impagos}</span></div>
      </div>

      <section className="panel">
        <h2 className="panel-header panel-header-fila">
          Clientes
          <Link className="secondary enlace-boton" to="/admin/clientes/nuevo">Agregar cliente</Link>
        </h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Razón social, CUIT, contacto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          </div>
          <TablaFilas
            columnas={datos.columnas.clientes}
            filas={visibles}
            enlace={(c) => `/admin/clientes/${c.id}`}
            extra={{ titulo: "Contratos", celda: (c) => resumenContratos(contratosDe(datos, c.id)) }}
            vacio={datos.clientes.length ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes cargados."}
          />
          <p className="resultados">Cantidad de resultados: {visibles.length}</p>
        </div>
      </section>
    </>
  );
}

function Historial({ datos, cliente, contratos }: { datos: DatosComerciales; cliente: Fila; contratos: Fila[] }) {
  const { partes } = usePartes();
  const [notas, setNotas] = useState<NotaHistorial[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: fallo } = await getSupabase().from("cliente_historial").select("id, cliente_id, fecha, tipo, detalle").eq("cliente_id", cliente.id);
    if (fallo) setError(`No se pudo cargar el historial: ${fallo.message}`);
    else setNotas(data ?? []);
  }, [cliente.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function ejecutar(accion: () => Promise<void>) {
    setError("");
    setGuardando(true);
    try {
      await accion();
      await cargar();
      return true;
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const campos = new FormData(form);
    const guardada = await ejecutar(() => agregarNota({
      cliente_id: cliente.id,
      fecha: String(campos.get("fecha")),
      tipo: String(campos.get("tipo")),
      detalle: String(campos.get("detalle") ?? "").trim(),
    }));
    if (guardada) form.reset();
  }

  // Línea de tiempo: notas cargadas a mano + altas de contrato + partes diarios del cliente.
  const vehiculo = (id: unknown) => datos.vehiculos.find((v) => v.id === id)?.nombre ?? "";
  const eventos = [
    ...notas.map((n) => ({ clave: `n${n.id}`, fecha: n.fecha, tipo: n.tipo, detalle: n.detalle, nota: n, enlace: "" })),
    ...contratos.filter((c) => texto(c.created_at) || texto(c.fecha_inicio)).map((c) => ({
      clave: `c${c.id}`,
      fecha: (texto(c.fecha_inicio) || texto(c.created_at)).slice(0, 10),
      tipo: "Contrato",
      detalle: ["Alta de contrato", vehiculo(c.vehiculo_id), texto(c.modalidad)].filter(Boolean).join(" · "),
      nota: null,
      enlace: `/admin/contratos/${c.id}`,
    })),
    ...partes.filter((p) => p.cliente === texto(cliente.razon_social)).map((p) => ({
      clave: `p${p.id}`,
      fecha: p.fecha,
      tipo: "Parte diario",
      detalle: `Parte N° ${p.numero} · ${p.vehiculo} · ${p.tarea} · ${p.origen} → ${p.destino}`,
      nota: null,
      enlace: `/partes/${p.id}`,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return (
    <section className="panel">
      <h2 className="panel-header">Historial con el cliente</h2>
      <div className="panel-body">
        {error && <p className="error" role="alert">{error}</p>}
        {eventos.length === 0 ? <p className="vacio">Todavía no hay movimientos con este cliente.</p> : (
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Acciones</th></tr></thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.clave}>
                    <td>{formatFecha(e.fecha)}</td>
                    <td>{e.tipo}</td>
                    <td>{e.detalle}</td>
                    <td>
                      {e.enlace && <Link className="secondary enlace-boton" to={e.enlace}>Abrir</Link>}
                      {e.nota && (
                        <button type="button" className="secondary peligro" disabled={guardando} onClick={() => {
                          const nota = e.nota;
                          if (window.confirm("¿Eliminar esta nota del historial?")) void ejecutar(() => eliminarNota(nota.id));
                        }}>Eliminar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="panel-header">Agregar al historial</h2>
      <form className="panel-body" onSubmit={enviar}>
        <div className="form-grid compacto">
          <label>Fecha<input type="date" name="fecha" defaultValue={hoy()} required /></label>
          <label>Tipo
            <select name="tipo" defaultValue="Nota">{TIPOS_NOTA.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
        </div>
        <label>Detalle<textarea name="detalle" rows={2} required /></label>
        <div className="actions"><button type="submit" className="primary inline" disabled={guardando}>Agregar</button></div>
      </form>
    </section>
  );
}

/** Ficha de un cliente: facturación, contratos, certificaciones, certificados e historial. */
export function FichaCliente() {
  const { clienteId = "" } = useParams();
  const navigate = useNavigate();
  const { datos, error, refresh } = useComercial();
  const [aviso, setAviso] = useState("");
  const [estado, setEstado] = useState("");

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando cliente…</p>;

  const nuevo = clienteId === "nuevo";
  const cliente = nuevo ? null : datos.clientes.find((c) => c.id === clienteId) ?? null;
  if (!nuevo && !cliente) return <p className="estado">El cliente no existe. <Link to="/admin/clientes">Volver a clientes</Link></p>;

  const refs = referencias(datos);
  const contratos = cliente ? contratosDe(datos, cliente.id) : [];
  const estados = datos.columnas.contratos.find((c) => c.columna === "estado_contrato")?.opciones ?? [];

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin/clientes">← Clientes</Link>
        {cliente && <strong>{texto(cliente.razon_social)}</strong>}
      </p>

      <section className="panel">
        <h2 className="panel-header">{cliente ? "Datos de facturación" : "Nuevo cliente"}</h2>
        <div className="panel-body">
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <FormFila
            key={cliente?.id ?? "nuevo"}
            columnas={datos.columnas.clientes}
            fila={cliente}
            guardar={(valores) => guardarFila("clientes", cliente?.id ?? null, valores)}
            onGuardado={async (id) => {
              await refresh();
              setAviso(cliente ? "Cambios guardados." : "Cliente agregado.");
              if (!cliente) navigate(`/admin/clientes/${id}`, { replace: true });
            }}
            textoNuevo="Agregar cliente"
          />
        </div>
      </section>

      {cliente && (
        <>
          <section className="panel">
            <h2 className="panel-header panel-header-fila">
              Contratos
              <Link className="secondary enlace-boton" to={`/admin/contratos/nuevo?cliente=${cliente.id}`}>Nuevo contrato</Link>
            </h2>
            <div className="panel-body">
              <div className="form-grid compacto">
                <label>Estado
                  <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                    <option value="">Todos</option>
                    {estados.map((e) => <option key={e}>{e}</option>)}
                  </select>
                </label>
              </div>
              <TablaFilas
                columnas={datos.columnas.contratos}
                filas={contratos.filter((c) => !estado || texto(c.estado_contrato) === estado)}
                referencias={refs}
                ocultar={["cliente_id", "estado_contrato"]}
                enlace={(c) => `/admin/contratos/${c.id}`}
                extra={{ titulo: "Estado", celda: (c) => <ChipContrato contrato={c} /> }}
                vacio={contratos.length ? "No hay contratos en ese estado." : "Este cliente todavía no tiene contratos."}
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-header">Certificaciones mensuales</h2>
            <div className="panel-body">
              <TablaFilas
                columnas={datos.columnas.certificaciones}
                filas={certificacionesDe(datos, contratos)}
                referencias={refs}
                enlace={(c) => `/admin/certificaciones/${c.id}`}
                extra={{ titulo: "Importe y cobro", celda: (c) => <CeldaCobro datos={datos} certificacion={c} /> }}
                vacio="Todavía no hay certificaciones para los contratos de este cliente."
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-header panel-header-fila">
              Certificados y requisitos que exige
              <Link className="secondary enlace-boton" to="/admin/certificaciones?vista=certificados">Administrar</Link>
            </h2>
            <div className="panel-body">
              <TablaCertificados
                certificados={certificadosDe(datos, cliente.id, contratos)}
                vacio="No hay certificados asignados a este cliente ni a sus contratos."
              />
            </div>
          </section>

          <Historial datos={datos} cliente={cliente} contratos={contratos} />

          <ZonaEliminar
            titulo="Eliminar cliente"
            ayuda="Borra el cliente y su historial. Si tiene contratos, partes u otros registros asociados no se puede eliminar."
            confirmacion={`¿Eliminar a ${texto(cliente.razon_social)}? No se puede deshacer.`}
            eliminar={async () => {
              await eliminarFila("clientes", cliente.id);
              navigate("/admin/clientes");
            }}
          />
        </>
      )}
    </>
  );
}
