import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { formatFechaHora, hoy } from "../../lib/registros";
import { crearGerenciamiento } from "../../lib/operaciones";
import { useCatalogoPartes, useParteAbiertoVehiculo } from "../../lib/usePartes";
import { salidaIso, salidaLejana, useEstadoChecklistVehiculo, type EstadoChecklistVehiculo } from "../../lib/checklistVehicular";

export default function NuevoGerenciamiento() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { catalogo, loading: cargandoCatalogo, error: errorCatalogo } = useCatalogoPartes();
  const [segundoConductor, setSegundoConductor] = useState(false);
  const [vehiculoId, setVehiculoId] = useState(params.get("vehiculo") ?? "");
  const [fechaSalida, setFechaSalida] = useState(hoy());
  const [horaSalida, setHoraSalida] = useState("");
  // Condición de inicio: checklist apto dentro de las 24 h previas a la salida (la base también lo exige).
  // Si la salida es en más de 24 h, el viaje se carga y queda esperando el checklist para poder autorizarse.
  const salida = salidaIso(fechaSalida, horaSalida);
  const lejana = salidaLejana(salida);
  const { estado: checklist, error: errorChecklist } = useEstadoChecklistVehiculo(vehiculoId, lejana ? "" : salida);
  const checklistOk = lejana || (!!checklist && checklist.apto);
  const [clienteId, setClienteId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  // El parte diario en curso del vehículo agrupa este trabajo; se precargan su cliente y contrato.
  const parte = useParteAbiertoVehiculo(vehiculoId);
  useEffect(() => {
    if (!parte) return;
    setClienteId((actual) => actual || parte.clienteId);
    setContratoId((actual) => actual || parte.contratoId);
  }, [parte]);

  if (cargandoCatalogo) return <p className="estado">Cargando vehículos y contratos…</p>;
  if (errorCatalogo) return <p className="error" role="alert">{errorCatalogo}</p>;

  // Contratos vigentes del cliente elegido; los que tienen vehículo asignado, solo para ese vehículo.
  const contratos = catalogo.contratos.filter((c) =>
    c.clienteId === clienteId && (!c.vehiculoId || c.vehiculoId === vehiculoId));
  const vehiculoElegido = catalogo.vehiculos.find((v) => v.id === vehiculoId);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador || guardando) return;
    if (!checklistOk) {
      setError("El vehículo necesita un checklist apto dentro de las 24 horas previas a la salida.");
      return;
    }
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    const inicio = `${fechaSalida}T${horaSalida}`;
    const llegada = `${texto("fechaLlegada")}T${texto("horaLlegada")}`;
    if (llegada <= inicio) {
      setError("La llegada tiene que ser posterior a la salida.");
      return;
    }

    setError("");
    setGuardando(true);
    try {
      await crearGerenciamiento({
        fechaSalida,
        horaSalida,
        fechaLlegada: texto("fechaLlegada"),
        horaLlegada: texto("horaLlegada"),
        vehiculo: vehiculoElegido?.nombre ?? "",
        vehiculoId: vehiculoId || null,
        parteId: parte?.id ?? null,
        clienteId: clienteId || null,
        contratoId: contratoId || null,
        conductor: texto("conductor"),
        conductor2: segundoConductor ? texto("conductor2") : "",
        origen: texto("origen"),
        destino: texto("destino"),
        distanciaKm: Number(texto("distanciaKm")),
        telefono: texto("telefono"),
        linea: texto("linea"),
        radioactivo: datos.has("radioactivo"),
        pasajeros: datos.has("pasajeros"),
        motivo: texto("motivo"),
        rutas: texto("rutas"),
      });
      navigate("/gerenciamientos");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el gerenciamiento.");
      setGuardando(false);
    }
  }

  return (
    <form className="panel" onSubmit={enviar}>
      <h2 className="panel-header">Datos generales</h2>
      <div className="panel-body">
        <div className="form-grid">
          <label>Fecha de salida<input type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} required /></label>
          <label>Hora de salida<input type="time" value={horaSalida} onChange={(e) => setHoraSalida(e.target.value)} required /></label>
          <label>Fecha de llegada<input type="date" name="fechaLlegada" defaultValue={hoy()} required /></label>
          <label>Hora de llegada<input type="time" name="horaLlegada" required /></label>
        </div>

        <div className="form-grid">
          <label>Vehículo
            <select value={vehiculoId} onChange={(e) => { setVehiculoId(e.target.value); setContratoId(""); }} required>
              <option value="" disabled>Elegí un vehículo</option>
              {catalogo.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
          <label>Cliente <small>(si el viaje es para un cliente)</small>
            <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setContratoId(""); }}>
              <option value="">Sin cliente / viaje interno</option>
              {catalogo.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Contrato <small>(para facturar el viaje)</small>
            <select value={contratoId} onChange={(e) => setContratoId(e.target.value)} disabled={!clienteId || !vehiculoId}>
              <option value="">{clienteId && vehiculoId ? "Sin contrato" : "Elegí vehículo y cliente"}</option>
              {contratos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
        {clienteId && vehiculoId && contratos.length === 0 && (
          <p className="ayuda">No hay contratos vigentes de este cliente para el vehículo elegido. El administrador lo puede asignar después.</p>
        )}
        {catalogo.vehiculos.length === 0 && <p className="error" role="alert">No hay vehículos disponibles en la flota.</p>}
        {vehiculoId && horaSalida && <CondicionChecklist vehiculoId={vehiculoId} salida={salida} lejana={lejana} estado={checklist} error={errorChecklist} />}
        {vehiculoId && !horaSalida && <p className="ayuda">Indicá la fecha y hora de salida para verificar el checklist del vehículo.</p>}
        {vehiculoId && parte && (
          <p className="ayuda" role="status">
            Este trabajo queda dentro del <Link to={`/partes/${parte.id}`}>parte diario N° {parte.numero}</Link> ({parte.operador}), que está en curso para el vehículo.
          </p>
        )}
        {vehiculoId && parte === null && (
          <p className="ayuda" role="status">El vehículo no tiene un parte diario en curso: el trabajo queda sin parte.</p>
        )}

        <div className="form-grid">
          <label>Conductor
            <input name="conductor" placeholder="Nombre del conductor" defaultValue={operador?.nombre_completo} required />
          </label>
          <div>
            <label htmlFor="conductor2">Conductor 2 (opcional)</label>
            <input
              id="conductor2"
              name="conductor2"
              className="campo-con-accion"
              placeholder={segundoConductor ? "Nombre del segundo conductor" : "No posee segundo conductor"}
              disabled={!segundoConductor}
            />
            <button type="button" className="text-button" onClick={() => setSegundoConductor((v) => !v)}>
              {segundoConductor ? "Quitar 2do conductor" : "Habilitar 2do conductor"}
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label>Origen<input name="origen" placeholder="Origen" required /></label>
          <label>Destino<input name="destino" placeholder="Destino" required /></label>
          <label>Distancia (en km)<input type="number" name="distanciaKm" min="1" step="1" placeholder="Distancia" required /></label>
        </div>

        <div className="form-grid">
          <label>Teléfono de contacto del conductor<input type="tel" name="telefono" placeholder="Teléfono" required /></label>
          <label>Línea de servicio / sector<input name="linea" placeholder="Ingresá una línea de servicio" required /></label>
        </div>

        <div className="check-row">
          <label className="check"><input type="checkbox" name="radioactivo" />Transporta material radioactivo</label>
          <label className="check"><input type="checkbox" name="pasajeros" />Pasajeros</label>
        </div>

        <label>Motivo de viaje<textarea name="motivo" rows={3} placeholder="Motivo de viaje / observación" required /></label>
        <label>Rutas a utilizar<textarea name="rutas" rows={3} placeholder="Completá con las rutas a utilizar en el viaje" required /></label>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary inline" disabled={guardando || !checklistOk}>{guardando ? "Guardando…" : "Guardar gerenciamiento"}</button>
        </div>
      </div>
    </form>
  );
}

