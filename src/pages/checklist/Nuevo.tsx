import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { ITEMS_CHECKLIST, crearChecklist, type EstadoItem } from "../../lib/operaciones";

const OPCIONES: { valor: EstadoItem; texto: string }[] = [
  { valor: "bien", texto: "Bien" },
  { valor: "mal", texto: "Mal" },
  { valor: "na", texto: "No aplica" },
];

/** Checklist pre-uso del vehículo. Con algún ítem en "Mal" la unidad queda como no apta y se avisa a los supervisores. */
export default function NuevoChecklist() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const [estados, setEstados] = useState<Record<string, EstadoItem | "">>(() => Object.fromEntries(ITEMS_CHECKLIST.map((i) => [i, ""])));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const fallas = ITEMS_CHECKLIST.filter((i) => estados[i] === "mal");
  const completos = ITEMS_CHECKLIST.every((i) => estados[i] !== "");

  function marcarTodoBien() {
    setEstados((actuales) => Object.fromEntries(ITEMS_CHECKLIST.map((i) => [i, actuales[i] || "bien"])));
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador || guardando) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    if (!completos) return setError("Marcá todos los controles antes de guardar.");
    if (fallas.length > 0 && !texto("observaciones")) return setError("Describí en observaciones las fallas encontradas.");

    setError("");
    setGuardando(true);
    try {
      const id = await crearChecklist({
        vehiculo: texto("vehiculo"),
        conductor: texto("conductor"),
        km: texto("km") ? Number(texto("km")) : null,
        items: ITEMS_CHECKLIST.map((item) => ({ item, estado: estados[item] as EstadoItem })),
        observaciones: texto("observaciones"),
      });
      navigate(`/checklist/${id}`);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el checklist.");
      setGuardando(false);
    }
  }

  return (
    <form className="panel panel-angosto" onSubmit={enviar}>
      <h2 className="panel-header">1. Unidad</h2>
      <div className="panel-body">
        <div className="form-grid">
          <label>Vehículo <small>(dominio o número interno)</small>
            <input name="vehiculo" placeholder="Ingresá dominio o número interno" required />
          </label>
          <label>Conductor
            <input name="conductor" defaultValue={operador?.nombre_completo} required />
          </label>
          <label>Kilometraje <small>(opcional)</small>
            <input type="number" name="km" min="0" step="1" inputMode="numeric" />
          </label>
        </div>
      </div>

      <h2 className="panel-header panel-header-fila">
        2. Controles
        <button type="button" className="secondary" onClick={marcarTodoBien}>Marcar el resto como Bien</button>
      </h2>
      <div className="panel-body">
        <ul className="checklist-items">
          {ITEMS_CHECKLIST.map((item, indice) => (
            <li key={item} className={estados[item] === "mal" ? "checklist-falla" : undefined}>
              <fieldset className="segmento">
                <legend>{item}</legend>
                <div className="segmento-opciones tres">
                  {OPCIONES.map((opcion) => (
                    <label key={opcion.valor} className={`segmento-opcion segmento-${opcion.valor}${estados[item] === opcion.valor ? " is-active" : ""}`}>
                      <input
                        type="radio"
                        name={`item-${indice}`}
                        value={opcion.valor}
                        checked={estados[item] === opcion.valor}
                        onChange={() => setEstados((actuales) => ({ ...actuales, [item]: opcion.valor }))}
                      />
                      {opcion.texto}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ul>

        <label>Observaciones {fallas.length > 0 ? <small>(obligatorio: describí las fallas)</small> : <small>(opcional)</small>}
          <textarea name="observaciones" rows={3} required={fallas.length > 0} />
        </label>

        {fallas.length > 0 && (
          <p className="aviso-local" role="status">
            {fallas.length === 1 ? "Hay 1 control con falla" : `Hay ${fallas.length} controles con falla`}: la unidad quedará como <strong>no apta</strong> y se avisará a los supervisores.
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <Link className="secondary enlace-boton" to="/checklist">Cancelar</Link>
          <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : "Guardar checklist"}</button>
        </div>
      </div>
    </form>
  );
}
