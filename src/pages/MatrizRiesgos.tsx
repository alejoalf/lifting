import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { DialogoEliminar, type PedidoEliminar } from "../components/ui/DialogoEliminar";
import {
  CATEGORIAS_PELIGRO, DATOS_VIEJOS_MS, ESTADOS, NIVELES, TIPOS_EQUIPO, TIPOS_TRAMO,
  buscarLugar, descripcionClima, direccionCardinal, evaluarEquipo, guardarFila, hayTormenta,
  medidasObligatorias, nivelRiesgo, peligrosAplicables, useClima, useMatrizRiesgos, useUbicacionActual,
  type CategoriaPeligro, type Clima, type CondicionViento, type Equipo, type EstadoOperacion, type Lugar,
  type Matriz, type Medida, type Peligro, type PuntoClima, type TablaRiesgo, type TipoEquipo, type TipoTramo,
  type Tramo, type Ubicacion,
} from "../lib/matrizRiesgos";

const kmh = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)} km/h`);
const texto = (v: string) => v.trim() || null;
const numero = (v: string) => (v.trim() === "" ? null : Number(v));
const GPS = "gps";

function ChipEstado({ estado }: { estado: EstadoOperacion }) {
  return <span className={`chip riesgo-${estado}`}>{ESTADOS[estado]}</span>;
}

function ChipNivel({ peligro }: { peligro: Pick<Peligro, "severidad" | "probabilidad"> }) {
  const nivel = nivelRiesgo(peligro);
  return <span className={`chip nivel-${nivel}`}>{NIVELES[nivel]} · {peligro.severidad * peligro.probabilidad}</span>;
}

function hora(fecha: Date | number) {
  return new Date(fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function visibilidad(metros: number) {
  return metros >= 1000 ? `${(metros / 1000).toFixed(metros >= 10000 ? 0 : 1)} km` : `${Math.round(metros)} m`;
}

/** Ficha con todos los datos reales del clima en un punto. */
function TarjetaClima({ titulo, subtitulo, clima }: { titulo: string; subtitulo?: string; clima: Clima | undefined }) {
  return (
    <article className={`clima-card${clima && hayTormenta(clima) ? " clima-tormenta" : ""}`}>
      <header>
        <strong>{titulo}</strong>
        {subtitulo && <small className="ayuda">{subtitulo}</small>}
      </header>
      {!clima ? <p className="vacio">Sin datos del clima.</p> : (
        <>
          <p className="clima-principal">
            <span className="clima-temp">{Math.round(clima.temperatura)}°C</span>
            <span>{descripcionClima(clima.codigo)}<br /><small className="ayuda">Sensación {Math.round(clima.sensacion)}°C</small></span>
          </p>
          <dl className="clima-datos">
            <div><dt>Viento 10 m</dt><dd>{kmh(clima.viento10)} {direccionCardinal(clima.direccion)}</dd></div>
            <div><dt>Ráfagas</dt><dd>{kmh(clima.rafaga)}</dd></div>
            <div><dt>Viento 80 m</dt><dd>{kmh(clima.viento80)}</dd></div>
            <div><dt>Viento 120 m</dt><dd>{kmh(clima.viento120)}</dd></div>
            <div><dt>Humedad</dt><dd>{Math.round(clima.humedad)} %</dd></div>
            <div><dt>Visibilidad</dt><dd>{visibilidad(clima.visibilidad)}</dd></div>
            <div><dt>Precipitación</dt><dd>{clima.precipitacion.toFixed(1)} mm</dd></div>
            <div><dt>Presión</dt><dd>{Math.round(clima.presion)} hPa</dd></div>
          </dl>
          <small className="ayuda">Datos de las {hora(clima.momento)} h · {Math.round(clima.elevacion)} m s. n. m.</small>
        </>
      )}
    </article>
  );
}

function CeldaEquipo({ equipo, clima, lineas }: { equipo: Equipo; clima: Clima | undefined; lineas: boolean }) {
  const ev = evaluarEquipo(equipo, clima);
  return (
    <td title={ev.motivos.join(" · ") || undefined}>
      <ChipEstado estado={ev.estado} />
      {ev.viento !== null && <><br /><small className="ayuda">{kmh(ev.viento)} a {equipo.altura_trabajo_m} m · ráf. {kmh(ev.rafaga)}</small></>}
      {ev.motivos.length > 0 && <><br /><small className="texto-alto">{ev.motivos.join(" · ")}</small></>}
      {lineas && equipo.riesgo_electrico && <><br /><small className="texto-aviso">⚡ Líneas: mín. {equipo.distancia_lineas_m ?? "—"} m</small></>}
    </td>
  );
}

/** Matriz de riesgos: visible para todos, editable solo por un Admin. */
export default function MatrizRiesgos() {
  const { operador } = useAuth();
  const esAdmin = operador?.rol === "admin";
  const { datos, error } = useMatrizRiesgos();
  const gps = useUbicacionActual();
  const tramosActivos = datos?.tramos.filter((t) => t.activo) ?? [];
  const puntos: PuntoClima[] = [
    ...(gps.ubicacion ? [{ id: GPS, latitud: gps.ubicacion.latitud, longitud: gps.ubicacion.longitud }] : []),
    ...tramosActivos.flatMap((t) => (t.latitud !== null && t.longitud !== null ? [{ id: t.id, latitud: t.latitud, longitud: t.longitud }] : [])),
  ];
  const clima = useClima(puntos);
  const datosViejos = clima.datosDe !== null && Date.now() - clima.datosDe.getTime() > DATOS_VIEJOS_MS;

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando…</p>;

  const equiposActivos = datos.equipos.filter((e) => e.activo);
  const filas = [
    ...(gps.ubicacion ? [{ id: GPS, nombre: "Mi ubicación actual", detalle: coordenadas(gps.ubicacion), lineas: false }] : []),
    ...tramosActivos.map((t) => ({
      id: t.id, nombre: t.nombre, lineas: t.lineas_electricas,
      detalle: t.latitud === null ? "Sin coordenadas: cargalas para ver el clima" : TIPOS_TRAMO[t.tipo],
    })),
  ];

  return (
    <div className="matriz-riesgos">
      {error && <p className="error" role="alert">{error}</p>}

      <Evaluacion matriz={datos} tramos={tramosActivos} equipos={equiposActivos} clima={clima.clima} gps={gps} />

      <section className="panel">
        <div className="panel-header panel-header-fila">
          <span>Clima actual</span>
          <span className="matriz-actualizacion">
            {!gps.ubicacion && (
              <button type="button" className="secondary" onClick={gps.pedir} disabled={gps.buscando}>
                {gps.buscando ? "Ubicando…" : "Usar mi ubicación"}
              </button>
            )}
            <button type="button" className="secondary" onClick={() => void clima.actualizar()} disabled={clima.cargando}>
              {clima.cargando ? "Consultando…" : "Actualizar ahora"}
            </button>
          </span>
        </div>
        <div className="panel-body">
          <p className="clima-estado">
            {clima.datosDe ? <>Datos de las <strong>{hora(clima.datosDe)}</strong></> : clima.cargando ? "Consultando el clima…" : "Todavía no hay datos del clima."}
            {clima.consultado && <> · consultado a las {hora(clima.consultado)}</>}
            {clima.proxima && <> · próxima actualización automática: <strong>{hora(clima.proxima)}</strong></>}
          </p>
          {datosViejos && (
            <p className="error" role="alert">
              Los datos del clima tienen más de {DATOS_VIEJOS_MS / 60000} minutos: no los uses para decidir y verificá con el anemómetro.
            </p>
          )}
          {clima.error && <p className="error" role="alert">{clima.error}</p>}
          {gps.error && <p className="error" role="alert">{gps.error}</p>}
          <p className="aviso-local">
            Open-Meteo publica valores nuevos cada 15 minutos (a las :00, :15, :30 y :45) y la página los trae sola apenas salen.
            Si la pestaña estuvo en segundo plano, con el celular bloqueado o sin conexión, se actualiza al volver.
            Son datos de modelos meteorológicos para el momento actual, no de una estación en el lugar: el viento de cada equipo
            se calcula a su altura de trabajo, pero confirmalo siempre con el anemómetro antes de operar.
          </p>
          {filas.length === 0 ? <p className="vacio">Cargá un tramo con coordenadas o usá tu ubicación para ver el clima.</p> : (
            <div className="clima-grid">
              {filas.map((f) => <TarjetaClima key={f.id} titulo={f.nombre} subtitulo={f.detalle} clima={clima.clima[f.id]} />)}
            </div>
          )}
        </div>

        <h2 className="panel-header">Estado de los equipos en tiempo real</h2>
        <div className="panel-body">
          {filas.length === 0 || equiposActivos.length === 0 ? (
            <p className="vacio">Cargá al menos un tramo y un equipo activos para ver la matriz.</p>
          ) : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead>
                  <tr>
                    <th>Lugar</th>
                    <th>Clima</th>
                    {equiposActivos.map((e) => <th key={e.id}>{e.nombre}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const c = clima.clima[f.id];
                    return (
                      <tr key={f.id}>
                        <td><strong>{f.nombre}</strong><br /><small className="ayuda">{f.detalle}</small></td>
                        <td>
                          {c ? <>{descripcionClima(c.codigo)}<br /><small className="ayuda">{Math.round(c.temperatura)}°C · viento {kmh(c.viento10)} · ráf. {kmh(c.rafaga)}</small></>
                            : <span className="ayuda">Sin datos</span>}
                        </td>
                        {equiposActivos.map((e) => <CeldaEquipo key={e.id} equipo={e} clima={c} lineas={f.lineas} />)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <SeccionTramos matriz={datos} esAdmin={esAdmin} />
      <SeccionPeligros matriz={datos} esAdmin={esAdmin} />
      <SeccionEquipos matriz={datos} esAdmin={esAdmin} />
      <SeccionMedidas matriz={datos} esAdmin={esAdmin} />
    </div>
  );
}

function coordenadas(u: Ubicacion) {
  return `${u.latitud.toFixed(4)}, ${u.longitud.toFixed(4)} (±${Math.round(u.precision)} m)`;
}

// ---------- Trabajo a realizar (cualquier usuario) ----------

const TRABAJO_NUEVO = { tramoId: "", equipoId: "", origen: "tramo" as "tramo" | "gps", tarea: "", altura: "", lineas: "" as "" | "si" | "no", distancia: "" };

/**
 * El chofer u operador carga el trabajo que quiere hacer y ve si están dadas las
 * condiciones. Lo que carga acá solo sirve para la evaluación: no cambia los
 * valores de la matriz, que solo edita un Admin.
 */
function Evaluacion({ matriz, tramos, equipos, clima, gps }: {
  matriz: Matriz; tramos: Tramo[]; equipos: Equipo[]; clima: Record<string, Clima>;
  gps: ReturnType<typeof useUbicacionActual>;
}) {
  const [f, setF] = useState(TRABAJO_NUEVO);
  const [verificado, setVerificado] = useState<typeof TRABAJO_NUEVO | null>(null);
  const tramoForm = tramos.find((t) => t.id === f.tramoId);
  const equipoForm = equipos.find((e) => e.id === f.equipoId);

  function cambiar(cambios: Partial<typeof TRABAJO_NUEVO>) {
    const nuevo = { ...f, ...cambios };
    // Al elegir equipo o tramo se proponen sus valores; el usuario los puede cambiar.
    if (cambios.equipoId !== undefined) nuevo.altura = equipos.find((e) => e.id === cambios.equipoId)?.altura_trabajo_m.toString() ?? "";
    if (cambios.tramoId !== undefined) {
      const t = tramos.find((x) => x.id === cambios.tramoId);
      nuevo.lineas = t ? (t.lineas_electricas ? "si" : "no") : "";
    }
    if (cambios.origen === "gps" && !gps.ubicacion) gps.pedir();
    setF(nuevo);
  }

  function verificar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerificado(f);
  }

  return (
    <section className="panel">
      <h2 className="panel-header">Cargar trabajo a realizar</h2>
      <form className="panel-body" onSubmit={verificar}>
        <p className="ayuda">Cargá el trabajo que querés hacer y verificá si están dadas las condiciones con el clima real del momento.</p>
        <div className="form-grid">
          <label>Tramo / ruta
            <select value={f.tramoId} onChange={(e) => cambiar({ tramoId: e.target.value })} required>
              <option value="">Elegí un tramo</option>
              {tramos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label>Equipo
            <select value={f.equipoId} onChange={(e) => cambiar({ equipoId: e.target.value })} required>
              <option value="">Elegí un equipo</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label>Clima de
            <select value={f.origen} onChange={(e) => cambiar({ origen: e.target.value as "tramo" | "gps" })}>
              <option value="tramo">Las coordenadas del tramo</option>
              <option value="gps">Mi ubicación actual (GPS)</option>
            </select>
          </label>
          <label>Altura de trabajo prevista <small>(m)</small>
            <input type="number" min="0" max="120" step="0.5" value={f.altura} onChange={(e) => cambiar({ altura: e.target.value })}
              placeholder={equipoForm ? `${equipoForm.altura_trabajo_m}` : ""} required />
          </label>
          <label>¿Hay líneas eléctricas cerca?
            <select value={f.lineas} onChange={(e) => cambiar({ lineas: e.target.value as "" | "si" | "no" })} required>
              <option value="">Elegí una opción</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </label>
          {f.lineas === "si" && (
            <label>Distancia estimada a las líneas <small>(m)</small>
              <input type="number" min="0" step="0.1" value={f.distancia} onChange={(e) => cambiar({ distancia: e.target.value })} required />
            </label>
          )}
        </div>
        <label>Tarea <small>(opcional)</small>
          <input value={f.tarea} onChange={(e) => cambiar({ tarea: e.target.value })} placeholder="Ej.: izaje de bomba en locación" />
        </label>
        {f.origen === "gps" && gps.buscando && <p className="ayuda">Obteniendo tu ubicación…</p>}
        {f.origen === "gps" && gps.error && <p className="error" role="alert">{gps.error}</p>}
        {tramoForm && equipoForm && tramoForm.latitud === null && f.origen === "tramo" && (
          <p className="texto-aviso">El tramo no tiene coordenadas: elegí «Mi ubicación actual» para usar el clima real.</p>
        )}
        <div className="actions">
          {verificado && <button type="button" className="secondary" onClick={() => { setF(TRABAJO_NUEVO); setVerificado(null); }}>Nuevo trabajo</button>}
          <button type="submit" className="primary inline">Verificar condiciones</button>
        </div>
      </form>

      {verificado && <ResultadoTrabajo trabajo={verificado} matriz={matriz} tramos={tramos} equipos={equipos} clima={clima} />}
    </section>
  );
}

function ResultadoTrabajo({ trabajo, matriz, tramos, equipos, clima }: {
  trabajo: typeof TRABAJO_NUEVO; matriz: Matriz; tramos: Tramo[]; equipos: Equipo[]; clima: Record<string, Clima>;
}) {
  const tramo = tramos.find((t) => t.id === trabajo.tramoId);
  const equipoBase = equipos.find((e) => e.id === trabajo.equipoId);
  if (!tramo || !equipoBase) return null;

  // Los límites son los del Admin; solo la altura sale del trabajo cargado.
  const equipo = { ...equipoBase, altura_trabajo_m: numero(trabajo.altura) ?? equipoBase.altura_trabajo_m };
  const climaActual = trabajo.origen === "gps" ? clima[GPS] : clima[tramo.id];
  const ev = evaluarEquipo(equipo, climaActual);
  const motivos = [...ev.motivos];
  let estado = ev.estado;

  const distancia = numero(trabajo.distancia);
  const lineas = trabajo.lineas === "si";
  if (lineas && equipo.riesgo_electrico && equipo.distancia_lineas_m !== null && distancia !== null && distancia < equipo.distancia_lineas_m) {
    motivos.push(`distancia a líneas ${distancia} m < mínimo ${equipo.distancia_lineas_m} m`);
    estado = "suspendido";
  }
  const tramoEvaluado = { ...tramo, lineas_electricas: lineas };
  const peligros = peligrosAplicables(matriz, tramoEvaluado, equipo);
  const medidas = medidasObligatorias(matriz, tramoEvaluado, equipo, estado);
  const nombrePeligro = (id: string | null) => matriz.peligros.find((p) => p.id === id)?.nombre;

  return (
    <div className="panel-body resultado-trabajo">
      <div className={`evaluacion evaluacion-${estado}`} role="status" aria-live="polite">
        <ChipEstado estado={estado} />
        <div>
          <strong>
            {estado === "suspendido" ? `No están dadas las condiciones: ${motivos.join(", ")}.`
              : estado === "precaucion" ? `Se puede hacer con restricciones: ${motivos.join(", ")}.`
                : estado === "habilitado" ? "Están dadas las condiciones para hacer el trabajo."
                  : "Sin dato del clima: verificá con el anemómetro antes de operar."}
          </strong>
          <p>
            {equipo.nombre} en {tramo.nombre}{trabajo.tarea.trim() && ` — ${trabajo.tarea.trim()}`}.
            {" "}Clima de {trabajo.origen === "gps" ? "tu ubicación actual" : "las coordenadas del tramo"}; se actualiza solo.
          </p>
          {climaActual && (
            <p>
              {descripcionClima(climaActual.codigo)}, {Math.round(climaActual.temperatura)}°C.
              Viento a {equipo.altura_trabajo_m} m: {kmh(ev.viento)} (ráfagas {kmh(ev.rafaga)}, desde el {direccionCardinal(climaActual.direccion)}).
              Visibilidad {visibilidad(climaActual.visibilidad)}. Datos de las {hora(climaActual.momento)}.
            </p>
          )}
          <p>
            Límites del equipo: precaución {kmh(equipo.viento_precaucion_kmh)}, máximo {kmh(equipo.viento_maximo_kmh)},
            ráfaga {kmh(equipo.rafaga_maxima_kmh)}{equipo.suspender_tormenta ? ", suspende con tormenta eléctrica" : ""}.
          </p>
          {equipo.riesgo_electrico && (
            <p className={lineas ? "texto-aviso" : undefined}>
              ⚡ {lineas ? `Líneas eléctricas a ${distancia ?? "—"} m.` : "Sin líneas eléctricas cerca."}{" "}
              Distancia mínima del equipo: {equipo.distancia_lineas_m ?? "—"} m{equipo.aislado ? " (equipo aislado)" : ""}.
            </p>
          )}
        </div>
      </div>

      <div className="evaluacion-columnas">
        <div>
          <h3>Peligros ({peligros.length})</h3>
          {peligros.length === 0 ? <p className="vacio">Sin peligros cargados.</p> : (
            <ul className="lista-riesgos">
              {peligros.map((p) => <li key={p.id}><ChipNivel peligro={p} /> {p.nombre}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h3>Medidas obligatorias ({medidas.length})</h3>
          {medidas.length === 0 ? <p className="vacio">Sin medidas cargadas.</p> : (
            <ol className="lista-riesgos">
              {medidas.map((m) => (
                <li key={m.id}>
                  {m.descripcion}
                  {m.peligro_id && <small className="ayuda"> — {nombrePeligro(m.peligro_id)}</small>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/** Admin: busca el tramo por nombre de lugar o toma la ubicación GPS, y completa las coordenadas. */
function BuscadorUbicacion({ onElegir }: { onElegir: (latitud: number, longitud: number) => void }) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Lugar[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [fallo, setFallo] = useState("");
  const gps = useUbicacionActual();

  useEffect(() => {
    if (gps.ubicacion) onElegir(Number(gps.ubicacion.latitud.toFixed(5)), Number(gps.ubicacion.longitud.toFixed(5)));
    // Solo cuando llega una ubicación nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.ubicacion]);

  async function buscar() {
    if (!consulta.trim()) return;
    setBuscando(true);
    setFallo("");
    try {
      setResultados(await buscarLugar(consulta));
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo buscar el lugar.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <fieldset className="grupo">
      <legend>Ubicación para el clima</legend>
      <div className="buscador-lugar">
        <label>Buscar lugar <small>(localidad, paraje o yacimiento)</small>
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }}
            placeholder="Ej.: Añelo"
          />
        </label>
        <button type="button" className="secondary" onClick={() => void buscar()} disabled={buscando}>{buscando ? "Buscando…" : "Buscar"}</button>
        <button type="button" className="secondary" onClick={gps.pedir} disabled={gps.buscando}>{gps.buscando ? "Ubicando…" : "Usar mi ubicación"}</button>
      </div>
      {(fallo || gps.error) && <p className="error" role="alert">{fallo || gps.error}</p>}
      {resultados && (resultados.length === 0 ? <p className="vacio">No se encontraron lugares con ese nombre.</p> : (
        <ul className="lugares">
          {resultados.map((r) => (
            <li key={`${r.latitud},${r.longitud}`}>
              <button type="button" className="text-button" onClick={() => { onElegir(r.latitud, r.longitud); setResultados(null); }}>
                {r.nombre}{r.detalle && ` — ${r.detalle}`}
              </button>
            </li>
          ))}
        </ul>
      ))}
    </fieldset>
  );
}

// ---------- Edición (solo Admin) ----------

function useEdicion(tabla: TablaRiesgo) {
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState("");
  const [aviso, setAviso] = useState("");
  const [pedido, setPedido] = useState<PedidoEliminar | null>(null);

  async function ejecutar(accion: () => Promise<void>, mensaje: string) {
    setFallo("");
    setAviso("");
    setGuardando(true);
    try {
      await accion();
      setAviso(mensaje);
      return true;
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function resolver(accion: () => Promise<void>, mensaje: string) {
    await ejecutar(accion, mensaje);
    setPedido(null);
  }

  return {
    guardando,
    mensajes: <>{fallo && <p className="error" role="alert">{fallo}</p>}{aviso && <p className="exito" role="status">{aviso}</p>}</>,
    guardar: (id: string | null, fila: Record<string, unknown>, mensaje: string) => ejecutar(() => guardarFila(tabla, id, fila), mensaje),
    pedirEliminar: (p: PedidoEliminar) => { setFallo(""); setAviso(""); setPedido(p); },
    dialogo: (
      <DialogoEliminar
        pedido={pedido}
        ocupado={guardando}
        onCancelar={() => setPedido(null)}
        onDesactivar={() => pedido && void resolver(() => guardarFila(tabla, pedido.id, { activo: false }), `«${pedido.nombre}» desactivado.`)}
      />
    ),
  };
}

/**
 * Sección de la matriz. El formulario del Admin queda plegado y se despliega
 * con «Nuevo…» o con «Editar» en una fila.
 */
function Seccion({ titulo, children, esAdmin, abierto, nuevo, onNuevo, mensajes, formulario }: {
  titulo: string; children: ReactNode; esAdmin: boolean; abierto: boolean; nuevo: string;
  onNuevo: () => void; mensajes: ReactNode; formulario: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (abierto) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [abierto]);

  return (
    <section className="panel">
      <div className="panel-header panel-header-fila">
        <span>{titulo}</span>
        {esAdmin && !abierto && <button type="button" className="secondary" onClick={onNuevo}>+ {nuevo}</button>}
      </div>
      <div className="panel-body">
        {esAdmin && !abierto && mensajes}
        {children}
      </div>
      {esAdmin && abierto && <div ref={ref} className="formulario-desplegable">{formulario}</div>}
    </section>
  );
}

function Acciones({ esAdmin, onEditar, onEliminar }: { esAdmin: boolean; onEditar: () => void; onEliminar: () => void }) {
  if (!esAdmin) return null;
  return (
    <td className="celda-acciones">
      <button type="button" className="secondary" onClick={onEditar}>Editar</button>
      <button type="button" className="secondary peligro" onClick={onEliminar}>Desactivar</button>
    </td>
  );
}

function BotonesFormulario({ guardando, etiqueta, onCancelar }: { guardando: boolean; etiqueta: string; onCancelar: () => void }) {
  return (
    <div className="actions">
      <button type="button" className="secondary" onClick={onCancelar}>Cancelar</button>
      <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : etiqueta}</button>
    </div>
  );
}

// ---------- Tramos ----------

const TRAMO_NUEVO = { id: "", nombre: "", tipo: "asfalto" as TipoTramo, descripcion: "", latitud: "", longitud: "", velocidad: "", lineas: false, activo: true, orden: "0" };

function SeccionTramos({ matriz, esAdmin }: { matriz: Matriz; esAdmin: boolean }) {
  const [f, setF] = useState(TRAMO_NUEVO);
  const ed = useEdicion("riesgo_tramos");
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => { setF(TRAMO_NUEVO); setAbierto(false); };
  const editar = (valores: typeof TRAMO_NUEVO) => { setF(valores); setAbierto(true); };
  const peligrosDe = (t: Tramo) => matriz.peligros.filter((p) => p.activo && (p.tramo_ids.length === 0 || p.tramo_ids.includes(t.id))).length;

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await ed.guardar(f.id || null, {
      nombre: f.nombre.trim(), tipo: f.tipo, descripcion: texto(f.descripcion), latitud: numero(f.latitud), longitud: numero(f.longitud),
      velocidad_maxima: numero(f.velocidad), lineas_electricas: f.lineas, activo: f.activo, orden: numero(f.orden) ?? 0,
    }, `Tramo «${f.nombre.trim()}» guardado.`);
    if (ok) cerrar();
  }

  return (
    <Seccion
      titulo="Tramos y rutas"
      esAdmin={esAdmin}
      abierto={abierto}
      nuevo="Nuevo tramo"
      onNuevo={() => editar(TRAMO_NUEVO)}
      mensajes={ed.mensajes}
      formulario={(
        <>
          <h2 className="panel-header">{f.id ? "Editar tramo" : "Nuevo tramo"}</h2>
          <form className="panel-body" onSubmit={enviar}>
            {ed.mensajes}
            <div className="form-grid">
              <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Ruta 7" required /></label>
              <label>Tipo
                <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoTramo })}>
                  {Object.entries(TIPOS_TRAMO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Velocidad máxima <small>(km/h)</small><input type="number" min="1" value={f.velocidad} onChange={(e) => setF({ ...f, velocidad: e.target.value })} /></label>
              <label>Latitud <small>(para el viento)</small><input type="number" step="0.00001" min="-90" max="90" value={f.latitud} onChange={(e) => setF({ ...f, latitud: e.target.value })} placeholder="-38.62" /></label>
              <label>Longitud<input type="number" step="0.00001" min="-180" max="180" value={f.longitud} onChange={(e) => setF({ ...f, longitud: e.target.value })} placeholder="-68.42" /></label>
              <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
            </div>
            <BuscadorUbicacion onElegir={(latitud, longitud) => setF((actual) => ({ ...actual, latitud: latitud.toString(), longitud: longitud.toString() }))} />
            <label>Descripción <small>(opcional)</small><input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></label>
            <div className="check-row">
              <label className="check"><input type="checkbox" checked={f.lineas} onChange={(e) => setF({ ...f, lineas: e.target.checked })} />Hay líneas eléctricas aéreas</label>
              <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activo</label>
            </div>
            <BotonesFormulario guardando={ed.guardando} etiqueta="Guardar tramo" onCancelar={cerrar} />
          </form>
        </>
      )}
    >
      {matriz.tramos.length === 0 ? <p className="vacio">Todavía no hay tramos cargados.</p> : (
        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>Tramo</th><th>Tipo</th><th>Vel. máx.</th><th>Líneas eléctricas</th><th>Peligros</th><th>Activo</th>{esAdmin && <th>Acciones</th>}</tr></thead>
            <tbody>
              {matriz.tramos.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.nombre}</strong>{t.descripcion && <><br /><small className="ayuda">{t.descripcion}</small></>}</td>
                  <td>{TIPOS_TRAMO[t.tipo]}</td>
                  <td>{kmh(t.velocidad_maxima)}</td>
                  <td>{t.lineas_electricas ? <span className="texto-aviso">⚡ Sí</span> : "No"}</td>
                  <td>{peligrosDe(t)}</td>
                  <td>{t.activo ? "Sí" : "No"}</td>
                  <Acciones
                    esAdmin={esAdmin}
                    onEditar={() => editar({
                      id: t.id, nombre: t.nombre, tipo: t.tipo, descripcion: t.descripcion ?? "", latitud: t.latitud?.toString() ?? "",
                      longitud: t.longitud?.toString() ?? "", velocidad: t.velocidad_maxima?.toString() ?? "", lineas: t.lineas_electricas,
                      activo: t.activo, orden: t.orden.toString(),
                    })}
                    onEliminar={() => ed.pedirEliminar({
                      id: t.id, tipo: "el tramo", nombre: t.nombre, activo: t.activo,
                      consecuencias: [
                        `Se eliminan las ${matriz.medidas.filter((m) => m.tramo_id === t.id).length} medidas de mitigación propias de este tramo.`,
                        "Deja de aparecer en la matriz y en la carga de trabajos.",
                      ],
                    })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed.dialogo}
    </Seccion>
  );
}

// ---------- Peligros ----------

const PELIGRO_NUEVO = {
  id: "", nombre: "", categoria: "vial" as CategoriaPeligro, descripcion: "", severidad: 3, probabilidad: 3,
  tramos: [] as string[], equipos: [] as TipoEquipo[], activo: true,
};

function SeccionPeligros({ matriz, esAdmin }: { matriz: Matriz; esAdmin: boolean }) {
  const [f, setF] = useState(PELIGRO_NUEVO);
  const ed = useEdicion("riesgo_peligros");
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => { setF(PELIGRO_NUEVO); setAbierto(false); };
  const editar = (valores: typeof PELIGRO_NUEVO) => { setF(valores); setAbierto(true); };
  const nombreTramo = (id: string) => matriz.tramos.find((t) => t.id === id)?.nombre ?? "—";

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await ed.guardar(f.id || null, {
      nombre: f.nombre.trim(), categoria: f.categoria, descripcion: texto(f.descripcion), severidad: f.severidad,
      probabilidad: f.probabilidad, tramo_ids: f.tramos, equipo_tipos: f.equipos, activo: f.activo,
    }, `Peligro «${f.nombre.trim()}» guardado.`);
    if (ok) cerrar();
  }

  const alternar = <T,>(lista: T[], valor: T, marcado: boolean) => (marcado ? [...lista, valor] : lista.filter((v) => v !== valor));

  return (
    <Seccion
      titulo="Peligros predefinidos"
      esAdmin={esAdmin}
      abierto={abierto}
      nuevo="Nuevo peligro"
      onNuevo={() => editar(PELIGRO_NUEVO)}
      mensajes={ed.mensajes}
      formulario={(
        <>
          <h2 className="panel-header">{f.id ? "Editar peligro" : "Nuevo peligro"}</h2>
          <form className="panel-body" onSubmit={enviar}>
            {ed.mensajes}
            <div className="form-grid">
              <label>Peligro<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></label>
              <label>Categoría
                <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaPeligro })}>
                  {Object.entries(CATEGORIAS_PELIGRO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Severidad <small>(1 a 5)</small>
                <select value={f.severidad} onChange={(e) => setF({ ...f, severidad: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>Probabilidad <small>(1 a 5)</small>
                <select value={f.probabilidad} onChange={(e) => setF({ ...f, probabilidad: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <p>Nivel resultante: <ChipNivel peligro={f} /></p>
            <label>Descripción <small>(opcional)</small><input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></label>
            <fieldset className="grupo">
              <legend>Tramos donde aplica <small>(ninguno = todos)</small></legend>
              <div className="check-row">
                {matriz.tramos.map((t) => (
                  <label className="check" key={t.id}>
                    <input type="checkbox" checked={f.tramos.includes(t.id)} onChange={(e) => setF({ ...f, tramos: alternar(f.tramos, t.id, e.target.checked) })} />
                    {t.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="grupo">
              <legend>Tipos de equipo <small>(ninguno = todos)</small></legend>
              <div className="check-row">
                {(Object.keys(TIPOS_EQUIPO) as TipoEquipo[]).map((tipo) => (
                  <label className="check" key={tipo}>
                    <input type="checkbox" checked={f.equipos.includes(tipo)} onChange={(e) => setF({ ...f, equipos: alternar(f.equipos, tipo, e.target.checked) })} />
                    {TIPOS_EQUIPO[tipo]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activo</label>
            <BotonesFormulario guardando={ed.guardando} etiqueta="Guardar peligro" onCancelar={cerrar} />
          </form>
        </>
      )}
    >
      <p className="ayuda">Nivel = severidad × probabilidad (1–4 bajo, 5–9 moderado, 10–16 alto, 20–25 crítico).</p>
      {matriz.peligros.length === 0 ? <p className="vacio">Todavía no hay peligros cargados.</p> : (
        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>Peligro</th><th>Categoría</th><th>S × P</th><th>Tramos</th><th>Equipos</th><th>Activo</th>{esAdmin && <th>Acciones</th>}</tr></thead>
            <tbody>
              {matriz.peligros.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.nombre}</strong>{p.descripcion && <><br /><small className="ayuda">{p.descripcion}</small></>}</td>
                  <td>{CATEGORIAS_PELIGRO[p.categoria]}</td>
                  <td><ChipNivel peligro={p} /></td>
                  <td>{p.tramo_ids.length ? p.tramo_ids.map(nombreTramo).join(", ") : "Todos"}</td>
                  <td>{p.equipo_tipos.length ? p.equipo_tipos.map((t) => TIPOS_EQUIPO[t]).join(", ") : "Todos"}</td>
                  <td>{p.activo ? "Sí" : "No"}</td>
                  <Acciones
                    esAdmin={esAdmin}
                    onEditar={() => editar({
                      id: p.id, nombre: p.nombre, categoria: p.categoria, descripcion: p.descripcion ?? "", severidad: p.severidad,
                      probabilidad: p.probabilidad, tramos: p.tramo_ids, equipos: p.equipo_tipos, activo: p.activo,
                    })}
                    onEliminar={() => ed.pedirEliminar({
                      id: p.id, tipo: "el peligro", nombre: p.nombre, activo: p.activo,
                      consecuencias: [`Se eliminan las ${matriz.medidas.filter((m) => m.peligro_id === p.id).length} medidas de mitigación asociadas a este peligro.`],
                    })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed.dialogo}
    </Seccion>
  );
}

// ---------- Equipos ----------

const EQUIPO_NUEVO = {
  id: "", nombre: "", tipo: "izaje" as TipoEquipo, precaucion: "", maximo: "", rafaga: "", electrico: true,
  distancia: "", aislado: false, altura: "10", tormenta: true, notas: "", activo: true, orden: "0",
};

function SeccionEquipos({ matriz, esAdmin }: { matriz: Matriz; esAdmin: boolean }) {
  const [f, setF] = useState(EQUIPO_NUEVO);
  const ed = useEdicion("riesgo_equipos");
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => { setF(EQUIPO_NUEVO); setAbierto(false); };
  const editar = (valores: typeof EQUIPO_NUEVO) => { setF(valores); setAbierto(true); };

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await ed.guardar(f.id || null, {
      nombre: f.nombre.trim(), tipo: f.tipo, viento_precaucion_kmh: numero(f.precaucion), viento_maximo_kmh: numero(f.maximo),
      rafaga_maxima_kmh: numero(f.rafaga), riesgo_electrico: f.electrico, distancia_lineas_m: numero(f.distancia),
      aislado: f.aislado, altura_trabajo_m: numero(f.altura) ?? 10, suspender_tormenta: f.tormenta, notas: texto(f.notas), activo: f.activo, orden: numero(f.orden) ?? 0,
    }, `Equipo «${f.nombre.trim()}» guardado.`);
    if (ok) cerrar();
  }

  return (
    <Seccion
      titulo="Riesgo por equipo"
      esAdmin={esAdmin}
      abierto={abierto}
      nuevo="Nuevo equipo"
      onNuevo={() => editar(EQUIPO_NUEVO)}
      mensajes={ed.mensajes}
      formulario={(
        <>
          <h2 className="panel-header">{f.id ? "Editar equipo" : "Nuevo equipo"}</h2>
          <form className="panel-body" onSubmit={enviar}>
            {ed.mensajes}
            <div className="form-grid">
              <label>Equipo<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Hidrogrúa TKA" required /></label>
              <label>Tipo
                <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoEquipo })}>
                  {Object.entries(TIPOS_EQUIPO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Viento de precaución <small>(km/h)</small><input type="number" min="0" step="0.1" value={f.precaucion} onChange={(e) => setF({ ...f, precaucion: e.target.value })} /></label>
              <label>Viento máximo <small>(km/h, suspende)</small><input type="number" min="0" step="0.1" value={f.maximo} onChange={(e) => setF({ ...f, maximo: e.target.value })} /></label>
              <label>Ráfaga máxima <small>(km/h, suspende)</small><input type="number" min="0" step="0.1" value={f.rafaga} onChange={(e) => setF({ ...f, rafaga: e.target.value })} /></label>
              <label>Altura de trabajo <small>(m, para el viento)</small><input type="number" min="0" max="120" step="0.5" value={f.altura} onChange={(e) => setF({ ...f, altura: e.target.value })} required /></label>
              <label>Distancia mínima a líneas <small>(m)</small><input type="number" min="0" step="0.1" value={f.distancia} onChange={(e) => setF({ ...f, distancia: e.target.value })} disabled={!f.electrico} /></label>
              <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
            </div>
            <label>Notas <small>(opcional)</small><input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
            <div className="check-row">
              <label className="check"><input type="checkbox" checked={f.electrico} onChange={(e) => setF({ ...f, electrico: e.target.checked })} />Tiene riesgo eléctrico</label>
              <label className="check"><input type="checkbox" checked={f.aislado} onChange={(e) => setF({ ...f, aislado: e.target.checked })} />Equipo aislado (dieléctrico)</label>
              <label className="check"><input type="checkbox" checked={f.tormenta} onChange={(e) => setF({ ...f, tormenta: e.target.checked })} />Suspender con tormenta eléctrica</label>
              <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activo</label>
            </div>
            <BotonesFormulario guardando={ed.guardando} etiqueta="Guardar equipo" onCancelar={cerrar} />
          </form>
        </>
      )}
    >
      {matriz.equipos.length === 0 ? <p className="vacio">Todavía no hay equipos cargados.</p> : (
        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead>
              <tr><th>Equipo</th><th>Tipo</th><th>Precaución</th><th>Máximo</th><th>Ráfaga máx.</th><th>Altura</th><th>Tormenta</th><th>Riesgo eléctrico</th><th>Activo</th>{esAdmin && <th>Acciones</th>}</tr>
            </thead>
            <tbody>
              {matriz.equipos.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.nombre}</strong>{e.notas && <><br /><small className="ayuda">{e.notas}</small></>}</td>
                  <td>{TIPOS_EQUIPO[e.tipo]}</td>
                  <td><span className="texto-aviso">{kmh(e.viento_precaucion_kmh)}</span></td>
                  <td><span className="texto-alto">{kmh(e.viento_maximo_kmh)}</span></td>
                  <td><span className="texto-alto">{kmh(e.rafaga_maxima_kmh)}</span></td>
                  <td>{e.altura_trabajo_m} m</td>
                  <td>{e.suspender_tormenta ? "Suspende" : "No"}</td>
                  <td>{e.riesgo_electrico ? `⚡ mín. ${e.distancia_lineas_m ?? "—"} m${e.aislado ? " · aislado" : ""}` : "No"}</td>
                  <td>{e.activo ? "Sí" : "No"}</td>
                  <Acciones
                    esAdmin={esAdmin}
                    onEditar={() => editar({
                      id: e.id, nombre: e.nombre, tipo: e.tipo, precaucion: e.viento_precaucion_kmh?.toString() ?? "",
                      maximo: e.viento_maximo_kmh?.toString() ?? "", rafaga: e.rafaga_maxima_kmh?.toString() ?? "",
                      electrico: e.riesgo_electrico, distancia: e.distancia_lineas_m?.toString() ?? "", aislado: e.aislado,
                      altura: e.altura_trabajo_m.toString(), tormenta: e.suspender_tormenta,
                      notas: e.notas ?? "", activo: e.activo, orden: e.orden.toString(),
                    })}
                    onEliminar={() => ed.pedirEliminar({
                      id: e.id, tipo: "el equipo", nombre: e.nombre, activo: e.activo,
                      consecuencias: [
                        `Se eliminan las ${matriz.medidas.filter((m) => m.equipo_id === e.id).length} medidas de mitigación propias de este equipo.`,
                        "Se pierden sus límites de viento y de riesgo eléctrico.",
                      ],
                    })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed.dialogo}
    </Seccion>
  );
}

// ---------- Medidas de mitigación ----------

const MEDIDA_NUEVA = { id: "", descripcion: "", tramo: "", equipo: "", peligro: "", condicion: "" as "" | CondicionViento, activo: true, orden: "0" };

function SeccionMedidas({ matriz, esAdmin }: { matriz: Matriz; esAdmin: boolean }) {
  const [f, setF] = useState(MEDIDA_NUEVA);
  const ed = useEdicion("riesgo_medidas");
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => { setF(MEDIDA_NUEVA); setAbierto(false); };
  const editar = (valores: typeof MEDIDA_NUEVA) => { setF(valores); setAbierto(true); };
  const nombre = (lista: { id: string; nombre: string }[], id: string | null) => lista.find((x) => x.id === id)?.nombre;

  function alcance(m: Medida) {
    const partes = [nombre(matriz.tramos, m.tramo_id), nombre(matriz.equipos, m.equipo_id), nombre(matriz.peligros, m.peligro_id)].filter(Boolean);
    return partes.length ? partes.join(" · ") : "General";
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await ed.guardar(f.id || null, {
      descripcion: f.descripcion.trim(), tramo_id: f.tramo || null, equipo_id: f.equipo || null, peligro_id: f.peligro || null,
      condicion: f.condicion || null, activo: f.activo, orden: numero(f.orden) ?? 0,
    }, "Medida guardada.");
    if (ok) cerrar();
  }

  return (
    <Seccion
      titulo="Medidas de mitigación obligatorias"
      esAdmin={esAdmin}
      abierto={abierto}
      nuevo="Nueva medida"
      onNuevo={() => editar(MEDIDA_NUEVA)}
      mensajes={ed.mensajes}
      formulario={(
        <>
          <h2 className="panel-header">{f.id ? "Editar medida" : "Nueva medida"}</h2>
          <form className="panel-body" onSubmit={enviar}>
            {ed.mensajes}
            <label>Medida<textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></label>
            <div className="form-grid">
              <label>Tramo
                <select value={f.tramo} onChange={(e) => setF({ ...f, tramo: e.target.value })}>
                  <option value="">Todos</option>
                  {matriz.tramos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </label>
              <label>Equipo
                <select value={f.equipo} onChange={(e) => setF({ ...f, equipo: e.target.value })}>
                  <option value="">Todos</option>
                  {matriz.equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </label>
              <label>Peligro que mitiga
                <select value={f.peligro} onChange={(e) => setF({ ...f, peligro: e.target.value })}>
                  <option value="">Ninguno en particular</option>
                  {matriz.peligros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <label>Obligatoria
                <select value={f.condicion} onChange={(e) => setF({ ...f, condicion: e.target.value as "" | CondicionViento })}>
                  <option value="">Siempre</option>
                  <option value="precaucion">Desde viento de precaución</option>
                  <option value="suspendido">Cuando se suspende por viento</option>
                </select>
              </label>
              <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activa</label>
            <BotonesFormulario guardando={ed.guardando} etiqueta="Guardar medida" onCancelar={cerrar} />
          </form>
        </>
      )}
    >
      {matriz.medidas.length === 0 ? <p className="vacio">Todavía no hay medidas cargadas.</p> : (
        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>Medida</th><th>Aplica a</th><th>Obligatoria</th><th>Activa</th>{esAdmin && <th>Acciones</th>}</tr></thead>
            <tbody>
              {matriz.medidas.map((m) => (
                <tr key={m.id}>
                  <td>{m.descripcion}</td>
                  <td>{alcance(m)}</td>
                  <td>{m.condicion ? <ChipEstado estado={m.condicion} /> : "Siempre"}</td>
                  <td>{m.activo ? "Sí" : "No"}</td>
                  <Acciones
                    esAdmin={esAdmin}
                    onEditar={() => editar({
                      id: m.id, descripcion: m.descripcion, tramo: m.tramo_id ?? "", equipo: m.equipo_id ?? "",
                      peligro: m.peligro_id ?? "", condicion: m.condicion ?? "", activo: m.activo, orden: m.orden.toString(),
                    })}
                    onEliminar={() => ed.pedirEliminar({
                      id: m.id, tipo: "la medida de mitigación", nombre: m.descripcion, activo: m.activo,
                      consecuencias: ["Deja de exigirse en la carga de trabajos."],
                    })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed.dialogo}
    </Seccion>
  );
}
