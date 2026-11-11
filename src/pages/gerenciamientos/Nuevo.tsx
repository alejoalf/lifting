import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { agregar, hoy } from "../../lib/registros";

export default function NuevoGerenciamiento() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const [segundoConductor, setSegundoConductor] = useState(false);
  const [error, setError] = useState("");

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    const salida = `${texto("fechaSalida")}T${texto("horaSalida")}`;
    const llegada = `${texto("fechaLlegada")}T${texto("horaLlegada")}`;
    if (llegada <= salida) {
      setError("La llegada tiene que ser posterior a la salida.");
      return;
    }

    agregar("gerenciamientos", {
      creadoPor: operador.id,
      creadoPorNombre: operador.nombre_completo,
      creadoEn: new Date().toISOString(),
      fechaSalida: texto("fechaSalida"),
      horaSalida: texto("horaSalida"),
      fechaLlegada: texto("fechaLlegada"),
      horaLlegada: texto("horaLlegada"),
      vehiculo: texto("vehiculo"),
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
      autorizacion: "pendiente",
      responsable: "",
      estado: "abierto",
    });
    navigate("/gerenciamientos");
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
          <label>Vehículo <small>(dominio o número interno)</small>
            <input name="vehiculo" placeholder="Ingresá dominio o número interno" required />
          </label>
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
          <button type="submit" className="primary inline">Guardar gerenciamiento</button>
        </div>
      </div>
    </form>
  );
}
