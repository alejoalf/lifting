import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabase, mensajeDeError } from "../../lib/supabase";
import { contiene } from "../../lib/registros";

// Qué documentos pide el checklist vehicular de cada flota y con qué peso.
// Los documentos se cargan en el Legajo (conductor) y en Flota (vehículo); acá solo se configura su uso.

type Peso = "" | "informativo" | "condicionante";

interface Tipo {
  id: string;
  nombre: string;
  aplica_a: "operador" | "vehiculo";
  requiere_vencimiento: boolean;
  activo: boolean;
  clave: string;
  checklist_pesada: Peso;
  checklist_liviana: Peso;
  solo_semi: boolean;
  admite_na: boolean;
  con_clase: boolean;
}

const PESOS: { valor: Peso; texto: string }[] = [
  { valor: "", texto: "No lo pide" },
  { valor: "informativo", texto: "Informativo" },
  { valor: "condicionante", texto: "Condicionante" },
];

/** Clave a partir del nombre: "VTV provincial" -> "vtv_provincial". */
function claveDe(nombre: string) {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function aTipo(f: Record<string, unknown>): Tipo {
  const peso = (v: unknown): Peso => (v === "informativo" || v === "condicionante" ? v : "");
  return {
    id: String(f.id),
    nombre: String(f.nombre ?? ""),
    aplica_a: f.aplica_a === "vehiculo" ? "vehiculo" : "operador",
    requiere_vencimiento: f.requiere_vencimiento === true,
    activo: f.activo === true,
    clave: String(f.clave ?? ""),
    checklist_pesada: peso(f.checklist_pesada),
    checklist_liviana: peso(f.checklist_liviana),
    solo_semi: f.solo_semi === true,
    admite_na: f.admite_na === true,
    con_clase: f.con_clase === true,
  };
}

/** Datos a guardar: sin clave se arma del nombre si el checklist lo pide. */
function aFila(t: Omit<Tipo, "id">) {
  const pide = t.checklist_pesada || t.checklist_liviana;
  const clave = t.clave.trim() ? claveDe(t.clave) : pide ? claveDe(t.nombre) : "";
  return {
    nombre: t.nombre.trim(),
    aplica_a: t.aplica_a,
    requiere_vencimiento: t.requiere_vencimiento,
    activo: t.activo,
    clave: clave || null,
    checklist_pesada: t.checklist_pesada || null,
    checklist_liviana: t.checklist_liviana || null,
    solo_semi: t.aplica_a === "vehiculo" && t.solo_semi,
    admite_na: t.admite_na,
    con_clase: t.aplica_a === "operador" && t.con_clase,
  };
}

function FilaTipo({ tipo, onGuardado }: { tipo: Tipo; onGuardado: () => Promise<void> }) {
  const [valor, setValor] = useState(tipo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cambiado = JSON.stringify(valor) !== JSON.stringify(tipo);
  const set = (cambio: Partial<Tipo>) => setValor({ ...valor, ...cambio });

  async function guardar() {
    setError("");
    setGuardando(true);
    const { error: fallo } = await getSupabase().from("tipos_documento").update(aFila(valor)).eq("id", tipo.id);
    setGuardando(false);
    if (fallo) return setError(mensajeDeError(fallo));
    await onGuardado();
  }

  const casilla = (campo: "solo_semi" | "admite_na" | "con_clase" | "requiere_vencimiento" | "activo", deshabilitado = false) => (
    <input type="checkbox" checked={valor[campo]} disabled={deshabilitado} onChange={(e) => set({ [campo]: e.target.checked })} />
  );

  return (
    <tr className={cambiado ? "fila-cambiada" : undefined}>
      <td>
        <strong>{tipo.nombre}</strong>
        <br /><small className="ayuda">{tipo.aplica_a === "vehiculo" ? "Flota" : "Legajo"}</small>
        {error && <><br /><small className="texto-alto">{error}</small></>}
      </td>
      <td>
        <input className="select-tabla" value={valor.clave} placeholder={valor.checklist_pesada || valor.checklist_liviana ? claveDe(valor.nombre) : "—"}
          onChange={(e) => set({ clave: e.target.value })} aria-label={`Clave de ${tipo.nombre}`} />
      </td>
      <td>
        <select className="select-tabla" value={valor.checklist_pesada} onChange={(e) => set({ checklist_pesada: e.target.value as Peso })} aria-label={`Flota pesada: ${tipo.nombre}`}>
          {PESOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
        </select>
      </td>
      <td>
        <select className="select-tabla" value={valor.checklist_liviana} onChange={(e) => set({ checklist_liviana: e.target.value as Peso })} aria-label={`Flota liviana: ${tipo.nombre}`}>
          {PESOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
        </select>
      </td>
      <td className="centro">{casilla("solo_semi", tipo.aplica_a !== "vehiculo")}</td>
      <td className="centro">{casilla("admite_na")}</td>
      <td className="centro">{casilla("con_clase", tipo.aplica_a !== "operador")}</td>
      <td className="centro">{casilla("requiere_vencimiento")}</td>
      <td className="centro">{casilla("activo")}</td>
      <td>
        <button type="button" className="secondary" disabled={!cambiado || guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {cambiado && <button type="button" className="text-button" onClick={() => setValor(tipo)}>Deshacer</button>}
      </td>
    </tr>
  );
}

const NUEVO: Omit<Tipo, "id"> = {
  nombre: "", aplica_a: "vehiculo", requiere_vencimiento: true, activo: true, clave: "",
  checklist_pesada: "", checklist_liviana: "", solo_semi: false, admite_na: false, con_clase: false,
};

/** Admin: qué documentos pide el checklist de flota pesada y liviana, y cuáles son condicionantes. */
export default function DocumentosChecklist() {
  const [tipos, setTipos] = useState<Tipo[] | null>(null);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<"" | "operador" | "vehiculo" | "checklist">("");
  const [nuevo, setNuevo] = useState(NUEVO);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState("");

  const refresh = useCallback(async () => {
    const { data, error: fallo } = await getSupabase().from("tipos_documento").select("*").order("aplica_a", { ascending: false }).order("nombre");
    if (fallo) return setError(mensajeDeError(fallo));
    setError("");
    setTipos((data ?? []).map(aTipo));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function crear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAviso("");
    setCreando(true);
    const { error: fallo } = await getSupabase().from("tipos_documento").insert(aFila(nuevo));
    setCreando(false);
    if (fallo) return setError(mensajeDeError(fallo));
    setNuevo(NUEVO);
    setAviso("Tipo de documento creado.");
    await refresh();
  }

  if (!tipos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando tipos de documento…</p>;

  const visibles = tipos.filter((t) =>
    contiene(`${t.nombre} ${t.clave}`, busqueda) &&
    (!filtro || (filtro === "checklist" ? !!(t.checklist_pesada || t.checklist_liviana) : t.aplica_a === filtro)));
  const enChecklist = (flota: "checklist_pesada" | "checklist_liviana") => tipos.filter((t) => t.activo && t[flota]);

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">TIPOS DE DOCUMENTO</span><span className="stat-value">{tipos.length}</span></div>
        <div className="stat stat-info"><span className="stat-label">CHECKLIST PESADA</span><span className="stat-value">{enChecklist("checklist_pesada").length}</span>
          <span className="stat-detalle">{enChecklist("checklist_pesada").filter((t) => t.checklist_pesada === "condicionante").length} condicionantes</span></div>
        <div className="stat stat-info"><span className="stat-label">CHECKLIST LIVIANA</span><span className="stat-value">{enChecklist("checklist_liviana").length}</span>
          <span className="stat-detalle">{enChecklist("checklist_liviana").filter((t) => t.checklist_liviana === "condicionante").length} condicionantes</span></div>
      </div>

      <section className="panel">
        <h2 className="panel-header">Documentos que pide el checklist vehicular</h2>
        <div className="panel-body">
          <p className="ayuda">
            Los documentos se cargan una sola vez: los del conductor en su <strong>Legajo</strong> y los del vehículo en <strong>Flota</strong>.
            Acá se define cuáles revisa el checklist de cada flota. Un documento <strong>condicionante</strong> faltante, en revisión o vencido
            deja la unidad no apta; uno <strong>informativo</strong> solo se muestra. Los tipos con la misma <strong>clave</strong> cuentan como
            el mismo requisito (por ejemplo, VTV provincial y VTV nacional).
          </p>
          <div className="form-grid compacto">
            <label>Buscar<input value={busqueda} placeholder="Nombre o clave" onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Mostrar
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
                <option value="">Todos</option>
                <option value="checklist">Solo los que pide el checklist</option>
                <option value="operador">Del conductor (Legajo)</option>
                <option value="vehiculo">Del vehículo (Flota)</option>
              </select>
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="table-wrap">
            <table className="tabla tabla-izquierda tabla-config">
              <thead>
                <tr>
                  <th>Documento</th><th>Clave</th><th>Flota pesada</th><th>Flota liviana</th>
                  <th title="Solo si el vehículo opera con semirremolque">Solo con semi</th>
                  <th title="El conductor puede marcarlo como No aplica (ej. cargas peligrosas)">Admite N/A</th>
                  <th title="Licencias con clase (ej. C, E1)">Con clase</th>
                  <th>Vence</th><th>Activo</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((t) => <FilaTipo key={`${t.id}-${JSON.stringify(t)}`} tipo={t} onGuardado={refresh} />)}
                {visibles.length === 0 && <tr><td colSpan={10} className="vacio">Ningún tipo coincide con la búsqueda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <h2 className="panel-header">Nuevo tipo de documento</h2>
        <form className="panel-body" onSubmit={crear}>
          <div className="form-grid">
            <label>Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej.: Habilitación de grúa" required /></label>
            <label>Se carga en
              <select value={nuevo.aplica_a} onChange={(e) => setNuevo({ ...nuevo, aplica_a: e.target.value as Tipo["aplica_a"] })}>
                <option value="vehiculo">Flota (documento del vehículo)</option>
                <option value="operador">Legajo (documento del conductor)</option>
              </select>
            </label>
            <label>Flota pesada
              <select value={nuevo.checklist_pesada} onChange={(e) => setNuevo({ ...nuevo, checklist_pesada: e.target.value as Peso })}>
                {PESOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
              </select>
            </label>
            <label>Flota liviana
              <select value={nuevo.checklist_liviana} onChange={(e) => setNuevo({ ...nuevo, checklist_liviana: e.target.value as Peso })}>
                {PESOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
              </select>
            </label>
            <label>Clave <small>(opcional)</small><input value={nuevo.clave} placeholder={nuevo.nombre ? claveDe(nuevo.nombre) : "Se arma del nombre"} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })} /></label>
          </div>
          <div className="check-row">
            <label className="check"><input type="checkbox" checked={nuevo.requiere_vencimiento} onChange={(e) => setNuevo({ ...nuevo, requiere_vencimiento: e.target.checked })} />Tiene vencimiento</label>
            <label className="check"><input type="checkbox" checked={nuevo.admite_na} onChange={(e) => setNuevo({ ...nuevo, admite_na: e.target.checked })} />Admite «No aplica»</label>
            {nuevo.aplica_a === "vehiculo"
              ? <label className="check"><input type="checkbox" checked={nuevo.solo_semi} onChange={(e) => setNuevo({ ...nuevo, solo_semi: e.target.checked })} />Solo con semirremolque</label>
              : <label className="check"><input type="checkbox" checked={nuevo.con_clase} onChange={(e) => setNuevo({ ...nuevo, con_clase: e.target.checked })} />Licencia con clase</label>}
          </div>
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <div className="actions">
            <button type="submit" className="primary inline" disabled={creando}>{creando ? "Creando…" : "Crear tipo"}</button>
          </div>
        </form>
      </section>
    </>
  );
}
