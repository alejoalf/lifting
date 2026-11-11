import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { agregar, hoy, type Observacion } from "../../lib/registros";

export const TIPOS_OBSERVACION = ["Acto Inseguro", "Condición Insegura", "Práctica Segura", "Detención de Tareas"];

export default function NuevaObservacion() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();
    const tipos = datos.getAll("tipos").map(String);

    if (tipos.length === 0) {
      setError("Marcá al menos un tipo de observación.");
      return;
    }
    if (texto("fechaDeteccion") > hoy()) {
      setError("La fecha de detección no puede ser futura.");
      return;
    }

    agregar("observaciones", {
      creadoPor: operador.id,
      reportadoPor: operador.nombre_completo,
      tipos,
      observador: texto("observador"),
      sectorObservador: texto("sectorObservador"),
      fechaDeteccion: texto("fechaDeteccion"),
      fechaCarga: hoy(),
      distrito: texto("distrito"),
      sector: texto("sector"),
      cliente: texto("cliente"),
      lugar: texto("lugar"),
      descripcion: texto("descripcion"),
      accion: texto("accion"),
      riesgo: texto("riesgo") as Observacion["riesgo"],
      seguimiento: datos.has("seguimiento"),
      estado: "abierta",
    });
    navigate("/observaciones");
  }

  return (
    <form className="panel panel-angosto" onSubmit={enviar}>
      <h2 className="panel-header">1. Datos principales</h2>
      <div className="panel-body">
        <fieldset className="check-row check-row-separada">
          <legend className="solo-lectores">Tipo de observación</legend>
          {TIPOS_OBSERVACION.map((tipo) => (
            <label className="check" key={tipo}><input type="checkbox" name="tipos" value={tipo} />{tipo}</label>
          ))}
        </fieldset>

        <fieldset className="grupo">
          <legend>¿Quién?</legend>
          <div className="form-grid">
            <label>Observador<input name="observador" placeholder="Ingresá el nombre" defaultValue={operador?.nombre_completo} required /></label>
            <label>Línea / sector<input name="sectorObservador" placeholder="Sector del observador" required /></label>
          </div>
        </fieldset>

        <fieldset className="grupo">
          <legend>¿Cuándo ocurrió?</legend>
          <div className="form-grid">
            <label>Fecha de detección<input type="date" name="fechaDeteccion" max={hoy()} required /></label>
            <label>Fecha de carga<input type="date" value={hoy()} readOnly disabled /></label>
          </div>
        </fieldset>

        <fieldset className="grupo">
          <legend>¿Dónde ocurrió?</legend>
          <div className="form-grid">
            <label>Distrito<input name="distrito" required /></label>
            <label>Línea / sector<input name="sector" required /></label>
            <label>Cliente<input name="cliente" /></label>
            <label>Lugar específico<input name="lugar" required /></label>
          </div>
        </fieldset>
      </div>

      <h2 className="panel-header">2. Detalle</h2>
      <div className="panel-body">
        <label>Descripción de lo observado<textarea name="descripcion" rows={4} required /></label>
        <label>Acción tomada<textarea name="accion" rows={3} /></label>
        <div className="form-grid">
          <label>Riesgo
            <select name="riesgo" defaultValue="" required>
              <option value="" disabled>Seleccioná</option><option>Bajo</option><option>Medio</option><option>Alto</option>
            </select>
          </label>
        </div>
        <div className="check-row">
          <label className="check"><input type="checkbox" name="seguimiento" />Necesita seguimiento</label>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary inline">Guardar tarjeta</button>
        </div>
      </div>
    </form>
  );
}
