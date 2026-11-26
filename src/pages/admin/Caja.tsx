import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ZonaAnular } from "../../components/datos/FormFila";
import { ChipAnulado } from "../../components/ui/BotonAnular";
import { contiene, formatFecha } from "../../lib/registros";
import {
  CATEGORIAS, CIRCUITOS, TIPOS_MOVIMIENTO, TODAS_LAS_CATEGORIAS,
  anularMovimiento, descargarCsv, formatMonto, guardarMovimiento, hoyISO, mesActual, numeroMovimiento,
  porCategoria, totales, useCaja,
  type Circuito, type DatosCaja, type DatosMovimiento, type Movimiento, type Opcion, type TipoMovimiento,
} from "../../lib/caja";

function nombreDe(lista: Opcion[], id: string | null) {
  return id ? lista.find((o) => o.id === id)?.nombre ?? "—" : null;
}

function nombreMes(mes: string) {
  const [anio, numero] = mes.split("-").map(Number);
  if (!anio || !numero) return mes;
  return new Date(anio, numero - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function Monto({ movimiento }: { movimiento: Movimiento }) {
  const egreso = movimiento.tipo === "Egreso";
  return (
    <span className={`monto ${egreso ? "texto-alto" : movimiento.tipo === "Ingreso" ? "texto-ok" : ""}`}>
      {egreso ? "− " : movimiento.tipo === "Ingreso" ? "+ " : ""}{formatMonto(movimiento.monto)}
    </span>
  );
}

function Vinculos({ movimiento, datos }: { movimiento: Movimiento; datos: DatosCaja }) {
  const vehiculo = nombreDe(datos.vehiculos, movimiento.vehiculo_id);
  const cliente = nombreDe(datos.clientes, movimiento.cliente_id);
  const proveedor = nombreDe(datos.proveedores, movimiento.proveedor_id);
  if (!vehiculo && !cliente && !proveedor) return <>—</>;
  return (
    <span className="vinculos">
      {vehiculo && <span>Vehículo: <Link to={`/admin/flota/${movimiento.vehiculo_id}`}>{vehiculo}</Link></span>}
      {cliente && <span>Cliente: <Link to={`/admin/clientes/${movimiento.cliente_id}`}>{cliente}</Link></span>}
      {proveedor && <span>Proveedor: {proveedor}</span>}
    </span>
  );
}

/** Libro de caja: ingresos y egresos con filtros, totales y resumen por categoría. */
export default function Caja() {
  const { datos, error } = useCaja();
  const [mes, setMes] = useState(mesActual);
  const [tipo, setTipo] = useState("");
  const [circuito, setCircuito] = useState("");
  const [categoria, setCategoria] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando caja…</p>;

  function alternar(id: string) {
    setAbiertos((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  const textoBuscable = (m: Movimiento) => [
    m.concepto, m.comprobante, m.categoria, m.tipo, m.circuito, formatMonto(m.monto),
    nombreDe(datos.vehiculos, m.vehiculo_id), nombreDe(datos.clientes, m.cliente_id), nombreDe(datos.proveedores, m.proveedor_id),
  ].filter(Boolean).join(" ");

  const visibles = datos.movimientos.filter((m) =>
    (!mes || m.fecha.startsWith(mes)) &&
    (!tipo || m.tipo === tipo) &&
    (!circuito || m.circuito === circuito) &&
    (!categoria || m.categoria === categoria) &&
    contiene(textoBuscable(m), busqueda));

  const total = totales(visibles);
  const formal = totales(visibles.filter((m) => m.circuito === "Formal"));
  const informal = totales(visibles.filter((m) => m.circuito === "Informal"));
  const categorias = porCategoria(visibles);
  const periodo = mes ? nombreMes(mes) : "todos los períodos";
  const categoriasFiltro = tipo ? CATEGORIAS[tipo as TipoMovimiento] : TODAS_LAS_CATEGORIAS;
  const hayFiltrosExtra = Boolean(tipo || circuito || categoria || busqueda.trim());

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Período y filtros</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Mes
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </label>
            <label>Tipo
              <select value={tipo} onChange={(e) => { setTipo(e.target.value); setCategoria(""); }}>
                <option value="">Ingresos y egresos</option>
                {TIPOS_MOVIMIENTO.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>Circuito
              <select value={circuito} onChange={(e) => setCircuito(e.target.value)}>
                <option value="">Formal e informal</option>
                {CIRCUITOS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Categoría
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Todas</option>
                {categoriasFiltro.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Buscar
              <input placeholder="Concepto, comprobante, vehículo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
          </div>
          <div className="actions actions-inicio">
            {mes && <button type="button" className="text-button" onClick={() => setMes("")}>Ver todos los períodos</button>}
            {!mes && <button type="button" className="text-button" onClick={() => setMes(mesActual())}>Volver al mes actual</button>}
            {hayFiltrosExtra && (
              <button type="button" className="text-button" onClick={() => { setTipo(""); setCircuito(""); setCategoria(""); setBusqueda(""); }}>
                Quitar filtros
              </button>
            )}
          </div>
        </div>
      </section>

      <p className="caja-periodo">Resultado de <strong>{periodo}</strong>{hayFiltrosExtra ? " (con los filtros elegidos)" : ""}</p>
      <div className="stats stats-caja">
        <div className="stat stat-ok">
          <span className="stat-label">INGRESOS</span>
          <span className="stat-value">{formatMonto(total.ingresos)}</span>
        </div>
        <div className="stat stat-alto">
          <span className="stat-label">EGRESOS</span>
          <span className="stat-value">{formatMonto(total.egresos)}</span>
        </div>
        <div className="stat stat-total">
          <span className="stat-label">SALDO</span>
          <span className={`stat-value ${total.saldo < 0 ? "texto-alto" : ""}`}>{formatMonto(total.saldo)}</span>
        </div>
        {[{ nombre: "FORMAL", t: formal }, { nombre: "INFORMAL", t: informal }].map(({ nombre, t }) => (
          <div className="stat stat-info" key={nombre}>
            <span className="stat-label">SALDO {nombre}</span>
            <span className={`stat-value ${t.saldo < 0 ? "texto-alto" : ""}`}>{formatMonto(t.saldo)}</span>
            <small className="stat-detalle">+{formatMonto(t.ingresos)} · −{formatMonto(t.egresos)}</small>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-header panel-header-fila">
          <h2 className="panel-header-titulo">Movimientos</h2>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={visibles.length === 0}
              onClick={() => descargarCsv(visibles, datos, `caja-${mes || "completa"}.csv`)}
            >
              Descargar CSV
            </button>
            <Link className="primary inline enlace-boton" to="/admin/caja/nuevo">Registrar movimiento</Link>
          </div>
        </div>
        <div className="panel-body">
          <div className="table-wrap">
            <table className="tabla tabla-izquierda tabla-desplegable">
              <thead>
                <tr>
                  <th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Concepto</th><th>Vinculado a</th>
                  <th>Circuito</th><th>Comprobante</th><th>Monto</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => {
                  const abierto = abiertos.has(m.id);
                  return (
                    <tr key={m.id} className={[abierto && "is-open", m.anulacion && "fila-anulada"].filter(Boolean).join(" ") || undefined}>
                      <td>
                        <span className="solo-escritorio">{m.fecha ? formatFecha(m.fecha) : "—"}</span>
                        <button type="button" className="fila-toggle solo-movil" aria-expanded={abierto} onClick={() => alternar(m.id)}>
                          <span className="fila-toggle-texto">
                            <strong>{m.categoria ?? "Sin categoría"}</strong>
                            <small>{[m.fecha ? formatFecha(m.fecha) : null, m.concepto].filter(Boolean).join(" · ")}</small>
                          </span>
                          <Monto movimiento={m} />
                          <span className="fila-toggle-flecha" aria-hidden="true">▾</span>
                        </button>
                      </td>
                      <td><span className={`chip ${m.tipo === "Egreso" ? "vencido" : m.tipo === "Ingreso" ? "vigente" : "sin-datos"}`}>{m.tipo ?? "Sin tipo"}</span> <ChipAnulado anulacion={m.anulacion} /></td>
                      <td>{m.categoria ?? "—"}</td>
                      <td>{m.concepto ?? "—"}</td>
                      <td><Vinculos movimiento={m} datos={datos} /></td>
                      <td>{m.circuito ?? "—"}</td>
                      <td>{m.comprobante ?? "—"}</td>
                      <td className="celda-monto"><Monto movimiento={m} /></td>
                      <td><Link className="secondary enlace-boton" to={`/admin/caja/${m.id}`}>Editar</Link></td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={9} className="vacio">
                      {datos.movimientos.length ? `No hay movimientos en ${periodo} con estos filtros.` : "Todavía no hay movimientos cargados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="resultados">Cantidad de movimientos: {visibles.length} {numeroMovimientos(datos.movimientos.length, visibles.length)}</p>
        </div>
      </section>

      {categorias.length > 0 && (
        <section className="panel">
          <h2 className="panel-header">Por categoría</h2>
          <div className="panel-body">
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Categoría</th><th>Total</th><th>Tipo</th><th>Movimientos</th><th>Participación</th></tr></thead>
                <tbody>
                  {categorias.map((c) => (
                    <tr key={`${c.tipo}|${c.categoria}`}>
                      <td>{c.categoria}</td>
                      <td className={c.tipo === "Egreso" ? "texto-alto" : "texto-ok"}>{formatMonto(c.total)}</td>
                      <td>{c.tipo ?? "Sin tipo"}</td>
                      <td>{c.cantidad}</td>
                      <td>
                        <span className="participacion">
                          <span className="barra" aria-hidden="true">
                            <span className={c.tipo === "Egreso" ? "barra-egreso" : "barra-ingreso"} style={{ width: `${Math.min(100, c.porcentaje)}%` }} />
                          </span>
                          {c.porcentaje.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de los {c.tipo === "Egreso" ? "egresos" : "ingresos"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function numeroMovimientos(totalCargados: number, visibles: number) {
  return totalCargados !== visibles ? `(de ${totalCargados} en total)` : "";
}

// ---------- Alta y edición ----------

interface Valores {
  fecha: string;
  tipo: TipoMovimiento | "";
  categoria: string;
  monto: string;
  circuito: Circuito | "";
  concepto: string;
  comprobante: string;
  vehiculo_id: string;
  cliente_id: string;
  proveedor_id: string;
}

function valoresDe(m: Movimiento | null): Valores {
  return {
    fecha: m?.fecha || hoyISO(),
    tipo: m?.tipo ?? "",
    categoria: m?.categoria ?? "",
    monto: m ? String(m.monto) : "",
    circuito: m?.circuito ?? "",
    concepto: m?.concepto ?? "",
    comprobante: m?.comprobante ?? "",
    vehiculo_id: m?.vehiculo_id ?? "",
    cliente_id: m?.cliente_id ?? "",
    proveedor_id: m?.proveedor_id ?? "",
  };
}

function Segmento<T extends string>({ titulo, nombre, opciones, valor, onCambio }: {
  titulo: string;
  nombre: string;
  opciones: readonly T[];
  valor: T | "";
  onCambio: (valor: T) => void;
}) {
  return (
    <fieldset className="segmento">
      <legend>{titulo}</legend>
      <div className="segmento-opciones">
        {opciones.map((opcion) => (
          <label key={opcion} className={`segmento-opcion segmento-${opcion.toLowerCase()}${valor === opcion ? " is-active" : ""}`}>
            <input type="radio" name={nombre} value={opcion} checked={valor === opcion} onChange={() => onCambio(opcion)} required />
            {opcion}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FormMovimiento({ datos, movimiento, onGuardado }: {
  datos: DatosCaja;
  movimiento: Movimiento | null;
  onGuardado: (id: string, cargarOtro: boolean) => Promise<void>;
}) {
  const [valores, setValores] = useState(() => valoresDe(movimiento));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cambiar = <K extends keyof Valores>(campo: K, valor: Valores[K]) => setValores((actuales) => ({ ...actuales, [campo]: valor }));

  function cambiarTipo(tipo: TipoMovimiento) {
    setValores((actuales) => {
      const opciones = CATEGORIAS[tipo];
      const categoria = opciones.includes(actuales.categoria) ? actuales.categoria : opciones.length === 1 ? opciones[0] : "";
      return { ...actuales, tipo, categoria };
    });
  }

  const opcionesCategoria = valores.tipo ? CATEGORIAS[valores.tipo] : TODAS_LAS_CATEGORIAS;
  // Si el movimiento tenía una categoría fuera de la lista, se conserva como opción.
  const categorias = valores.categoria && !opcionesCategoria.includes(valores.categoria)
    ? [...opcionesCategoria, valores.categoria] : opcionesCategoria;

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cargarOtro = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-otro") === "si";
    setError("");
    const monto = Number(valores.monto.replace(",", "."));
    if (!valores.tipo || !valores.circuito) return setError("Elegí el tipo y el circuito del movimiento.");
    if (!Number.isFinite(monto) || monto <= 0) return setError("El monto tiene que ser mayor a cero.");

    const datosMovimiento: DatosMovimiento = {
      fecha: valores.fecha,
      tipo: valores.tipo,
      categoria: valores.categoria || null,
      monto: Math.round(monto * 100) / 100,
      circuito: valores.circuito,
      concepto: valores.concepto.trim() || null,
      comprobante: valores.comprobante.trim() || null,
      vehiculo_id: valores.vehiculo_id || null,
      cliente_id: valores.cliente_id || null,
      proveedor_id: valores.proveedor_id || null,
    };
    setGuardando(true);
    try {
      const id = await guardarMovimiento(movimiento?.id ?? null, datosMovimiento);
      if (cargarOtro) {
        // Se mantienen fecha, tipo y circuito para cargar rápido varios movimientos parecidos.
        setValores((actuales) => ({ ...valoresDe(null), fecha: actuales.fecha, tipo: actuales.tipo, circuito: actuales.circuito,
          categoria: actuales.tipo && CATEGORIAS[actuales.tipo].length === 1 ? CATEGORIAS[actuales.tipo][0] : "" }));
      }
      await onGuardado(id, cargarOtro);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el movimiento.");
    } finally {
      setGuardando(false);
    }
  }

  const selectVinculo = (campo: "vehiculo_id" | "cliente_id" | "proveedor_id", titulo: string, opciones: Opcion[]) => (
    <label>{titulo}
      <select value={valores[campo]} onChange={(e) => cambiar(campo, e.target.value)}>
        <option value="">Ninguno</option>
        {/* Los inactivos solo aparecen si este movimiento ya los tenía elegidos. */}
        {opciones.filter((o) => o.activo !== false || o.id === valores[campo]).map((o) => (
          <option key={o.id} value={o.id}>{o.nombre}{o.activo === false ? " (inactivo)" : ""}</option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={enviar}>
      <div className="form-grid">
        <Segmento titulo="Tipo" nombre="tipo" opciones={TIPOS_MOVIMIENTO} valor={valores.tipo} onCambio={cambiarTipo} />
        <Segmento titulo="Circuito" nombre="circuito" opciones={CIRCUITOS} valor={valores.circuito} onCambio={(c) => cambiar("circuito", c)} />
      </div>
      <div className="form-grid">
        <label>Fecha
          <input type="date" value={valores.fecha} onChange={(e) => cambiar("fecha", e.target.value)} required />
        </label>
        <label>Monto
          <input
            type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0,00"
            value={valores.monto} onChange={(e) => cambiar("monto", e.target.value)} required
          />
        </label>
        <label>Categoría
          <select value={valores.categoria} onChange={(e) => cambiar("categoria", e.target.value)} required>
            <option value="">{valores.tipo ? "Elegí una categoría" : "Primero elegí el tipo"}</option>
            {categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Comprobante <small>(opcional)</small>
          <input placeholder="N° de factura o recibo" value={valores.comprobante} onChange={(e) => cambiar("comprobante", e.target.value)} />
        </label>
      </div>
      <label>Concepto <small>(opcional)</small>
        <input placeholder="Detalle del movimiento" value={valores.concepto} onChange={(e) => cambiar("concepto", e.target.value)} />
      </label>

      <fieldset className="grupo">
        <legend>Vinculado a <small>(opcional)</small></legend>
        <div className="form-grid compacto">
          {selectVinculo("vehiculo_id", "Vehículo", datos.vehiculos)}
          {selectVinculo("cliente_id", "Cliente", datos.clientes)}
          {selectVinculo("proveedor_id", "Proveedor", datos.proveedores)}
        </div>
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {!movimiento && (
          <button type="submit" className="secondary" data-otro="si" disabled={guardando}>Registrar y cargar otro</button>
        )}
        <button type="submit" className="primary inline" disabled={guardando}>
          {guardando ? "Guardando…" : movimiento ? "Guardar cambios" : "Registrar movimiento"}
        </button>
      </div>
    </form>
  );
}

/** Alta ("nuevo") o edición de un movimiento de caja. */
export function FichaMovimiento() {
  const { movimientoId = "" } = useParams();
  const navigate = useNavigate();
  const { datos, error, refresh } = useCaja();
  const [aviso, setAviso] = useState("");

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando movimiento…</p>;

  const nuevo = movimientoId === "nuevo";
  const movimiento = nuevo ? null : datos.movimientos.find((m) => m.id === movimientoId) ?? null;
  if (!nuevo && !movimiento) return <p className="estado">El movimiento no existe. <Link to="/admin/caja">Volver a la caja</Link></p>;

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin/caja">← Caja y gastos</Link>
        {movimiento && <><strong>Movimiento {numeroMovimiento(movimiento.id)}</strong><Monto movimiento={movimiento} /></>}
      </p>

      <section className="panel panel-angosto">
        <h2 className="panel-header">{movimiento ? "Datos del movimiento" : "Nuevo movimiento"}</h2>
        <div className="panel-body">
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <FormMovimiento
            key={movimiento?.id ?? "nuevo"}
            datos={datos}
            movimiento={movimiento}
            onGuardado={async (_id, cargarOtro) => {
              await refresh();
              if (movimiento) setAviso("Cambios guardados.");
              else if (cargarOtro) setAviso("Movimiento registrado. Podés cargar el siguiente.");
              else navigate("/admin/caja");
            }}
          />
        </div>
      </section>

      {movimiento && (
        <div className="panel-angosto">
          <ZonaAnular
            titulo="Anular movimiento"
            ayuda="El movimiento queda en el libro marcado como anulado y deja de sumar en los totales."
            tipo="el movimiento"
            nombre={`${numeroMovimiento(movimiento.id)} · ${formatMonto(movimiento.monto)}`}
            anulacion={movimiento.anulacion}
            anular={async (motivo) => {
              await anularMovimiento(movimiento.id, motivo);
              await refresh();
            }}
          />
        </div>
      )}
    </>
  );
}
