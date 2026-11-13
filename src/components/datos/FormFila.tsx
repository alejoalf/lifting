import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatFecha } from "../../lib/registros";
import { etiquetaColumna, texto, type Columna, type Fila, type Opcion } from "../../lib/comercial";

type Valores = Record<string, string | boolean>;

/** Valores habituales para columnas de texto libre. */
const SUGERENCIAS: Record<string, string[]> = {
  condicion_iva: ["Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final"],
};
type Referencias = Record<string, Opcion[]>;

/** Formulario de alta o edición armado a partir de las columnas reales de la tabla. */
export function FormFila({ columnas, fila, referencias = {}, iniciales = {}, guardar, onGuardado, textoNuevo }: {
  columnas: Columna[];
  fila: Fila | null;
  /** Opciones para las columnas que apuntan a otra tabla (cliente_id, vehiculo_id...). */
  referencias?: Referencias;
  /** Valores precargados al dar de alta. */
  iniciales?: Record<string, string>;
  guardar: (datos: Record<string, unknown>) => Promise<string>;
  onGuardado: (id: string) => Promise<void> | void;
  textoNuevo: string;
}) {
  const [valores, setValores] = useState<Valores>(() => Object.fromEntries(columnas.map((c) => {
    const valor = fila ? fila[c.columna] : iniciales[c.columna];
    return [c.columna, c.tipo === "booleano" ? valor === true : Array.isArray(valor) ? valor.join(", ") : texto(valor)];
  })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cambiar = (columna: string, valor: string | boolean) => setValores((actuales) => ({ ...actuales, [columna]: valor }));

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setGuardando(true);
    try {
      const datos = Object.fromEntries(columnas.map((c) => {
        const valor = valores[c.columna];
        if (typeof valor === "boolean") return [c.columna, valor];
        const limpio = valor.trim();
        if (c.tipo === "lista") return [c.columna, limpio.split(/[,;\s]+/).filter(Boolean)];
        return [c.columna, limpio === "" ? null : c.tipo === "numero" ? Number(limpio) : limpio];
      }));
      await onGuardado(await guardar(datos));
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="form-grid">
        {columnas.map((c) => {
          const valor = valores[c.columna];
          const etiqueta = <>{etiquetaColumna(c.columna)}<small>{c.tipo === "lista" ? " (separados por coma)" : c.obligatoria ? "" : " (opcional)"}</small></>;
          const opciones = referencias[c.columna] ?? (c.tipo === "enum" ? (c.opciones ?? []).map((o) => ({ id: o, nombre: o })) : null);
          if (typeof valor === "boolean") {
            return (
              <div key={c.columna}>
                <label className="check"><input type="checkbox" checked={valor} onChange={(e) => cambiar(c.columna, e.target.checked)} /> {etiquetaColumna(c.columna)}</label>
              </div>
            );
          }
          if (opciones) {
            return (
              <label key={c.columna}>{etiqueta}
                <select value={valor} onChange={(e) => cambiar(c.columna, e.target.value)} required={c.obligatoria}>
                  <option value="">{c.obligatoria ? "Elegí una opción" : "Sin definir"}</option>
                  {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </label>
            );
          }
          return (
            <label key={c.columna}>{etiqueta}
              <input
                type={c.tipo === "fecha" ? "date" : c.tipo === "numero" ? "number" : "text"}
                step={c.tipo === "numero" ? "any" : undefined}
                value={valor}
                onChange={(e) => cambiar(c.columna, e.target.value)}
                required={c.obligatoria}
                list={SUGERENCIAS[c.columna] ? `sugerencias-${c.columna}` : undefined}
              />
              {SUGERENCIAS[c.columna] && (
                <datalist id={`sugerencias-${c.columna}`}>{SUGERENCIAS[c.columna].map((s) => <option key={s} value={s} />)}</datalist>
              )}
            </label>
          );
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary inline" disabled={guardando}>
          {guardando ? "Guardando…" : fila ? "Guardar cambios" : textoNuevo}
        </button>
      </div>
    </form>
  );
}

function mostrar(valor: unknown, opciones?: Opcion[]) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (opciones) return opciones.find((o) => o.id === valor)?.nombre ?? "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (Array.isArray(valor)) return valor.length ? valor.join(", ") : "—";
  if (typeof valor === "object") return JSON.stringify(valor);
  const cadena = String(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(cadena) ? formatFecha(cadena) : cadena;
}

/** Texto de una fila para el buscador: todos sus valores tal como se muestran. */
export function textoFila(columnas: Columna[], fila: Fila, referencias: Referencias = {}) {
  return columnas.map((c) => mostrar(fila[c.columna], referencias[c.columna])).join(" ");
}

/** Listado de filas de una tabla; la primera columna enlaza a la ficha. */
export function TablaFilas({ columnas, filas, referencias = {}, ocultar = [], enlace, extra, vacio }: {
  columnas: Columna[];
  filas: Fila[];
  referencias?: Referencias;
  /** Columnas que no se muestran (por ejemplo el cliente, dentro de la ficha del cliente). */
  ocultar?: string[];
  enlace: (fila: Fila) => string;
  /** Columna adicional calculada, al final. */
  extra?: { titulo: string; celda: (fila: Fila) => ReactNode };
  vacio: string;
}) {
  const visibles = columnas.filter((c) => !ocultar.includes(c.columna));
  if (filas.length === 0) return <p className="vacio">{vacio}</p>;

  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead>
          <tr>{visibles.map((c) => <th key={c.columna}>{etiquetaColumna(c.columna)}</th>)}{extra && <th>{extra.titulo}</th>}<th>Acciones</th></tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.id}>
              {visibles.map((c, i) => {
                const valor = mostrar(fila[c.columna], referencias[c.columna]);
                return <td key={c.columna}>{i === 0 ? <Link to={enlace(fila)}>{valor}</Link> : valor}</td>;
              })}
              {extra && <td>{extra.celda(fila)}</td>}
              <td><Link className="secondary enlace-boton" to={enlace(fila)}>Abrir</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Zona de baja al pie de una ficha. */
export function ZonaEliminar({ titulo, ayuda, confirmacion, eliminar }: {
  titulo: string;
  ayuda: string;
  confirmacion: string;
  eliminar: () => Promise<void>;
}) {
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState("");

  async function confirmar() {
    if (!window.confirm(confirmacion)) return;
    setError("");
    setEliminando(true);
    try {
      await eliminar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo eliminar.");
      setEliminando(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-header">{titulo}</h2>
      <div className="panel-body">
        <p className="ayuda">{ayuda}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="secondary peligro" disabled={eliminando} onClick={() => void confirmar()}>
            {eliminando ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </div>
    </section>
  );
}
