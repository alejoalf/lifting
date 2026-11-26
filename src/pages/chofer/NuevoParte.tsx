import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { crearParte, useCatalogoPartes, useEquipoDeVehiculo, usePartes, type TipoTarea } from "../../lib/usePartes";
import {
  CATEGORIAS_PELIGRO, ESTADOS, NIVELES, descripcionClima, evaluarEquipo, medidasObligatorias, nivelRiesgo,
  peligrosAplicables, useClima, useMatrizRiesgos, useUbicacionActual, type Equipo, type EstadoOperacion,
  type Matriz, type PuntoClima, type Tramo,
} from "../../lib/matrizRiesgos";

/** ATS del parte: peligros que aplican al lugar y al equipo, y medidas obligatorias para la condición actual. */
function armarAts(matriz: Matriz, tramo: Tramo | undefined, equipo: Equipo | undefined, estado: EstadoOperacion) {
  const peligros = peligrosAplicables(matriz, tramo, equipo);
  const medidas = medidasObligatorias(matriz, tramo, equipo, estado);
  return [
    ...peligros.map((p) => `Peligro: ${p.nombre} (${CATEGORIAS_PELIGRO[p.categoria]}) · riesgo ${NIVELES[nivelRiesgo(p)].toLowerCase()}`),
    ...medidas.map((m) => `Medida: ${m.descripcion}`),
  ].join("\n");
}
import { formatFecha, hoy } from "../../lib/registros";

const tareas: { valor: TipoTarea; etiqueta: string }[] = [
  { valor: "Transporte", etiqueta: "Transporte" },
  { valor: "Izaje Hidrogrua", etiqueta: "Izaje con hidrogrúa" },
  { valor: "Altura Barquilla", etiqueta: "Altura con barquilla" },
];

function esTipoTarea(valor: string): valor is TipoTarea {
  return tareas.some((tarea) => tarea.valor === valor);
}

