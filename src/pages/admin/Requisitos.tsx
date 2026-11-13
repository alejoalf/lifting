import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "../../lib/supabase";
import { useLegajos, type Actividad, type TipoDocumento } from "../../lib/legajos";

interface Cliente { id: string; razon_social: string }

const ACTIVIDAD_NUEVA = { id: "", nombre: "", descripcion: "", clienteId: "", activa: true, requisitos: [] as string[] };

/** Configuración (Admin): tipos de documento y qué documentos exige cada actividad. */
export default function Requisitos() {
  const { datos, error, refresh } = useLegajos();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [actividad, setActividad] = useState(ACTIVIDAD_NUEVA);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let activo = true;
    getSupabase().from("clientes").select("id, razon_social").order("razon_social").then(({ data }) => {
      if (activo && data) setClientes(data);
    });
    return () => { activo = false; };
  }, []);

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando…</p>;

  async function ejecutar(accion: () => PromiseLike<{ error: { message: string } | null }>, mensaje: string) {
    setFallo("");
    setAviso("");
    setGuardando(true);
    try {
      const { error: falloAccion } = await accion();
      if (falloAccion) throw new Error(falloAccion.message);
      await refresh();
      setAviso(mensaje);
      return true;
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function crearTipo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const campos = new FormData(form);
    const nombre = String(campos.get("nombre") ?? "").trim();
    const creado = await ejecutar(
      () => getSupabase().from("tipos_documento").insert({ nombre, requiere_vencimiento: campos.get("vence") === "on" }),
      `Tipo de documento «${nombre}» creado.`);
    if (creado) form.reset();
  }

  function cambiarTipo(tipo: TipoDocumento, cambios: Partial<TipoDocumento>) {
    return ejecutar(
      () => getSupabase().from("tipos_documento").update(cambios).eq("id", tipo.id),
      `Tipo de documento «${tipo.nombre}» actualizado.`);
  }

  async function guardarActividad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const guardada = await ejecutar(
      () => getSupabase().rpc("guardar_actividad_legajo", {
        p_id: actividad.id || null,
        p_nombre: actividad.nombre,
        p_descripcion: actividad.descripcion,
        p_cliente_id: actividad.clienteId || null,
        p_activa: actividad.activa,
        p_requisitos: actividad.requisitos,
      }),
      `Actividad «${actividad.nombre.trim()}» guardada.`);
    if (guardada) setActividad(ACTIVIDAD_NUEVA);
  }

  function editar(a: Actividad) {
    setActividad({
      id: a.id, nombre: a.nombre, descripcion: a.descripcion ?? "", clienteId: a.cliente_id ?? "",
      activa: a.activa, requisitos: a.requisitos,
    });
  }

  const tipo = (id: string) => datos.tipos.find((t) => t.id === id)?.nombre ?? "—";
  const tiposElegibles = datos.tipos.filter((t) => t.activo || actividad.requisitos.includes(t.id));

  return (
    <>
      {fallo && <p className="error" role="alert">{fallo}</p>}
      {aviso && <p className="exito" role="status">{aviso}</p>}

      <section className="panel">
        <h2 className="panel-header">Actividades y documentos que exigen</h2>
        <div className="panel-body">
          {datos.actividades.length === 0 ? <p className="vacio">Todavía no hay actividades. Creá la primera abajo.</p> : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead><tr><th>Actividad</th><th>Cliente</th><th>Documentos requeridos</th><th>Activa</th><th>Acciones</th></tr></thead>
                <tbody>
                  {datos.actividades.map((a) => (
                    <tr key={a.id}>
                      <td>{a.nombre}{a.descripcion && <><br /><small className="ayuda">{a.descripcion}</small></>}</td>
                      <td>{a.cliente ?? "Todos"}</td>
                      <td>{a.requisitos.length ? a.requisitos.map(tipo).sort().join(", ") : "Ninguno"}</td>
                      <td>{a.activa ? "Sí" : "No"}</td>
                      <td><button type="button" className="secondary" onClick={() => editar(a)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <h2 className="panel-header">{actividad.id ? "Editar actividad" : "Nueva actividad"}</h2>
        <form className="panel-body" onSubmit={guardarActividad}>
          <div className="form-grid">
            <label>Actividad
              <input placeholder="Ej.: Conducir pick up" value={actividad.nombre} onChange={(e) => setActividad({ ...actividad, nombre: e.target.value })} required />
            </label>
            <label>Cliente
              <select value={actividad.clienteId} onChange={(e) => setActividad({ ...actividad, clienteId: e.target.value })}>
                <option value="">Todos los clientes</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
              </select>
            </label>
            <label>Descripción <small>(opcional)</small>
              <input value={actividad.descripcion} onChange={(e) => setActividad({ ...actividad, descripcion: e.target.value })} />
            </label>
          </div>
          <fieldset className="grupo">
            <legend>Documentos requeridos</legend>
            {tiposElegibles.length === 0 && <p className="vacio">Primero creá los tipos de documento.</p>}
            <div className="check-row">
              {tiposElegibles.map((t) => (
                <label className="check" key={t.id}>
                  <input
                    type="checkbox"
                    checked={actividad.requisitos.includes(t.id)}
                    onChange={(e) => setActividad({
                      ...actividad,
                      requisitos: e.target.checked ? [...actividad.requisitos, t.id] : actividad.requisitos.filter((id) => id !== t.id),
                    })}
                  />
                  {t.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={actividad.activa} onChange={(e) => setActividad({ ...actividad, activa: e.target.checked })} />
            Actividad activa
          </label>
          <div className="actions">
            {actividad.id && <button type="button" className="secondary" onClick={() => setActividad(ACTIVIDAD_NUEVA)}>Cancelar</button>}
            <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : "Guardar actividad"}</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-header">Tipos de documento</h2>
        <div className="panel-body">
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>Tipo</th><th>Tiene vencimiento</th><th>Activo</th><th>Acciones</th></tr></thead>
              <tbody>
                {datos.tipos.map((t) => (
                  <tr key={t.id}>
                    <td>{t.nombre}</td>
                    <td>{t.requiere_vencimiento ? "Sí" : "No"}</td>
                    <td>{t.activo ? "Sí" : "No"}</td>
                    <td>
                      <button type="button" className="secondary" disabled={guardando} onClick={() => void cambiarTipo(t, { activo: !t.activo })}>
                        {t.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {datos.tipos.length === 0 && <tr><td colSpan={4} className="vacio">Todavía no hay tipos de documento.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <h2 className="panel-header">Nuevo tipo de documento</h2>
        <form className="panel-body" onSubmit={crearTipo}>
          <div className="form-grid">
            <label>Nombre<input name="nombre" placeholder="Ej.: Manejo defensivo" required /></label>
          </div>
          <label className="check"><input type="checkbox" name="vence" defaultChecked /> Tiene fecha de vencimiento</label>
          <div className="actions">
            <button type="submit" className="primary inline" disabled={guardando}>Crear tipo</button>
          </div>
        </form>
      </section>
    </>
  );
}
