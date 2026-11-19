import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import { getSupabase } from "../../lib/supabase";
import {
  ArchivoNoSoportado, CAMPOS_STRIX, FUENTES, baseDeUnidad, cargarManual, convertirFilas, diaSiguiente, eliminarImportacion,
  eliminarRecorrido, faltantes, formatHoras, importarRecorridos, leerMinutos, leerNumero, leerReporte, mapeoInicial,
  recordarMapeo, registrosDelDia, revincularSinVehiculo, separarEncabezado, tipoReporte, ultimoDia, useStrix, vincularStrix,
  type BaseLiquidacion, type FuenteStrix, type Mapeo, type Recorrido, type ResultadoImportacion, type TipoReporte, type UnidadTiempo,
} from "../../lib/strix";
import { asignarFacturacionGerenciamiento, useGerenciamientos, type Gerenciamiento } from "../../lib/operaciones";
import {
  formatImporte, guardarFila, nombreContrato, texto, useComercial,
  type DatosComerciales, type Fila,
} from "../../lib/comercial";
import { DialogoEliminar, type PedidoEliminar } from "../../components/ui/DialogoEliminar";

const dos = (n: number) => String(n).padStart(2, "0");

function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}`;
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

const formatKm = (km: number | null) => (km === null ? "—" : `${km.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`);
const horasDe = (minutos: number | null) => formatHoras(minutos === null ? null : minutos / 60);

/** Minutos -> "h:mm" para editar. */
function aHhmm(minutos: number | null) {
  if (minutos === null) return "";
  const total = Math.round(minutos);
  return `${Math.floor(total / 60)}:${dos(total % 60)}`;
}

const CLASE_FUENTE: Record<FuenteStrix, string> = { archivo: "sin-datos", email: "sin-datos", api: "en-revision", manual: "por-vencer" };

function ChipFuente({ fuente }: { fuente: FuenteStrix }) {
  return <span className={`chip ${CLASE_FUENTE[fuente]}`}>{FUENTES[fuente]}</span>;
}

/** Fecha (registros diarios) u horario (recorridos) de un registro. */
function Periodo({ r }: { r: Pick<Recorrido, "granularidad" | "fecha" | "inicio" | "fin"> }) {
  if (r.granularidad === "dia" && r.fecha) return <>{formatFecha(r.fecha)} <small className="ayuda">día completo</small></>;
  return <>{formatFechaHora(r.inicio)}<br /><small className="ayuda">a {formatFechaHora(r.fin)}</small></>;
}

interface Vehiculo { id: string; dominio: string }

function useVehiculos() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  useEffect(() => {
    let activo = true;
    getSupabase().from("vehiculos").select("id, dominio").order("dominio").then(({ data }) => {
      if (activo) setVehiculos((data ?? []).map((v) => ({ id: String(v.id), dominio: String(v.dominio) })));
    });
    return () => { activo = false; };
  }, []);
  return vehiculos;
}

const PESTAÑAS = [
  { clave: "importar", titulo: "Importar reporte" },
  { clave: "manual", titulo: "Carga manual" },
  { clave: "datos", titulo: "Datos del mes" },
  { clave: "liquidacion", titulo: "Liquidación" },
] as const;
type Pestaña = (typeof PESTAÑAS)[number]["clave"];

/** Vehículo y día con los que se abre la carga manual (y el registro, si es para editarlo). */
export interface Precarga { vehiculoId: string; fecha: string; registro?: Recorrido }

export default function Strix() {
  const [pestaña, setPestaña] = useState<Pestaña>("importar");
  const [mes, setMes] = useState(mesActual);
  const [precarga, setPrecarga] = useState<Precarga | null>(null);

  function cargarAMano(vehiculoId: string, fecha: string, registro?: Recorrido) {
    setPrecarga({ vehiculoId, fecha, registro });
    setPestaña("manual");
  }

  return (
    <>
      <p className="aviso-local">
        Los datos de Strix entran importando el reporte exportado o cargándolos a mano. Cuando esté la conexión con la API de
        Strix, entrarán solos y estas dos opciones quedan como respaldo para cuando la API no responda.
      </p>
      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Secciones de Strix">
          {PESTAÑAS.map((p) => (
            <button key={p.clave} type="button" role="tab" className="tab" aria-selected={pestaña === p.clave} onClick={() => { setPrecarga(null); setPestaña(p.clave); }}>
              {p.titulo}
            </button>
          ))}
        </div>
      </div>
      {pestaña === "importar" && <Importar onImportado={(m) => { setMes(m); setPestaña("datos"); }} />}
      {pestaña === "manual" && <CargaManual mes={mes} setMes={setMes} precarga={precarga} />}
      {pestaña === "datos" && <DatosDelMes mes={mes} setMes={setMes} onCargarAMano={cargarAMano} />}
      {pestaña === "liquidacion" && <Liquidacion mes={mes} setMes={setMes} onCargarAMano={cargarAMano} />}
    </>
  );
}

type CargarAMano = (vehiculoId: string, fecha: string, registro?: Recorrido) => void;

// ---------- Importar ----------

interface ArchivoLeido { nombre: string; encabezados: string[]; filas: string[][]; filaEncabezado: number }

const TITULO_TIPO: Record<TipoReporte, string> = {
  dia: "Reporte diario por vehículo (como el «KMTS_RECORRIDOS» de Strix)",
  recorrido: "Reporte por recorrido (una fila por viaje, con inicio y fin)",
};

function Importar({ onImportado }: { onImportado: (mes: string) => void }) {
  const [archivo, setArchivo] = useState<ArchivoLeido | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [error, setError] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  async function elegir(event: ChangeEvent<HTMLInputElement>) {
    const elegido = event.target.files?.[0];
    setError("");
    setResultado(null);
    setArchivo(null);
    setMapeo(null);
    if (!elegido) return;
    setLeyendo(true);
    try {
      const { encabezados, filas, filaEncabezado } = separarEncabezado(await leerReporte(elegido));
      if (encabezados.length < 3 || filas.length === 0) {
        setError("No se encontraron columnas y filas en el archivo. Verificá que sea el reporte de Strix exportado en Excel o CSV.");
        return;
      }
      setArchivo({ nombre: elegido.name, encabezados, filas, filaEncabezado });
      setMapeo(mapeoInicial(encabezados));
    } catch (fallo) {
      setError(fallo instanceof ArchivoNoSoportado ? fallo.message : "No se pudo leer el archivo. Verificá que sea un Excel (.xlsx o .xls) o un CSV.");
    } finally {
      setLeyendo(false);
      event.target.value = "";
    }
  }

  const lectura = archivo && mapeo ? convertirFilas(archivo.encabezados, archivo.filas, mapeo, archivo.filaEncabezado) : null;
  const faltan = mapeo ? faltantes(mapeo) : [];
  const tipo = mapeo ? tipoReporte(mapeo) : null;
  const unidad = lectura?.tipo === "dia" ? "días" : "recorridos";

  async function importar() {
    if (!archivo || !mapeo || !lectura?.recorridos.length) return;
    setError("");
    setImportando(true);
    try {
      recordarMapeo(mapeo);
      const r = await importarRecorridos(archivo.nombre, lectura.recorridos);
      setResultado(r);
      setArchivo(null);
      setMapeo(null);
      // Se muestra el mes del primer registro importado.
      const primero = lectura.recorridos.map((x) => x.inicio).sort()[0];
      if (primero) window.setTimeout(() => onImportado(primero.slice(0, 7)), 3000);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo importar el reporte.");
    } finally {
      setImportando(false);
    }
  }

  const principales = CAMPOS_STRIX.filter((c) => ["dominio", "fecha", "inicio", "fin", "km", "contacto", "marcha", "ralenti"].includes(c.campo));
  const otros = CAMPOS_STRIX.filter((c) => !principales.includes(c));
  const selector = (def: (typeof CAMPOS_STRIX)[number]) => mapeo && archivo && (
    <label key={def.campo}>{def.titulo}{!def.obligatorio && <small> (opcional)</small>}
      <select
        value={mapeo.columnas[def.campo] ?? ""}
        onChange={(e) => setMapeo({ ...mapeo, columnas: { ...mapeo.columnas, [def.campo]: e.target.value || undefined } })}
      >
        <option value="">{def.obligatorio ? "Elegí la columna" : "No viene en el reporte"}</option>
        {archivo.encabezados.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>
      {def.ayuda && <small>{def.ayuda}</small>}
    </label>
  );

  return (
    <section className="panel">
      <h2 className="panel-header">Importar reporte de Strix</h2>
      <div className="panel-body">
        <p className="ayuda">
          Descargá desde Strix el reporte de kilómetros recorridos del período en <strong>Excel</strong> (o CSV) y subilo tal cual.
          Se aceptan el reporte diario por vehículo (una fila por vehículo y día) y el reporte por recorrido (una fila por viaje).
          Podés importar reportes que se superpongan: si un vehículo y día ya estaba cargado, se actualiza con el valor nuevo.
          Al importar, los datos se vinculan solos con los gerenciamientos del mismo vehículo y fecha.
        </p>
        <label>Archivo del reporte
          <input type="file" accept=".xlsx,.xls,.ods,.csv,.txt,.pdf" onChange={(e) => void elegir(e)} disabled={leyendo || importando} />
        </label>
        {leyendo && <p className="ayuda">Leyendo el archivo…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {resultado && (
          <p className="exito" role="status">
            Listo: {resultado.filas} filas leídas, {resultado.nuevas} nuevas
            {resultado.actualizadas > 0 && ` y ${resultado.actualizadas} actualizadas (ya estaban cargadas)`}.
            {" "}{resultado.vinculados} gerenciamientos tienen datos de Strix en ese período.
            {resultado.sin_vehiculo > 0 && ` Atención: ${resultado.sin_vehiculo} registros son de dominios que no están en la flota.`}
          </p>
        )}

        {archivo && mapeo && (
          <>
            <h3 className="strix-subtitulo">Qué columna es cada dato</h3>
            <p className="ayuda">
              {archivo.nombre}: {archivo.filas.length} filas. Las columnas se detectan solas; revisalas. La elección queda recordada.
            </p>
            {tipo && <p><span className="chip en-revision">{TITULO_TIPO[tipo]}</span></p>}
            <div className="form-grid compacto">
              {principales.map(selector)}
              <label>Formato de los tiempos <small>(si vienen como número)</small>
                <select value={mapeo.unidadTiempo} onChange={(e) => setMapeo({ ...mapeo, unidadTiempo: e.target.value as UnidadTiempo })}>
                  <option value="hhmm">Texto («2 h 5 m 13 s» o «2:05:13»)</option>
                  <option value="minutos">Minutos</option>
                  <option value="horas">Horas con decimales</option>
                </select>
              </label>
            </div>
            <details className="strix-errores">
              <summary>Más columnas (opcionales)</summary>
              <div className="form-grid compacto">{otros.map(selector)}</div>
            </details>

            {faltan.length > 0 || !lectura ? (
              <p className="error">Falta indicar: {faltan.join(", ")}.</p>
            ) : (
              <>
                <h3 className="strix-subtitulo">Vista previa</h3>
                <div className="table-wrap">
                  <table className="tabla tabla-izquierda">
                    <thead>
                      <tr>
                        <th>Dominio</th><th>{lectura.tipo === "dia" ? "Fecha" : "Horario"}</th><th>Km</th>
                        <th>En contacto</th><th>En movimiento</th><th>Detenido encendido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lectura.recorridos.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td>{r.dominio}</td>
                          <td><Periodo r={r} /></td>
                          <td>{formatKm(r.km)}</td>
                          <td>{horasDe(r.minutos_contacto)}</td>
                          <td>{horasDe(r.minutos_marcha)}</td>
                          <td>{horasDe(r.minutos_ralenti)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="resultados">
                  {lectura.recorridos.length} {unidad} válidos
                  {lectura.recorridos.length > 8 && " (se muestran los primeros 8)"}
                  {lectura.errores.length > 0 && `, ${lectura.errores.length} filas con problemas (no se importan)`}.
                </p>
                {lectura.errores.length > 0 && (
                  <details className="strix-errores">
                    <summary>Ver filas con problemas</summary>
                    <ul>{lectura.errores.slice(0, 30).map((e) => <li key={e.fila}>Fila {e.fila}: {e.motivo}</li>)}</ul>
                  </details>
                )}
                <div className="actions">
                  <button type="button" className="primary inline" disabled={importando || lectura.recorridos.length === 0} onClick={() => void importar()}>
                    {importando ? "Importando…" : `Importar ${lectura.recorridos.length} ${unidad}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ---------- Carga manual ----------

const CAMPOS_VACIOS = { km: "", marcha: "", ralenti: "" };

function SelectorMes({ mes, setMes }: { mes: string; setMes: (mes: string) => void }) {
  return (
    <div className="form-grid compacto">
      <label>Mes<input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>
    </div>
  );
}

function CargaManual({ mes, setMes, precarga }: { mes: string; setMes: (mes: string) => void; precarga: Precarga | null }) {
  const vehiculos = useVehiculos();
  const { datos, error, refresh } = useStrix(mes);
  const [vehiculoId, setVehiculoId] = useState(precarga?.vehiculoId ?? "");
  const [fecha, setFecha] = useState(precarga?.fecha ?? hoy());
  const [campos, setCampos] = useState(CAMPOS_VACIOS);
  const [observacion, setObservacion] = useState("API de Strix sin respuesta");
  const [existentes, setExistentes] = useState<Awaited<ReturnType<typeof registrosDelDia>> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [fallo, setFallo] = useState("");
  const [pedido, setPedido] = useState<PedidoEliminar | null>(null);

  useEffect(() => {
    if (!precarga) return;
    setVehiculoId(precarga.vehiculoId);
    setFecha(precarga.fecha);
    const r = precarga.registro;
    if (r) {
      setCampos({ km: r.km === null ? "" : String(r.km).replace(".", ","), marcha: aHhmm(r.minutos_marcha), ralenti: aHhmm(r.minutos_ralenti) });
      setObservacion(r.observacion ?? "");
    }
  }, [precarga]);

  // Lo que ya hay cargado de ese vehículo y día.
  useEffect(() => {
    setExistentes(null);
    if (!vehiculoId || !fecha) return;
    let activo = true;
    registrosDelDia(vehiculoId, fecha).then((r) => { if (activo) setExistentes(r); }).catch(() => { if (activo) setExistentes(null); });
    return () => { activo = false; };
  }, [vehiculoId, fecha, datos]);

  const km = leerNumero(campos.km);
  const marcha = campos.marcha.trim() ? leerMinutos(campos.marcha, "hhmm") : null;
  const ralenti = campos.ralenti.trim() ? leerMinutos(campos.ralenti, "hhmm") : null;
  const tiempoMal = (campos.marcha.trim() !== "" && marcha === null) || (campos.ralenti.trim() !== "" && ralenti === null);
  const totalMinutos = (marcha ?? 0) + (ralenti ?? 0);
  const diario = existentes?.find((r) => r.granularidad === "dia");
  const detallados = existentes?.filter((r) => r.granularidad === "recorrido") ?? [];
  const dominio = (id: string | null) => vehiculos?.find((v) => v.id === id)?.dominio ?? "—";
  const manuales = datos?.recorridos.filter((r) => r.fuente === "manual") ?? [];

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAviso("");
    setFallo("");
    if (km === null || km < 0) return setFallo("Indicá los kilómetros recorridos (0 o más).");
    if (tiempoMal) return setFallo("Escribí los tiempos como horas:minutos, por ejemplo 2:05, o como «2 h 5 m».");
    if (totalMinutos > 1440) return setFallo("Entre el tiempo en movimiento y el detenido no pueden superar las 24 horas del día.");
    setGuardando(true);
    try {
      const reemplazo = await cargarManual({ vehiculoId, fecha, km, minutosMarcha: marcha, minutosRalenti: ralenti, observacion });
      setAviso(`Guardado: ${dominio(vehiculoId)} · ${formatFecha(fecha)} · ${formatKm(km)}${reemplazo ? " (reemplazó el dato anterior)" : ""}.`);
      setCampos(CAMPOS_VACIOS);
      // Para cargar varios días seguidos del mismo vehículo.
      const siguiente = diaSiguiente(fecha);
      if (fecha.slice(0, 7) !== mes) setMes(fecha.slice(0, 7));
      if (siguiente <= hoy()) setFecha(siguiente);
      await refresh();
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  function editar(r: Recorrido) {
    if (!r.vehiculo_id || !r.fecha) return;
    setVehiculoId(r.vehiculo_id);
    setFecha(r.fecha);
    setCampos({ km: r.km === null ? "" : String(r.km).replace(".", ","), marcha: aHhmm(r.minutos_marcha), ralenti: aHhmm(r.minutos_ralenti) });
    setObservacion(r.observacion ?? "");
    setAviso("");
    setFallo("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function eliminar() {
    if (!pedido) return;
    setGuardando(true);
    try {
      await eliminarRecorrido(Number(pedido.id));
      setAviso(`Se eliminó el dato de ${pedido.nombre}.`);
      setPedido(null);
      await refresh();
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo eliminar.");
      setPedido(null);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Cargar datos de Strix a mano</h2>
        <form className="panel-body" onSubmit={(e) => void guardar(e)}>
          <p className="ayuda">
            Usala si la API de Strix no responde o no podés descargar el reporte. Cargá el total del día de cada vehículo, tal como lo
            muestra Strix. Si después importás el reporte de ese día, sus datos reemplazan a los cargados a mano.
          </p>
          <div className="form-grid">
            <label>Vehículo
              <select value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} required>
                <option value="">{vehiculos === null ? "Cargando…" : "Elegí el vehículo"}</option>
                {vehiculos?.map((v) => <option key={v.id} value={v.id}>{v.dominio}</option>)}
              </select>
            </label>
            <label>Fecha
              <input type="date" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} required />
            </label>
            <label>Kilómetros recorridos <small>(Distancia recorrida)</small>
              <input inputMode="decimal" value={campos.km} onChange={(e) => setCampos({ ...campos, km: e.target.value })} placeholder="Ej.: 53,74" required />
            </label>
            <label>Tiempo en movimiento <small>(h:mm)</small>
              <input value={campos.marcha} onChange={(e) => setCampos({ ...campos, marcha: e.target.value })} placeholder="Ej.: 6:31" />
            </label>
            <label>Detenido con motor encendido <small>(h:mm)</small>
              <input value={campos.ralenti} onChange={(e) => setCampos({ ...campos, ralenti: e.target.value })} placeholder="Ej.: 8:32" />
            </label>
            <label>Motivo / observación <small>(opcional)</small>
              <input value={observacion} onChange={(e) => setObservacion(e.target.value)} />
            </label>
          </div>
          {!tiempoMal && (marcha !== null || ralenti !== null) && (
            <p className="ayuda">Tiempo en contacto: {horasDe(totalMinutos)}.</p>
          )}
          {diario && (
            <p className="aviso-local">
              Ya hay un dato de ese día ({FUENTES[diario.fuente]}: {formatKm(diario.km)}). Si guardás, se reemplaza.
            </p>
          )}
          {detallados.length > 0 && (
            <p className="aviso-local">
              Ese día el vehículo ya tiene {detallados.length} recorridos detallados de Strix: el total diario se guarda, pero para
              los gerenciamientos se usan los recorridos detallados.
            </p>
          )}
          {fallo && <p className="error" role="alert">{fallo}</p>}
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <div className="actions">
            <button type="submit" className="primary inline" disabled={guardando || !vehiculoId}>
              {guardando ? "Guardando…" : diario ? "Reemplazar el dato del día" : "Guardar"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-header">Cargados a mano</h2>
        <div className="panel-body">
          <SelectorMes mes={mes} setMes={setMes} />
          {error && <p className="error" role="alert">{error}</p>}
          {!datos ? <p className="estado">Cargando…</p> : manuales.length === 0 ? <p className="vacio">No hay datos cargados a mano en este mes.</p> : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Dominio</th><th>Fecha</th><th>Km</th><th>En movimiento</th><th>Detenido encendido</th><th>Motivo</th><th>Gerenciamientos</th><th>Acciones</th></tr></thead>
                <tbody>
                  {manuales.map((r) => (
                    <tr key={r.id}>
                      <td>{r.dominio}</td>
                      <td>{r.fecha ? formatFecha(r.fecha) : "—"}</td>
                      <td>{formatKm(r.km)}</td>
                      <td>{horasDe(r.minutos_marcha)}</td>
                      <td>{horasDe(r.minutos_ralenti)}</td>
                      <td>{r.observacion ?? "—"}</td>
                      <td><CeldaGerenciamientos r={r} /></td>
                      <td className="celda-acciones">
                        <button type="button" className="secondary" onClick={() => editar(r)}>Editar</button>
                        <button type="button" className="secondary peligro" onClick={() => setPedido({
                          id: String(r.id), tipo: "el dato cargado a mano", nombre: `${r.dominio} · ${r.fecha ? formatFecha(r.fecha) : ""}`,
                          aviso: "Esta acción no se puede deshacer.",
                          consecuencias: [`Se quitan ${formatKm(r.km)} de los gerenciamientos de ese día y se recalculan.`],
                        })}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <DialogoEliminar pedido={pedido} ocupado={guardando} onCancelar={() => setPedido(null)} onEliminar={() => void eliminar()} />
    </>
  );
}

// ---------- Datos del mes ----------

function CeldaGerenciamientos({ r }: { r: Recorrido }) {
  if (r.gerenciamientos.length) return <>{r.gerenciamientos.map((id) => `#${id}`).join(", ")}</>;
  if (!r.vehiculo_id) return <span className="ayuda">Fuera de flota</span>;
  if ((r.km ?? 0) > 0) return <span className="chip por-vencer" title="El vehículo se movió y ningún gerenciamiento cubre ese día u horario.">Sin gerenciamiento</span>;
  return <span className="ayuda">—</span>;
}

interface Confirmacion { pedido: PedidoEliminar; accion: () => Promise<string> }

function DatosDelMes({ mes, setMes, onCargarAMano }: { mes: string; setMes: (mes: string) => void; onCargarAMano: CargarAMano }) {
  const { datos, error, refresh } = useStrix(mes);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [errorAccion, setErrorAccion] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "sin" | "manual">("todos");
  const [dominioFiltro, setDominioFiltro] = useState("");
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);

  async function ejecutar(accion: () => Promise<string>) {
    setAviso("");
    setErrorAccion("");
    setOcupado(true);
    try {
      setAviso(await accion());
      await refresh();
    } catch (fallo) {
      setErrorAccion(fallo instanceof Error ? fallo.message : "No se pudo completar la acción.");
    } finally {
      setOcupado(false);
      setConfirmacion(null);
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!datos) return <p className="estado">Cargando datos de Strix…</p>;

  const sinVehiculo = datos.recorridos.filter((r) => !r.vehiculo_id);
  const dominiosSinVehiculo = [...new Set(sinVehiculo.map((r) => r.dominio))];
  const sinGerenciamiento = datos.recorridos.filter((r) => r.vehiculo_id && !r.gerenciamientos.length && (r.km ?? 0) > 0);
  const dominios = [...new Set(datos.recorridos.map((r) => r.dominio))].sort();
  const visibles = datos.recorridos.filter((r) =>
    (!dominioFiltro || r.dominio === dominioFiltro) &&
    (filtro === "todos" || (filtro === "manual" ? r.fuente === "manual" : sinGerenciamiento.includes(r))));
  const hayDetalle = datos.recorridos.some((r) => r.velocidad_maxima !== null || r.excesos !== null || r.origen || r.destino);
  const kmTotal = datos.recorridos.reduce((t, r) => t + (r.km ?? 0), 0);
  const kmSinGerenciamiento = sinGerenciamiento.reduce((t, r) => t + (r.km ?? 0), 0);

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Datos de Strix del mes</h2>
        <div className="panel-body">
          <SelectorMes mes={mes} setMes={setMes} />
          <div className="stats">
            <div className="stat stat-total"><span className="stat-label">REGISTROS</span><span className="stat-value">{datos.recorridos.length}</span></div>
            <div className="stat stat-info"><span className="stat-label">KM DEL MES</span><span className="stat-value">{formatKm(kmTotal)}</span></div>
            <div className={`stat${sinGerenciamiento.length ? " stat-aviso" : " stat-ok"}`}>
              <span className="stat-label">SIN GERENCIAMIENTO</span>
              <span className="stat-value">{sinGerenciamiento.length}</span>
              {sinGerenciamiento.length > 0 && <span className="ayuda">{formatKm(kmSinGerenciamiento)}</span>}
            </div>
            <div className="stat"><span className="stat-label">CARGADOS A MANO</span><span className="stat-value">{datos.recorridos.filter((r) => r.fuente === "manual").length}</span></div>
          </div>

          {sinGerenciamiento.length > 0 && (
            <p className="aviso-local">
              Hay {sinGerenciamiento.length} registros en los que el vehículo se movió y ningún gerenciamiento cubre ese día u horario.
              Puede ser un viaje sin autorizar o un trabajo sin facturar: revisalos con el filtro «Sin gerenciamiento».
            </p>
          )}

          <div className="actions actions-inicio">
            <button type="button" className="secondary" disabled={ocupado} onClick={() => void ejecutar(async () => {
              const n = await vincularStrix(`${mes}-01`, ultimoDia(mes));
              return `Vinculación actualizada: ${n} gerenciamientos del mes tienen datos de Strix.`;
            })}>Volver a vincular con gerenciamientos</button>
            {sinVehiculo.length > 0 && (
              <button type="button" className="secondary" disabled={ocupado} onClick={() => void ejecutar(async () => {
                await revincularSinVehiculo();
                const n = await vincularStrix(`${mes}-01`, ultimoDia(mes));
                return `Se buscaron otra vez los dominios en la flota. ${n} gerenciamientos del mes tienen datos de Strix.`;
              })}>Buscar de nuevo los dominios en la flota</button>
            )}
          </div>
          {aviso && <p className="exito" role="status">{aviso}</p>}
          {errorAccion && <p className="error" role="alert">{errorAccion}</p>}
          {dominiosSinVehiculo.length > 0 && (
            <p className="aviso-local">
              Dominios de Strix que no están en la flota: <strong>{dominiosSinVehiculo.join(", ")}</strong>. Sus datos no se
              vinculan con ningún gerenciamiento. Si el dominio está mal escrito en la flota, corregilo y tocá «Buscar de nuevo».
            </p>
          )}

          <div className="form-grid compacto">
            <label>Mostrar
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
                <option value="todos">Todos</option>
                <option value="sin">Sin gerenciamiento</option>
                <option value="manual">Cargados a mano</option>
              </select>
            </label>
            <label>Vehículo
              <select value={dominioFiltro} onChange={(e) => setDominioFiltro(e.target.value)}>
                <option value="">Todos</option>
                {dominios.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead>
                <tr>
                  <th>Dominio</th><th>Fecha / horario</th><th>Km</th><th>En movimiento</th><th>Detenido encendido</th>
                  {hayDetalle && <><th>Vel. máx.</th><th>Excesos</th><th>Origen → destino</th></>}
                  <th>Fuente</th><th>Gerenciamientos</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={r.id}>
                    <td>{r.dominio}{!r.vehiculo_id && <> <span className="chip sin-datos">Fuera de flota</span></>}</td>
                    <td><Periodo r={r} /></td>
                    <td>{formatKm(r.km)}</td>
                    <td>{horasDe(r.minutos_marcha)}</td>
                    <td>{horasDe(r.minutos_ralenti)}</td>
                    {hayDetalle && (
                      <>
                        <td>{r.velocidad_maxima === null ? "—" : `${r.velocidad_maxima} km/h`}</td>
                        <td className={r.excesos ? "texto-alto" : undefined}>{r.excesos ?? "—"}</td>
                        <td>{[r.origen, r.destino].filter(Boolean).join(" → ") || "—"}</td>
                      </>
                    )}
                    <td><ChipFuente fuente={r.fuente} />{r.observacion && <><br /><small className="ayuda">{r.observacion}</small></>}</td>
                    <td><CeldaGerenciamientos r={r} /></td>
                    <td className="celda-acciones">
                      {r.fuente === "manual" && r.vehiculo_id && r.fecha && (
                        <button type="button" className="secondary" onClick={() => onCargarAMano(r.vehiculo_id!, r.fecha!, r)}>Editar</button>
                      )}
                      <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => setConfirmacion({
                        pedido: {
                          id: String(r.id), tipo: "el registro de Strix",
                          nombre: `${r.dominio} · ${r.fecha ? formatFecha(r.fecha) : formatFechaHora(r.inicio)}`,
                          aviso: "Esta acción no se puede deshacer.",
                          consecuencias: [`Se quitan ${formatKm(r.km)} de los gerenciamientos vinculados y se recalculan.`],
                        },
                        accion: async () => { await eliminarRecorrido(r.id); return "Registro eliminado y vinculación recalculada."; },
                      })}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={hayDetalle ? 11 : 8} className="vacio">
                    {datos.recorridos.length === 0 ? "No hay datos de Strix en este mes. Importá el reporte o cargalos a mano." : "Ningún registro coincide con el filtro."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="resultados">Registros: {visibles.length}{datos.recorridos.length === 3000 ? " (se muestran los últimos 3000 del mes)" : ""}</p>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Últimas importaciones</h2>
        <div className="panel-body">
          {datos.importaciones.length === 0 ? <p className="vacio">Todavía no se importó ningún reporte.</p> : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Archivo</th><th>Fecha</th><th>Filas</th><th>Nuevas</th><th>Actualizadas</th><th>Fuera de flota</th><th>Acciones</th></tr></thead>
                <tbody>
                  {datos.importaciones.map((i) => (
                    <tr key={i.id}>
                      <td>{i.archivo}</td>
                      <td>{formatFechaHora(i.created_at)}</td>
                      <td>{i.filas}</td>
                      <td>{i.nuevas}</td>
                      <td>{i.actualizadas ?? 0}</td>
                      <td>{i.sin_vehiculo}</td>
                      <td>
                        <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => setConfirmacion({
                          pedido: {
                            id: String(i.id), tipo: "la importación", nombre: i.archivo,
                            aviso: "Esta acción no se puede deshacer.",
                            consecuencias: [
                              "Se eliminan los datos de Strix que trajo este archivo (los que después se actualizaron con otro reporte o a mano se conservan).",
                              "Los gerenciamientos se recalculan.",
                            ],
                          },
                          accion: async () => {
                            await eliminarImportacion(i.id);
                            await vincularStrix(null, null);
                            return "Importación eliminada y vinculación recalculada.";
                          },
                        })}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <DialogoEliminar
        pedido={confirmacion?.pedido ?? null}
        ocupado={ocupado}
        onCancelar={() => setConfirmacion(null)}
        onEliminar={() => confirmacion && void ejecutar(confirmacion.accion)}
      />
    </>
  );
}

// ---------- Liquidación ----------

interface Grupo {
  contrato: Fila;
  viajes: Gerenciamiento[];
  base: BaseLiquidacion;
  kmStrix: number;
  kmDeclarados: number;
  horasMarcha: number;
  horasRalenti: number;
  dias: number;
  sinStrix: number;
  abiertos: number;
  conDiarios: number;
  compartidos: number;
  manuales: number;
}

/** Días calendario que abarca cada viaje (sin repetir días entre viajes). */
function diasDe(viajes: Gerenciamiento[]) {
  const dias = new Set<string>();
  for (const v of viajes) {
    const d = new Date(`${v.fechaSalida}T12:00:00`);
    const fin = new Date(`${v.fechaLlegada}T12:00:00`);
    for (let i = 0; d <= fin && i < 62; i++, d.setDate(d.getDate() + 1)) dias.add(d.toISOString().slice(0, 10));
  }
  return dias.size;
}

function agrupar(viajes: Gerenciamiento[], datos: DatosComerciales): Grupo[] {
  const porContrato = new Map<string, Gerenciamiento[]>();
  for (const v of viajes) {
    if (!v.contratoId) continue;
    porContrato.set(v.contratoId, [...(porContrato.get(v.contratoId) ?? []), v]);
  }
  return [...porContrato.entries()].flatMap(([contratoId, lista]) => {
    const contrato = datos.contratos.find((c) => c.id === contratoId);
    if (!contrato) return [];
    const suma = (f: (v: Gerenciamiento) => number | null | undefined) => lista.reduce((t, v) => t + (f(v) ?? 0), 0);
    return [{
      contrato,
      viajes: lista,
      base: baseDeUnidad(texto(contrato.unidad_medida)),
      kmStrix: suma((v) => v.strix?.km),
      kmDeclarados: suma((v) => v.distanciaKm),
      horasMarcha: suma((v) => v.strix?.horasMarcha),
      horasRalenti: suma((v) => v.strix?.horasRalenti),
      dias: diasDe(lista),
      sinStrix: lista.filter((v) => !v.strix?.recorridos).length,
      abiertos: lista.filter((v) => v.estado === "abierto").length,
      conDiarios: lista.filter((v) => (v.strix?.dias ?? 0) > 0).length,
      compartidos: lista.filter((v) => (v.strix?.compartidos ?? 0) > 0).length,
      manuales: lista.filter((v) => (v.strix?.manuales ?? 0) > 0).length,
    }];
  });
}

/** Cantidad propuesta según la unidad del contrato. Para horas de equipo (hidrogrúa / barquilla) se usa el ralentí (toma de fuerza). */
function cantidadSugerida(g: Grupo) {
  const unidad = texto(g.contrato.unidad_medida).toLocaleLowerCase("es");
  switch (g.base) {
    case "km": return Math.round(g.kmStrix * 10) / 10;
    case "horas": return Math.round((/gr[uú]a|hidro|barquilla|equipo/.test(unidad) ? g.horasRalenti : g.horasMarcha) * 100) / 100;
    case "dias": return g.dias;
    case "mes": return 1;
    default: return null;
  }
}


function Liquidacion({ mes, setMes, onCargarAMano }: { mes: string; setMes: (mes: string) => void; onCargarAMano: CargarAMano }) {
  const { filas: gerenciamientos, error: errorG, refresh: refreshG } = useGerenciamientos();
  const { datos, error: errorC, refresh: refreshC } = useComercial();

  if (errorG || errorC) return <p className="error" role="alert">{errorG || errorC}</p>;
  if (!gerenciamientos || !datos) return <p className="estado">Cargando liquidación…</p>;

  const delMes = gerenciamientos.filter((g) => g.fechaSalida.startsWith(mes) && g.autorizacion === "autorizado");
  const grupos = agrupar(delMes, datos);
  const sinContrato = delMes.filter((g) => !g.contratoId || !datos.contratos.some((c) => c.id === g.contratoId));
  const tipoPeriodo = datos.columnas.certificaciones.find((c) => c.columna === "periodo")?.tipo;

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Liquidación por contrato</h2>
        <div className="panel-body">
          <SelectorMes mes={mes} setMes={setMes} />
          <p className="ayuda">
            Se toman los gerenciamientos autorizados que salieron en el mes, agrupados por contrato. La cantidad se propone según la
            unidad de medida del contrato (km, horas o días) con los datos de Strix; revisala y pasala a la certificación mensual.
          </p>
        </div>
      </section>

      {grupos.length === 0 && (
        <section className="panel"><div className="panel-body"><p className="vacio">No hay gerenciamientos autorizados con contrato en este mes.</p></div></section>
      )}
      {grupos.map((g) => (
        <GrupoContrato key={`${mes}-${g.contrato.id}`} grupo={g} datos={datos} mes={mes} tipoPeriodo={tipoPeriodo} onGuardado={refreshC} onCargarAMano={onCargarAMano} />
      ))}

      {sinContrato.length > 0 && (
        <section className="panel">
          <h2 className="panel-header">Viajes del mes sin contrato ({sinContrato.length})</h2>
          <div className="panel-body">
            <p className="ayuda">No entran en la liquidación. Si alguno se tiene que cobrar, asignale vehículo y contrato.</p>
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>ID</th><th>Salida</th><th>Vehículo</th><th>Destino</th><th>Km Strix</th><th>Asignar</th></tr></thead>
                <tbody>
                  {sinContrato.map((g) => (
                    <tr key={g.id}>
                      <td>#{g.id}</td>
                      <td>{formatFecha(g.fechaSalida)} {g.horaSalida}</td>
                      <td>{g.vehiculo}{!g.vehiculoId && <> <span className="chip sin-datos">Fuera de flota</span></>}</td>
                      <td>{g.destino}</td>
                      <td>{formatKm(g.strix?.km ?? null)}</td>
                      <td><AsignarContrato gerenciamiento={g} datos={datos} onGuardado={async () => { await refreshG(); }} /></td>
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

/** Km de Strix de un viaje, con el origen de los datos. */
function CeldaKmStrix({ viaje, onCargarAMano }: { viaje: Gerenciamiento; onCargarAMano: CargarAMano }) {
  const s = viaje.strix;
  if (!s?.recorridos) {
    return (
      <>
        <span className="texto-aviso">Sin datos</span>
        {viaje.vehiculoId && (
          <><br /><button type="button" className="text-button" onClick={() => onCargarAMano(viaje.vehiculoId!, viaje.fechaSalida)}>Cargar a mano</button></>
        )}
      </>
    );
  }
  const etiquetas = [s.dias > 0 && "diario", s.compartidos > 0 && "compartido", s.manuales > 0 && "manual"].filter(Boolean);
  return <>{formatKm(s.km)}{etiquetas.length > 0 && <><br /><small className="ayuda">{etiquetas.join(" · ")}</small></>}</>;
}

function GrupoContrato({ grupo, datos, mes, tipoPeriodo, onGuardado, onCargarAMano }: {
  grupo: Grupo;
  datos: DatosComerciales;
  mes: string;
  tipoPeriodo: string | undefined;
  onGuardado: () => Promise<void>;
  onCargarAMano: CargarAMano;
}) {
  const sugerida = cantidadSugerida(grupo);
  const [cantidad, setCantidad] = useState(sugerida === null ? "" : String(sugerida));
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  const { contrato } = grupo;
  const existente = datos.certificaciones.find((c) =>
    texto(c.contrato_id) === contrato.id && texto(c.periodo).slice(0, 7) === mes);
  const tarifa = Number(contrato.tarifa_unitaria);
  const cantidadNumero = Number(cantidad.replace(",", "."));
  const importe = cantidad && Number.isFinite(cantidadNumero) && contrato.tarifa_unitaria !== null && Number.isFinite(tarifa)
    ? cantidadNumero * tarifa : null;
  const esInfoauto = contrato.porcentaje_infoauto !== null && contrato.porcentaje_infoauto !== undefined && texto(contrato.porcentaje_infoauto) !== "";
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  async function pasar() {
    if (!cantidad || !Number.isFinite(cantidadNumero)) return setError("Indicá la cantidad a certificar.");
    setError("");
    setAviso("");
    setGuardando(true);
    try {
      const periodo = tipoPeriodo === "fecha" ? `${mes}-01` : mes;
      await guardarFila("certificaciones", existente?.id ?? null,
        existente ? { cantidad: cantidadNumero } : { contrato_id: contrato.id, periodo, cantidad: cantidadNumero });
      await onGuardado();
      setAviso(existente ? "Certificación actualizada." : "Certificación creada. Completá el resto de los datos en Certificaciones.");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar la certificación.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-header">{nombreContrato(datos, contrato)}</h2>
      <div className="panel-body">
        <dl className="detalle">
          <div><dt>Unidad de medida</dt><dd>{texto(contrato.unidad_medida) || "Sin definir"}</dd></div>
          <div><dt>Viajes</dt><dd>{grupo.viajes.length}</dd></div>
          <div><dt>Km Strix</dt><dd>{formatKm(grupo.kmStrix)}</dd></div>
          <div><dt>Km declarados</dt><dd>{formatKm(grupo.kmDeclarados)}</dd></div>
          <div><dt>Horas en movimiento</dt><dd>{formatHoras(grupo.horasMarcha)}</dd></div>
          <div><dt>Horas detenido encendido / toma de fuerza</dt><dd>{formatHoras(grupo.horasRalenti)}</dd></div>
          <div><dt>Días con viaje</dt><dd>{grupo.dias}</dd></div>
          <div><dt>Tarifa unitaria</dt><dd>{contrato.tarifa_unitaria !== null && contrato.tarifa_unitaria !== undefined ? formatImporte(tarifa) : "—"}</dd></div>
        </dl>

        {(grupo.sinStrix > 0 || grupo.abiertos > 0) && (
          <p className="aviso-local">
            {grupo.sinStrix > 0 && `${plural(grupo.sinStrix, "viaje no tiene", "viajes no tienen")} datos de Strix: importá el reporte o cargalos a mano. `}
            {grupo.abiertos > 0 && `${plural(grupo.abiertos, "viaje sigue abierto", "viajes siguen abiertos")}.`}
          </p>
        )}
        {(grupo.conDiarios > 0 || grupo.compartidos > 0 || grupo.manuales > 0) && (
          <ul className="ayuda strix-notas">
            {grupo.conDiarios > 0 && (
              <li>{plural(grupo.conDiarios, "viaje usa", "viajes usan")} el total diario de Strix: incluye todo lo que el vehículo recorrió esos días, también fuera del horario del viaje.</li>
            )}
            {grupo.compartidos > 0 && (
              <li>{plural(grupo.compartidos, "viaje comparte", "viajes comparten")} días con otros viajes del mismo vehículo: los km de esos días se reparten según las horas de cada viaje.</li>
            )}
            {grupo.manuales > 0 && <li>{plural(grupo.manuales, "viaje incluye", "viajes incluyen")} datos cargados a mano.</li>}
          </ul>
        )}

        <details className="strix-viajes">
          <summary>Ver los {grupo.viajes.length} viajes</summary>
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>ID</th><th>Salida</th><th>Llegada</th><th>Destino</th><th>Km declarados</th><th>Km Strix</th><th>En movimiento</th><th>Detenido encendido</th><th>Excesos</th><th>Estado</th></tr></thead>
              <tbody>
                {grupo.viajes.map((v) => (
                  <tr key={v.id}>
                    <td>#{v.id}</td>
                    <td>{formatFecha(v.fechaSalida)} {v.horaSalida}</td>
                    <td>{formatFecha(v.fechaLlegada)} {v.horaLlegada}</td>
                    <td>{v.destino}</td>
                    <td>{formatKm(v.distanciaKm)}</td>
                    <td><CeldaKmStrix viaje={v} onCargarAMano={onCargarAMano} /></td>
                    <td>{formatHoras(v.strix?.horasMarcha ?? null)}</td>
                    <td>{formatHoras(v.strix?.horasRalenti ?? null)}</td>
                    <td className={v.strix?.excesos ? "texto-alto" : undefined}>{v.strix?.excesos ?? "—"}</td>
                    <td>{v.estado === "cerrado" ? "Cerrado" : "Abierto"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="form-grid compacto strix-pase">
          <label>Cantidad a certificar <small>({texto(contrato.unidad_medida) || "unidades"})</small>
            <input type="number" min="0" step="any" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            {sugerida !== null && Number(cantidad) !== sugerida && (
              <button type="button" className="text-button" onClick={() => setCantidad(String(sugerida))}>Usar la sugerida ({sugerida})</button>
            )}
          </label>
          <div>
            <p className="strix-importe-titulo">Importe estimado</p>
            <p className="strix-importe">{esInfoauto ? "Según valor Infoauto del mes" : importe === null ? "Sin tarifa" : formatImporte(importe)}</p>
          </div>
        </div>
        {existente && <p className="ayuda">Ya hay una certificación de este contrato para el mes, con cantidad {texto(existente.cantidad) || "sin cargar"}.</p>}
        {aviso && <p className="exito" role="status">{aviso}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="primary inline" disabled={guardando} onClick={() => void pasar()}>
            {guardando ? "Guardando…" : existente ? "Actualizar la certificación del mes" : "Crear certificación del mes"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AsignarContrato({ gerenciamiento, datos, onGuardado }: {
  gerenciamiento: Gerenciamiento;
  datos: DatosComerciales;
  onGuardado: () => Promise<void>;
}) {
  const [vehiculoId, setVehiculoId] = useState(gerenciamiento.vehiculoId ?? "");
  const [contratoId, setContratoId] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const contratos = datos.contratos.filter((c) =>
    c.vigente !== false && (!c.vehiculo_id || !vehiculoId || texto(c.vehiculo_id) === vehiculoId));

  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      await asignarFacturacionGerenciamiento(gerenciamiento.id, vehiculoId || null, null, contratoId || null);
      await onGuardado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo asignar.");
      setGuardando(false);
    }
  }

  return (
    <div className="strix-asignar">
      <select className="select-tabla" value={vehiculoId} onChange={(e) => { setVehiculoId(e.target.value); setContratoId(""); }} aria-label="Vehículo">
        <option value="">Vehículo…</option>
        {datos.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
      </select>
      <select className="select-tabla" value={contratoId} onChange={(e) => setContratoId(e.target.value)} aria-label="Contrato">
        <option value="">Contrato…</option>
        {contratos.map((c) => <option key={c.id} value={c.id}>{nombreContrato(datos, c)}</option>)}
      </select>
      <button type="button" className="secondary" disabled={guardando || !vehiculoId || !contratoId} onClick={() => void guardar()}>
        {guardando ? "Guardando…" : "Asignar"}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
