import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabase, mensajeDeError } from "../../lib/supabase";
import { contiene } from "../../lib/registros";

interface Proveedor {
  id: string;
  razon_social: string;
  tipo: string | null;
  cuit: string | null;
  contacto: string | null;
}

const VACIO = { razon_social: "", tipo: "", cuit: "", contacto: "" };
/** Rubros habituales (se puede escribir cualquier otro). */
const TIPOS = ["Combustible", "Taller y repuestos", "Neumáticos", "Subalquiler de equipos", "Servicios profesionales", "Seguros", "Impuestos y organismos"];

/** Proveedores (Admin): alta, edición y baja. Se usan para vincular los egresos de la caja. */
export default function Proveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [campos, setCampos] = useState(VACIO);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    const { data, error: fallo } = await getSupabase().from("proveedores").select("id, razon_social, tipo, cuit, contacto").order("razon_social");
    if (fallo) setErrorCarga(`No se pudieron cargar los proveedores: ${mensajeDeError(fallo)}`);
    else {
      setProveedores(data ?? []);
      setErrorCarga("");
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  function editar(proveedor: Proveedor | null) {
    setEditando(proveedor);
    setCampos(proveedor
      ? { razon_social: proveedor.razon_social, tipo: proveedor.tipo ?? "", cuit: proveedor.cuit ?? "", contacto: proveedor.contacto ?? "" }
      : VACIO);
    setError("");
  }

  async function ejecutar(accion: () => PromiseLike<{ error: { message: string; code?: string } | null }>, mensaje: string, alBorrar = false) {
    setError("");
    setAviso("");
    setOcupado(true);
    try {
      const { error: fallo } = await accion();
      if (fallo) throw new Error(mensajeDeError(fallo, alBorrar));
      editar(null);
      await cargar();
      setAviso(mensaje);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setOcupado(false);
    }
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fila = {
      razon_social: campos.razon_social.trim(),
      tipo: campos.tipo.trim() || null,
      cuit: campos.cuit.trim() || null,
      contacto: campos.contacto.trim() || null,
    };
    const tabla = getSupabase().from("proveedores");
    void ejecutar(
      () => (editando ? tabla.update(fila).eq("id", editando.id) : tabla.insert(fila)),
      editando ? "Proveedor actualizado." : `Proveedor «${fila.razon_social}» agregado.`);
  }

  function eliminar(proveedor: Proveedor) {
    if (!window.confirm(`¿Eliminar a ${proveedor.razon_social}? Si tiene movimientos de caja vinculados no se puede eliminar.`)) return;
    void ejecutar(() => getSupabase().from("proveedores").delete().eq("id", proveedor.id), "Proveedor eliminado.", true);
  }

  if (!proveedores) return errorCarga ? <p className="error" role="alert">{errorCarga}</p> : <p className="estado">Cargando proveedores…</p>;

  const visibles = proveedores.filter((p) => contiene(`${p.razon_social} ${p.tipo ?? ""} ${p.cuit ?? ""} ${p.contacto ?? ""}`, busqueda));

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Proveedores</h2>
        <div className="panel-body">
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Razón social, rubro, CUIT o contacto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          </div>
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead><tr><th>Razón social</th><th>Rubro</th><th>CUIT</th><th>Contacto</th><th>Acciones</th></tr></thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id}>
                    <td>{p.razon_social}</td>
                    <td>{p.tipo || "—"}</td>
                    <td>{p.cuit || "—"}</td>
                    <td>{p.contacto || "—"}</td>
                    <td>
                      <div className="row">
                        <button type="button" className="secondary" disabled={ocupado} onClick={() => { setAviso(""); editar(p); }}>Editar</button>
                        <button type="button" className="secondary peligro" disabled={ocupado} onClick={() => eliminar(p)}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={5} className="vacio">{proveedores.length ? "Ningún proveedor coincide con la búsqueda." : "Todavía no hay proveedores cargados."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="resultados">Cantidad de resultados: {visibles.length}</p>
        </div>

        <h2 className="panel-header">{editando ? `Editar proveedor: ${editando.razon_social}` : "Nuevo proveedor"}</h2>
        <form className="panel-body" onSubmit={enviar}>
          <div className="form-grid">
            <label>Razón social
              <input value={campos.razon_social} onChange={(e) => setCampos({ ...campos, razon_social: e.target.value })} required />
            </label>
            <label>Rubro <small>(opcional)</small>
              <input list="rubros-proveedor" value={campos.tipo} onChange={(e) => setCampos({ ...campos, tipo: e.target.value })} />
              <datalist id="rubros-proveedor">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label>CUIT <small>(opcional)</small>
              <input inputMode="numeric" value={campos.cuit} onChange={(e) => setCampos({ ...campos, cuit: e.target.value })} placeholder="30-12345678-9" />
            </label>
            <label>Contacto <small>(opcional)</small>
              <input value={campos.contacto} onChange={(e) => setCampos({ ...campos, contacto: e.target.value })} placeholder="Nombre, teléfono o correo" />
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            {editando && <button type="button" className="secondary" disabled={ocupado} onClick={() => editar(null)}>Cancelar</button>}
            <button type="submit" className="primary inline" disabled={ocupado}>
              {ocupado ? "Guardando…" : editando ? "Guardar cambios" : "Agregar proveedor"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