/** Condición de inicio: checklist vehicular apto dentro de las 24 h previas a la salida. */
function CondicionChecklist({ vehiculoId, salida, lejana, estado, error }: {
  vehiculoId: string;
  salida: string;
  lejana: boolean;
  estado: EstadoChecklistVehiculo | null | undefined;
  error: string;
}) {
  if (lejana) {
    const desde = new Date(new Date(salida).getTime() - 24 * 3_600_000).toISOString();
    return (
      <p className="aviso-local" role="status">
        La salida es en más de 24 horas. El viaje se carga, pero el checklist del vehículo se hace <strong>desde el {formatFechaHora(desde)}</strong>:
        hasta entonces queda pendiente y no se puede autorizar.
      </p>
    );
  }
  if (error) return <p className="error" role="alert">{error}</p>;
  if (estado === undefined) return <p className="estado">Verificando el checklist del vehículo…</p>;
  if (estado?.apto) {
    return (
      <p className="aviso-local aviso-ok" role="status">
        Checklist <Link to={`/checklist/${estado.id}`}>#{estado.id}</Link> <strong>apto</strong> · {formatFechaHora(estado.creadoEn)} por {estado.usuario}.
      </p>
    );
  }
  return (
    <div className="aviso-local aviso-falla" role="alert">
      <p>
        {estado
          ? <>El último checklist del vehículo (<Link to={`/checklist/${estado.id}`}>#{estado.id}</Link>) lo marcó como <strong>no apto</strong>. Resolvé las fallas y hacé un checklist nuevo.</>
          : <>El vehículo no tiene checklist dentro de las 24 horas previas a la salida. Es condición para iniciar el gerenciamiento.</>}
      </p>
      {estado && estado.fallas.length > 0 && <ul>{estado.fallas.slice(0, 5).map((f) => <li key={f}>{f}</li>)}</ul>}
      <Link className="primary inline enlace-boton" to={`/checklist/nuevo?vehiculo=${vehiculoId}&volver=gerenciamiento`}>Hacer checklist vehicular</Link>
    </div>
  );
}
