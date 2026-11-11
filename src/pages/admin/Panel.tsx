import { useEffect, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { contiene } from "../../lib/registros";

type Vehiculo = Record<string, unknown>;

// Columnas conocidas de la tabla `vehiculos`, en el orden en que se muestran.
// Cualquier otra columna que tenga la tabla se agrega sola a la derecha.
const COLUMNAS_CONOCIDAS: Record<string, string> = {
  dominio: "Dominio",
  marca_modelo: "Marca / modelo",
  equipo: "Equipo",
  estado: "Estado",
};
const COLUMNAS_OCULTAS = ["id", "created_at", "updated_at"];

function titulo(columna: string) {
  const texto = columna.replace(/_/g, " ");
  return COLUMNAS_CONOCIDAS[columna] ?? texto[0].toUpperCase() + texto.slice(1);
}

function mostrar(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

export default function AdminPanel() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let activo = true;
    setVehiculos(null);
    setError("");
    getSupabase().from("vehiculos").select("*").order("dominio").then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) setError("No se pudo cargar la flota. Revisá la conexión y los permisos (RLS) de la tabla vehiculos.");
      else setVehiculos(data ?? []);
    });
    return () => { activo = false; };
  }, [intento]);

  if (error) {
    return (
      <section className="panel">
        <h2 className="panel-header">Flota</h2>
        <div className="panel-body">
          <p className="error" role="alert">{error}</p>
          <div className="actions"><button type="button" className="secondary" onClick={() => setIntento((n) => n + 1)}>Reintentar</button></div>
        </div>
      </section>
    );
  }
  if (!vehiculos) return <p className="estado">Cargando flota…</p>;

  const extras = [...new Set(vehiculos.flatMap(Object.keys))]
    .filter((c) => !(c in COLUMNAS_CONOCIDAS) && !COLUMNAS_OCULTAS.includes(c));
  const columnas = [...Object.keys(COLUMNAS_CONOCIDAS), ...extras];
  const estados = [...new Set(vehiculos.map((v) => mostrar(v.estado)))].sort();
  const filas = vehiculos.filter((v) =>
    (!estado || mostrar(v.estado) === estado) &&
    contiene(columnas.map((c) => mostrar(v[c])).join(" "), busqueda));

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">UNIDADES EN LA FLOTA</span><span className="stat-value">{vehiculos.length}</span></div>
        {estados.map((e) => (
          <div className="stat" key={e}>
            <span className="stat-label">ESTADO: {e.toLocaleUpperCase("es")}</span>
            <span className="stat-value">{vehiculos.filter((v) => mostrar(v.estado) === e).length}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2 className="panel-header">Unidades</h2>
        <div className="panel-body">
          {vehiculos.length === 0 ? (
            <p className="vacio">No hay vehículos para mostrar. Si la tabla tiene datos, revisá que tu usuario tenga permiso de lectura (RLS) sobre vehiculos.</p>
          ) : (
            <>
              <div className="form-grid compacto">
                <label>Buscar<input placeholder="Dominio, marca, equipo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
                <label>Estado
                  <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                    <option value="">Todos</option>
                    {estados.map((e) => <option key={e}>{e}</option>)}
                  </select>
                </label>
              </div>
              <div className="table-wrap">
                <table className="tabla tabla-izquierda">
                  <thead><tr>{columnas.map((c) => <th key={c}>{titulo(c)}</th>)}</tr></thead>
                  <tbody>
                    {filas.map((v, i) => (
                      <tr key={String(v.id ?? i)}>{columnas.map((c) => <td key={c}>{mostrar(v[c])}</td>)}</tr>
                    ))}
                    {filas.length === 0 && <tr><td colSpan={columnas.length} className="vacio">Ninguna unidad coincide con los filtros.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="resultados">Cantidad de resultados: {filas.length}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