export default function NuevoParte() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const { partes, loading: cargandoPartes, error: errorPartes } = usePartes();
  const { catalogo, loading: cargandoCatalogo, error: errorCatalogo } = useCatalogoPartes();
  const [clienteId, setClienteId] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [tipoTarea, setTipoTarea] = useState<TipoTarea | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Ubicación del parte y evaluación de viento con la matriz de riesgos.
  const matriz = useMatrizRiesgos();
  const gps = useUbicacionActual();
  const [modoUbicacion, setModoUbicacion] = useState<"gps" | "tramo">("gps");
  const [tramoId, setTramoId] = useState("");
  const { equipoId, error: errorEquipo } = useEquipoDeVehiculo(vehiculoId);
  const pedirGps = gps.pedir;
  useEffect(() => { pedirGps(); }, [pedirGps]);
  // Si el GPS no está disponible, se pasa a elegir el tramo.
  useEffect(() => { if (gps.error) setModoUbicacion("tramo"); }, [gps.error]);

  const tramos = (matriz.datos?.tramos ?? []).filter((t) => t.activo && t.latitud !== null && t.longitud !== null);
  const tramo = tramos.find((t) => t.id === tramoId);
  const punto = useMemo<PuntoClima | null>(() => {
    if (modoUbicacion === "gps" && gps.ubicacion) return { id: "parte", latitud: gps.ubicacion.latitud, longitud: gps.ubicacion.longitud };
    if (modoUbicacion === "tramo" && tramo?.latitud != null && tramo.longitud != null) return { id: "parte", latitud: tramo.latitud, longitud: tramo.longitud };
    return null;
  }, [modoUbicacion, gps.ubicacion, tramo]);
  const puntos = useMemo(() => (punto ? [punto] : []), [punto]);
  const clima = useClima(puntos);
  const requiereRiesgo = tipoTarea === "Izaje Hidrogrua" || tipoTarea === "Altura Barquilla";
  const equipo = matriz.datos?.equipos.find((e) => e.id === equipoId);
  const climaActual = punto ? clima.clima.parte : undefined;
  const evaluacion = equipo ? evaluarEquipo(equipo, climaActual) : null;
  // ATS: peligros y medidas de la matriz para el lugar (y el equipo en izaje / altura). El operador da conformidad.
  const ats = matriz.datos && punto
    ? armarAts(matriz.datos, modoUbicacion === "tramo" ? tramo : undefined, requiereRiesgo ? equipo : undefined, evaluacion?.estado ?? "sin-datos")
    : "";
  const [conformidad, setConformidad] = useState(false);
  useEffect(() => { setConformidad(false); }, [ats]);

  if (!operador) return null;
  if (cargandoPartes || cargandoCatalogo) return <p className="estado">Cargando datos para crear el parte…</p>;
  if (errorPartes || errorCatalogo) {
    return <p className="error" role="alert">{errorPartes || errorCatalogo}</p>;
  }

  const abierto = partes.find((parte) =>
    parte.creadoPor === operador.id && parte.estado !== "cerrado" && parte.estado !== "frenado" && parte.estado !== "anulado");
  if (abierto) {
    return (
      <section className="panel">
        <h2 className="panel-header">Ya tenés un parte abierto</h2>
        <div className="panel-body">
          <p>Antes de crear otro, terminá el parte N° {abierto.numero}: {abierto.estado === "en_curso"
            ? "cerrá el servicio cuando termine la jornada."
            : abierto.estado === "excepcion"
              ? "está esperando que Base autorice la salida."
              : "falta hacer el control documental."}</p>
          <div className="actions"><Link to={`/partes/${abierto.id}`} className="primary inline enlace-boton">Ver parte abierto</Link></div>
        </div>
      </section>
    );
  }

  const contratos = catalogo.contratos.filter((contrato) =>
    contrato.clienteId === clienteId && contrato.vehiculoId === vehiculoId);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!tipoTarea) {
      setError("Elegí el tipo de tarea.");
      return;
    }

    if (requiereRiesgo && !punto) {
      setError("Para izaje o trabajo en altura indicá la ubicación: activá el GPS o elegí el tramo.");
      return;
    }
    if (ats && !conformidad) {
      setError("Leé el análisis de riesgo (ATS) y confirmá tu conformidad antes de registrar el parte.");
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const parte = await crearParte({
        clienteId,
        contratoId: contratoId || null,
        vehiculoId,
        tipoTarea,
        origen: String(form.get("origen") ?? "").trim(),
        destino: String(form.get("destino") ?? "").trim(),
        kmInicial: Number(form.get("kmInicial")),
        observaciones: String(form.get("observaciones") ?? "").trim(),
        ubicacion: modoUbicacion === "gps" && gps.ubicacion
          ? { latitud: gps.ubicacion.latitud, longitud: gps.ubicacion.longitud, precision: gps.ubicacion.precision }
          : modoUbicacion === "tramo" && tramo ? { tramoId: tramo.id } : null,
        riesgo: {
          ats,
          conformidad: ats ? conformidad : false,
          ...(requiereRiesgo && equipo && evaluacion && evaluacion.estado !== "sin-datos" && climaActual
            ? {
              equipo_id: equipo.id, estado: evaluacion.estado, viento: evaluacion.viento, rafaga: evaluacion.rafaga,
              motivos: evaluacion.motivos, momento: climaActual.momento,
            }
            : {}),
        },
      });
      navigate(`/partes/${parte.id}`);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo registrar el parte. Revisá la conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={enviar}>
      <h2 className="panel-header">Datos del parte</h2>
      <div className="panel-body">
        <div className="form-grid">
          <label>Fecha<input value={formatFecha(hoy())} readOnly disabled /></label>
          <label>Operador<input value={operador.nombre_completo} readOnly disabled /></label>
        </div>
        <div className="form-grid">
          <label>Cliente
            <select value={clienteId} onChange={(event) => {
              setClienteId(event.target.value);
              setContratoId("");
            }} required>
              <option value="" disabled>Elegí un cliente</option>
              {catalogo.clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}
            </select>
          </label>
          <label>Vehículo disponible
            <select value={vehiculoId} onChange={(event) => {
              setVehiculoId(event.target.value);
              setContratoId("");
            }} required>
              <option value="" disabled>Elegí un vehículo</option>
              {catalogo.vehiculos.map((vehiculo) => <option key={vehiculo.id} value={vehiculo.id}>{vehiculo.nombre}</option>)}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>Contrato <small>(opcional)</small>
            <select value={contratoId} onChange={(event) => setContratoId(event.target.value)}>
              <option value="">Sin contrato</option>
              {contratos.map((contrato) => <option key={contrato.id} value={contrato.id}>{contrato.nombre}</option>)}
            </select>
          </label>
          <label>Kilometraje inicial<input type="number" name="kmInicial" min="0" step="1" required /></label>
          <label>Tarea
            <select value={tipoTarea} onChange={(event) => {
              const value = event.target.value;
              setTipoTarea(esTipoTarea(value) ? value : "");
            }} required>
              <option value="" disabled>Elegí una tarea</option>
              {tareas.map((tarea) => <option key={tarea.valor} value={tarea.valor}>{tarea.etiqueta}</option>)}
            </select>
          </label>
        </div>
        {clienteId && vehiculoId && contratos.length === 0 && (
          <p className="ayuda">No hay contratos vigentes para esta combinación de cliente y vehículo.</p>
        )}
        {catalogo.clientes.length === 0 && <p className="error" role="alert">No hay clientes disponibles para crear un parte.</p>}
        {catalogo.vehiculos.length === 0 && <p className="error" role="alert">No hay vehículos disponibles para crear un parte.</p>}
        <div className="form-grid">
          <label>Origen<input name="origen" required /></label>
          <label>Destino<input name="destino" placeholder="Ruta o locación" required /></label>
        </div>
        <label>Observaciones <small>(opcional)</small><textarea name="observaciones" rows={3} /></label>

        <h3 className="checklist-subtitulo">
          Ubicación y condiciones {requiereRiesgo ? <small>(obligatoria para izaje y altura)</small> : <small>(opcional)</small>}
        </h3>
        <fieldset className="segmento">
          <legend className="sr-only">Cómo indicar la ubicación</legend>
          <div className="segmento-opciones">
            <label className={`segmento-opcion${modoUbicacion === "gps" ? " is-active" : ""}`}>
              <input type="radio" name="modoUbicacion" checked={modoUbicacion === "gps"} onChange={() => { setModoUbicacion("gps"); if (!gps.ubicacion) gps.pedir(); }} />
              Mi ubicación (GPS)
            </label>
            <label className={`segmento-opcion${modoUbicacion === "tramo" ? " is-active" : ""}`}>
              <input type="radio" name="modoUbicacion" checked={modoUbicacion === "tramo"} onChange={() => setModoUbicacion("tramo")} />
              Elegir tramo
            </label>
          </div>
        </fieldset>
        {modoUbicacion === "gps" ? (
          <p className="ayuda" role="status">
            {gps.buscando ? "Buscando tu ubicación…"
              : gps.ubicacion ? <>Ubicación tomada: {gps.ubicacion.latitud.toFixed(5)}, {gps.ubicacion.longitud.toFixed(5)} (± {Math.round(gps.ubicacion.precision)} m).</>
                : gps.error ? <span className="texto-alto">{gps.error} Elegí el tramo.</span> : "Sin ubicación todavía."}
            {" "}<button type="button" className="text-button" onClick={gps.pedir} disabled={gps.buscando}>Actualizar ubicación</button>
          </p>
        ) : (
          <label>Tramo de la matriz de riesgos
            <select value={tramoId} onChange={(e) => setTramoId(e.target.value)} required={requiereRiesgo}>
              <option value="">{tramos.length ? "Elegí un tramo" : "No hay tramos con coordenadas"}</option>
              {tramos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
        )}

        {requiereRiesgo && vehiculoId && (
          equipoId === undefined && !errorEquipo ? <p className="estado">Buscando el equipo del vehículo…</p>
            : !equipo ? (
              <p className="aviso-local">
                El vehículo no tiene equipo vinculado en la matriz de riesgos, así que no se puede evaluar el viento.
                Pedile al administrador que lo vincule en Flota.
              </p>
            ) : !punto ? (
              <p className="ayuda">Indicá la ubicación para evaluar el viento para {equipo.nombre}.</p>
            ) : !climaActual || !evaluacion ? (
              <p className={clima.error ? "error" : "estado"}>{clima.error || "Consultando el clima del lugar…"}</p>
            ) : (
              <div
                className={`aviso-local ${evaluacion.estado === "suspendido" ? "aviso-falla" : evaluacion.estado === "habilitado" ? "aviso-ok" : ""}`}
                role="status"
              >
                <p>
                  <strong>{equipo.nombre}: {ESTADOS[evaluacion.estado]}</strong> · {descripcionClima(climaActual.codigo)}
                  {evaluacion.viento !== null && (
                    <> · viento {Math.round(evaluacion.viento)} km/h a {equipo.altura_trabajo_m} m, ráfagas {Math.round(evaluacion.rafaga ?? 0)} km/h</>
                  )}
                </p>
                {evaluacion.motivos.length > 0 && <ul>{evaluacion.motivos.map((m) => <li key={m}>{m}</li>)}</ul>}
                {evaluacion.estado === "suspendido" && (
                  <p>
                    La matriz indica <strong>suspender</strong> la maniobra. Si registrás el parte, no vas a poder salir:
                    queda esperando que Base autorice la salida excepcional o la frene.
                  </p>
                )}
              </div>
            )
        )}
        {(matriz.error || errorEquipo) && <p className="error" role="alert">{matriz.error || errorEquipo}</p>}

        {ats && (
          <>
            <h3 className="checklist-subtitulo">Análisis de trabajo seguro (ATS)</h3>
            <div className="ats aviso-local">{ats.split("\n").map((linea) => <p key={linea}>{linea}</p>)}</div>
            <label className="check declaracion">
              <input type="checkbox" checked={conformidad} onChange={(e) => setConformidad(e.target.checked)} />
              Leí el análisis de riesgo, conozco los peligros y voy a aplicar las medidas indicadas.
            </label>
          </>
        )}

        <p className="aviso-local" role="note">
          Al registrar el parte se controla la documentación del vehículo y de tu legajo, y las condiciones de la matriz de riesgos.
          Si todo está en regla, el parte queda en curso y podés salir; si algo venció o la matriz indica suspender, queda esperando
          que Base autorice la salida.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary inline" disabled={submitting || !catalogo.clientes.length || !catalogo.vehiculos.length}>
            {submitting ? "Guardando…" : "Registrar parte"}
          </button>
        </div>
      </div>
    </form>
  );
}
