import { useState, type ChangeEvent } from "react";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import {
  CAMPOS_STRIX, baseDeUnidad, convertirFilas, eliminarImportacion, formatHoras, importarRecorridos, leerCsv,
  mapeoInicial, recordarMapeo, revincularSinVehiculo, useStrix, vincularStrix,
  type BaseLiquidacion, type Mapeo, type ResultadoImportacion, type UnidadTiempo,
} from "../../lib/strix";
import { asignarFacturacionGerenciamiento, useGerenciamientos, type Gerenciamiento } from "../../lib/operaciones";
import {
  formatImporte, guardarFila, nombreContrato, texto, useComercial,
  type DatosComerciales, type Fila,
} from "../../lib/comercial";

function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

function ultimoDia(mes: string) {
  const [anio, numero] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(anio, numero, 0).getDate()).padStart(2, "0")}`;
}

const formatKm = (km: number | null) => (km === null ? "—" : `${km.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`);

const PESTAÑAS = [
  { clave: "importar", titulo: "Importar reporte" },
  { clave: "recorridos", titulo: "Recorridos" },
  { clave: "liquidacion", titulo: "Liquidación" },
] as const;
type Pestaña = (typeof PESTAÑAS)[number]["clave"];

export default function Strix() {
  const [pestaña, setPestaña] = useState<Pestaña>("importar");
  const [mes, setMes] = useState(mesActual);

  return (
    <>
      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Secciones de Strix">
          {PESTAÑAS.map((p) => (
            <button key={p.clave} type="button" role="tab" className="tab" aria-selected={pestaña === p.clave} onClick={() => setPestaña(p.clave)}>
              {p.titulo}
            </button>
          ))}
        </div>
      </div>
      {pestaña === "importar" && <Importar onImportado={(m) => { setMes(m); setPestaña("recorridos"); }} />}
      {pestaña === "recorridos" && <Recorridos mes={mes} setMes={setMes} />}
      {pestaña === "liquidacion" && <Liquidacion mes={mes} setMes={setMes} />}
    </>
  );
}

// ---------- Importar ----------

async function leerArchivo(archivo: File) {
  const bytes = await archivo.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Los CSV que guarda Excel en español suelen venir en Windows-1252.
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

function Importar({ onImportado }: { onImportado: (mes: string) => void }) {
  const [archivo, setArchivo] = useState<{ nombre: string; encabezados: string[]; filas: string[][] } | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [error, setError] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  async function elegir(event: ChangeEvent<HTMLInputElement>) {
    const elegido = event.target.files?.[0];
    setError("");
    setResultado(null);
    if (!elegido) return;
    if (/\.xlsx?$/i.test(elegido.name)) {
      setError("El archivo es de Excel. Abrilo en Excel y usá Archivo → Guardar como → CSV (delimitado por comas o punto y coma).");
      return;
    }
    const { encabezados, filas } = leerCsv(await leerArchivo(elegido));
    if (encabezados.length < 3 || filas.length === 0) {
      setError("No se encontraron columnas y filas en el archivo. Verificá que sea el CSV del reporte de recorridos.");
      return;
    }
    setArchivo({ nombre: elegido.name, encabezados, filas });
    setMapeo(mapeoInicial(encabezados));
  }

  const lectura = archivo && mapeo ? convertirFilas(archivo.encabezados, archivo.filas, mapeo) : null;
  const faltan = mapeo ? CAMPOS_STRIX.filter((c) => c.obligatorio && !mapeo.columnas[c.campo]) : [];

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
      // Se muestra el mes del primer recorrido importado.
      const primero = lectura.recorridos.map((x) => x.inicio).sort()[0];
      if (primero) window.setTimeout(() => onImportado(primero.slice(0, 7)), 2500);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo importar el reporte.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-header">Importar reporte de recorridos de Strix</h2>
      <div className="panel-body">
        <p className="ayuda">
          Exportá desde Strix el reporte de recorridos (viajes) del período, en CSV. Cada fila tiene que ser un recorrido con
          dominio, inicio, fin y kilómetros. Podés importar reportes que se superpongan: los recorridos repetidos se ignoran.
          Al importar, los recorridos se vinculan solos con los gerenciamientos del mismo vehículo y horario.
        </p>
        <label>Archivo CSV
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => void elegir(e)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {resultado && (
          <p className="exito" role="status">
            Listo: {resultado.nuevas} recorridos nuevos de {resultado.filas} leídos
            {resultado.filas > resultado.nuevas ? ` (${resultado.filas - resultado.nuevas} ya estaban cargados)` : ""}.
            {" "}{resultado.vinculados} gerenciamientos con datos de Strix en ese período.
            {resultado.sin_vehiculo > 0 && ` Atención: ${resultado.sin_vehiculo} recorridos son de dominios que no están en la flota.`}
          </p>
        )}

        {archivo && mapeo && lectura && (
          <>
            <h3 className="strix-subtitulo">Qué columna es cada dato</h3>
            <p className="ayuda">{archivo.nombre}: {archivo.filas.length} filas. La elección queda recordada para el próximo reporte.</p>
            <div className="form-grid compacto">
              {CAMPOS_STRIX.map((def) => (
                <label key={def.campo}>{def.titulo}{!def.obligatorio && <small> (opcional)</small>}
                  <select
                    value={mapeo.columnas[def.campo] ?? ""}
                    onChange={(e) => setMapeo({ ...mapeo, columnas: { ...mapeo.columnas, [def.campo]: e.target.value || undefined } })}
                    required={def.obligatorio}
                  >
                    <option value="">{def.obligatorio ? "Elegí la columna" : "No viene en el reporte"}</option>
                    {archivo.encabezados.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                  {def.ayuda && <small>{def.ayuda}</small>}
                </label>
              ))}
              <label>Formato de los tiempos
                <select value={mapeo.unidadTiempo} onChange={(e) => setMapeo({ ...mapeo, unidadTiempo: e.target.value as UnidadTiempo })}>
                  <option value="hhmm">hh:mm (o hh:mm:ss)</option>
                  <option value="minutos">Minutos</option>
                  <option value="horas">Horas con decimales</option>
                </select>
              </label>
            </div>

            {faltan.length > 0 ? (
              <p className="error">Falta indicar: {faltan.map((f) => f.titulo).join(", ")}.</p>
            ) : (
              <>
                <h3 className="strix-subtitulo">Vista previa</h3>
                <div className="table-wrap">
                  <table className="tabla tabla-izquierda">
                    <thead><tr><th>Dominio</th><th>Inicio</th><th>Fin</th><th>Km</th><th>Marcha</th><th>Ralentí</th><th>Vel. máx.</th></tr></thead>
                    <tbody>
                      {lectura.recorridos.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td>{r.dominio}</td>
                          <td>{formatFechaHora(r.inicio)}</td>
                          <td>{formatFechaHora(r.fin)}</td>
                          <td>{formatKm(r.km)}</td>
                          <td>{formatHoras(r.minutos_marcha === null ? null : r.minutos_marcha / 60)}</td>
                          <td>{formatHoras(r.minutos_ralenti === null ? null : r.minutos_ralenti / 60)}</td>
                          <td>{r.velocidad_maxima === null ? "—" : `${r.velocidad_maxima} km/h`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="resultados">
                  {lectura.recorridos.length} recorridos válidos
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
                    {importando ? "Importando…" : `Importar ${lectura.recorridos.length} recorridos`}
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

// ---------- Recorridos ----------

function SelectorMes({ mes, setMes }: { mes: string; setMes: (mes: string) => void }) {
  return (
    <div className="form-grid compacto">
      <label>Mes<input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>
    </div>
  );
}

function Recorridos({ mes, setMes }: { mes: string; setMes: (mes: string) => void }) {
  const { datos, error, refresh } = useStrix(mes);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [errorAccion, setErrorAccion] = useState("");

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
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!datos) return <p className="estado">Cargando recorridos…</p>;
  const sinVehiculo = datos.recorridos.filter((r) => !r.vehiculo_id);
  const dominiosSinVehiculo = [...new Set(sinVehiculo.map((r) => r.dominio))];

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Recorridos del mes</h2>
        <div className="panel-body">
          <SelectorMes mes={mes} setMes={setMes} />
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
              Dominios de Strix que no están en la flota: <strong>{dominiosSinVehiculo.join(", ")}</strong>. Sus recorridos no se
              vinculan con ningún gerenciamiento. Si el dominio está mal escrito en la flota, corregilo y tocá "Buscar de nuevo".
            </p>
          )}

          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead>
                <tr><th>Dominio</th><th>Inicio</th><th>Fin</th><th>Km</th><th>Marcha</th><th>Ralentí</th><th>Vel. máx.</th><th>Excesos</th><th>Origen → destino</th></tr>
              </thead>
              <tbody>
                {datos.recorridos.map((r) => (
                  <tr key={r.id}>
                    <td>{r.dominio}{!r.vehiculo_id && <> <span className="chip sin-datos">Fuera de flota</span></>}</td>
                    <td>{formatFechaHora(r.inicio)}</td>
                    <td>{formatFechaHora(r.fin)}</td>
                    <td>{formatKm(r.km)}</td>
                    <td>{formatHoras(r.minutos_marcha === null ? null : r.minutos_marcha / 60)}</td>
                    <td>{formatHoras(r.minutos_ralenti === null ? null : r.minutos_ralenti / 60)}</td>
                    <td>{r.velocidad_maxima === null ? "—" : `${r.velocidad_maxima} km/h`}</td>
                    <td className={r.excesos ? "texto-alto" : undefined}>{r.excesos ?? "—"}</td>
                    <td>{[r.origen, r.destino].filter(Boolean).join(" → ") || "—"}</td>
                  </tr>
                ))}
                {datos.recorridos.length === 0 && <tr><td colSpan={9} className="vacio">No hay recorridos de Strix en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="resultados">Recorridos: {datos.recorridos.length}{datos.recorridos.length === 1000 ? " (se muestran los últimos 1000)" : ""}</p>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Últimas importaciones</h2>
        <div className="panel-body">
          {datos.importaciones.length === 0 ? <p className="vacio">Todavía no se importó ningún reporte.</p> : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Archivo</th><th>Fecha</th><th>Filas</th><th>Nuevas</th><th>Fuera de flota</th><th>Acciones</th></tr></thead>
                <tbody>
                  {datos.importaciones.map((i) => (
                    <tr key={i.id}>
                      <td>{i.archivo}</td>
                      <td>{formatFechaHora(i.created_at)}</td>
                      <td>{i.filas}</td>
                      <td>{i.nuevas}</td>
                      <td>{i.sin_vehiculo}</td>
                      <td>
                        <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => {
                          if (!window.confirm(`¿Eliminar la importación "${i.archivo}" y sus ${i.nuevas} recorridos?`)) return;
                          void ejecutar(async () => {
                            await eliminarImportacion(i.id);
                            await vincularStrix(null, null);
                            return "Importación eliminada y vinculación recalculada.";
                          });
                        }}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
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

function Liquidacion({ mes, setMes }: { mes: string; setMes: (mes: string) => void }) {
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
        <GrupoContrato key={`${mes}-${g.contrato.id}`}grupo={g} datos={datos} mes={mes} tipoPeriodo={tipoPeriodo} onGuardado={refreshC} />
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

function GrupoContrato({ grupo, datos, mes, tipoPeriodo, onGuardado }: {
  grupo: Grupo;
  datos: DatosComerciales;
  mes: string;
  tipoPeriodo: string | undefined;
  onGuardado: () => Promise<void>;
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
          <div><dt>Horas en marcha</dt><dd>{formatHoras(grupo.horasMarcha)}</dd></div>
          <div><dt>Horas en ralentí / toma de fuerza</dt><dd>{formatHoras(grupo.horasRalenti)}</dd></div>
          <div><dt>Días con viaje</dt><dd>{grupo.dias}</dd></div>
          <div><dt>Tarifa unitaria</dt><dd>{contrato.tarifa_unitaria !== null && contrato.tarifa_unitaria !== undefined ? formatImporte(tarifa) : "—"}</dd></div>
        </dl>

        {(grupo.sinStrix > 0 || grupo.abiertos > 0) && (
          <p className="aviso-local">
            {grupo.sinStrix > 0 && `${grupo.sinStrix} ${grupo.sinStrix === 1 ? "viaje no tiene" : "viajes no tienen"} datos de Strix (importá el reporte o revisá el horario). `}
            {grupo.abiertos > 0 && `${grupo.abiertos} ${grupo.abiertos === 1 ? "viaje sigue abierto" : "viajes siguen abiertos"}.`}
          </p>
        )}

        <details className="strix-viajes">
          <summary>Ver los {grupo.viajes.length} viajes</summary>
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>ID</th><th>Salida</th><th>Llegada</th><th>Destino</th><th>Km declarados</th><th>Km Strix</th><th>Marcha</th><th>Ralentí</th><th>Excesos</th><th>Estado</th></tr></thead>
              <tbody>
                {grupo.viajes.map((v) => (
                  <tr key={v.id}>
                    <td>#{v.id}</td>
                    <td>{formatFecha(v.fechaSalida)} {v.horaSalida}</td>
                    <td>{formatFecha(v.fechaLlegada)} {v.horaLlegada}</td>
                    <td>{v.destino}</td>
                    <td>{formatKm(v.distanciaKm)}</td>
                    <td>{v.strix?.recorridos ? formatKm(v.strix.km) : <span className="texto-aviso">Sin datos</span>}</td>
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
