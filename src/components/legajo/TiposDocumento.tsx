import { useState, type FormEvent } from "react";
import { getSupabase } from "../../lib/supabase";
import type { TipoDocumento } from "../../lib/legajos";

/** Alta y activación de tipos de documento (Admin), de personal o de vehículo. */
export function TiposDocumento({ aplicaA, tipos, onCambio }: {
  aplicaA: TipoDocumento["aplica_a"];
  tipos: TipoDocumento[];
  onCambio: () => Promise<void>;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function ejecutar(accion: PromiseLike<{ error: { message: string } | null }>) {
    setError("");
    setGuardando(true);
    try {
      const { error: fallo } = await accion;
      if (fallo) throw new Error(fallo.message);
      await onCambio();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function crear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const campos = new FormData(form);
    const creado = await ejecutar(getSupabase().from("tipos_documento").insert({
      nombre: String(campos.get("nombre") ?? "").trim(),
      requiere_vencimiento: campos.get("vence") === "on",
      aplica_a: aplicaA,
    }));
    if (creado) form.reset();
  }

  return (
    <section className="panel">
      <h2 className="panel-header">Tipos de documento{aplicaA === "vehiculo" ? " de vehículo" : ""}</h2>
      <div className="panel-body">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="table-wrap">
          <table className="tabla tabla-izquierda">
            <thead><tr><th>Tipo</th><th>Tiene vencimiento</th><th>Activo</th><th>Acciones</th></tr></thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id}>
                  <td>{t.nombre}</td>
                  <td>{t.requiere_vencimiento ? "Sí" : "No"}</td>
                  <td>{t.activo ? "Sí" : "No"}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={guardando}
                      onClick={() => void ejecutar(getSupabase().from("tipos_documento").update({ activo: !t.activo }).eq("id", t.id))}
                    >
                      {t.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {tipos.length === 0 && <tr><td colSpan={4} className="vacio">Todavía no hay tipos de documento.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="panel-header">Nuevo tipo de documento</h2>
      <form className="panel-body" onSubmit={crear}>
        <div className="form-grid">
          <label>Nombre<input name="nombre" placeholder={aplicaA === "vehiculo" ? "Ej.: VTV provincial" : "Ej.: Manejo defensivo"} required /></label>
        </div>
        <label className="check"><input type="checkbox" name="vence" defaultChecked /> Tiene fecha de vencimiento</label>
        <div className="actions">
          <button type="submit" className="primary inline" disabled={guardando}>Crear tipo</button>
        </div>
      </form>
    </section>
  );
}
