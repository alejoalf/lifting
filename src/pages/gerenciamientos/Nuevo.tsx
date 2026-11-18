import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { hoy } from "../../lib/registros";
import { crearGerenciamiento } from "../../lib/operaciones";
import { useCatalogoPartes } from "../../lib/usePartes";

export default function NuevoGerenciamiento() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const { catalogo, loading: cargandoCatalogo, error: errorCatalogo } = useCatalogoPartes();
  const [segundoConductor, setSegundoConductor] = useState(false);
  const [vehiculoId, setVehiculoId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (cargandoCatalogo) return <p className="estado">Cargando vehículos y contratos…</p>;
  if (errorCatalogo) return <p className="error" role="alert">{errorCatalogo}</p>;

  // Contratos vigentes del cliente elegido; los que tienen vehículo asignado, solo para ese vehículo.
  const contratos = catalogo.contratos.filter((c) =>
    c.clienteId === clienteId && (!c.vehiculoId || c.vehiculoId === vehiculoId));
  const vehiculoElegido = catalogo.vehiculos.find((v) => v.id === vehiculoId);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador || guardando) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    const salida = `${texto("fechaSalida")}T${texto("horaSalida")}`;
    const llegada = `${texto("fechaLlegada")}T${texto("horaLlegada")}`;
    if (llegada <= salida) {
      setError("La llegada tiene que ser posterior a la salida.");
      return;
    }

    setError("");
    setGuardando(true);
    try {
      await crearGerenciamiento({
        fechaSalida: texto("fechaSalida"),
        horaSalida: texto("horaSalida"),
        fechaLlegada: texto("fechaLlegada"),
        horaLlegada: texto("horaLlegada"),
        vehiculo: vehiculoElegido?.nombre ?? "",
        vehiculoId: vehiculoId || null,
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
          <label>Fecha de salida<input type="date" name="fechaSalida" defaultValue={hoy()} required /></label>
          <label>Hora de salida<input type="time" name="horaSalida" required /></label>
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
          <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : "Guardar gerenciamiento"}</button>
        </div>
      </div>
    </form>
  );
}
