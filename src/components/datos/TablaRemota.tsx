import { useEffect, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { contiene } from "../../lib/registros";

type Fila = Record<string, unknown>;

const COLUMNAS_OCULTAS = ["id", "created_at", "updated_at"];

function mostrar(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "object") return JSON.stringify(valor);
  const texto = String(valor);
  const fecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  return fecha ? `${fecha[3]}/${fecha[2]}/${fecha[1]}` : texto;
}

interface TablaRemotaProps {
  /** Nombre de la tabla en Supabase. */
  tabla: string;
  titulo: string;
  /** Columnas que van primero, con su título. El resto de la tabla se agrega solo a la derecha. */
  etiquetas?: Record<string, string>;
  orden?: string;
  /** Columna por la que se arman los contadores y el filtro (por ejemplo "estado"). */
  agruparPor?: string;
}

/** Listado de solo lectura de una tabla de Supabase, con buscador. */
export function TablaRemota({ tabla, titulo, etiquetas = {}, orden, agruparPor }: TablaRemotaProps) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [grupo, setGrupo] = useState("");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let activo = true;
    setFilas(null);
    setError("");
    setBusqueda("");
    setGrupo("");
    const consulta = getSupabase().from(tabla).select("*");
    (orden ? consulta.order(orden) : consulta).then(({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) setError(`No se pudo cargar la tabla ${tabla}. Revisá la conexión y los permisos (RLS).`);
      else setFilas(data ?? []);
    });
    return () => { activo = false; };
  }, [tabla, orden, intento]);

  if (error) {
    return (
      <section className="panel">
        <h2 className="panel-header">{titulo}</h2>
        <div className="panel-body">
          <p className="error" role="alert">{error}</p>
          <div className="actions"><button type="button" className="secondary" onClick={() => setIntento((n) => n + 1)}>Reintentar</button></div>
        </div>
      </section>
    );
  }
  if (!filas) return <p className="estado">Cargando…</p>;

  const extras = [...new Set(filas.flatMap(Object.keys))].filter((c) => !(c in etiquetas) && !COLUMNAS_OCULTAS.includes(c));
  const columnas = [...Object.keys(etiquetas), ...extras];
  const encabezado = (c: string) => etiquetas[c] ?? c.replace(/_/g, " ").replace(/^./, (l) => l.toUpperCase());
  const grupos = agruparPor ? [...new Set(filas.map((f) => mostrar(f[agruparPor])))].sort() : [];
  const visibles = filas.filter((f) =>
    (!grupo || !agruparPor || mostrar(f[agruparPor]) === grupo) &&
    contiene(columnas.map((c) => mostrar(f[c])).join(" "), busqueda));

  return (
    <>
      {agruparPor && (
        <div className="stats">
          <div className="stat stat-total"><span className="stat-label">TOTAL</span><span className="stat-value">{filas.length}</span></div>
          {grupos.map((g) => (
            <div className="stat" key={g}>
              <span className="stat-label">{encabezado(agruparPor).toLocaleUpperCase("es")}: {g.toLocaleUpperCase("es")}</span>
              <span className="stat-value">{filas.filter((f) => mostrar(f[agruparPor]) === g).length}</span>
            </div>
          ))}
        </div>
      )}

      <section className="panel">
        <h2 className="panel-header">{titulo}</h2>
        <div className="panel-body">
          {filas.length === 0 ? (
            <p className="vacio">No hay registros para mostrar. Si la tabla tiene datos, revisá que tu usuario tenga permiso de lectura (RLS) sobre {tabla}.</p>
          ) : (
            <>
              <div className="form-grid compacto">
                <label>Buscar<input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
                {agruparPor && (
                  <label>{encabezado(agruparPor)}
                    <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                      <option value="">Todos</option>
                      {grupos.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="table-wrap">
                <table className="tabla tabla-izquierda">
                  <thead><tr>{columnas.map((c) => <th key={c}>{encabezado(c)}</th>)}</tr></thead>
                  <tbody>
                    {visibles.map((f, i) => (
                      <tr key={String(f.id ?? i)}>{columnas.map((c) => <td key={c}>{mostrar(f[c])}</td>)}</tr>
                    ))}
                    {visibles.length === 0 && <tr><td colSpan={columnas.length} className="vacio">Ningún registro coincide con la búsqueda.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="resultados">Cantidad de resultados: {visibles.length}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
