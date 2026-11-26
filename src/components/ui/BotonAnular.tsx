import { useEffect, useRef, useState } from "react";
import { formatFechaHora } from "../../lib/registros";

/** Datos de la anulación de un registro (null = vigente). */
export interface Anulacion {
  en: string;
  porId: string;
  motivo: string;
}

/** Lee las columnas anulado_en / anulado_por / motivo_anulacion de una fila de la base. */
export function aAnulacion(fila: Record<string, unknown>): Anulacion | null {
  if (!fila.anulado_en) return null;
  return { en: String(fila.anulado_en), porId: String(fila.anulado_por ?? ""), motivo: String(fila.motivo_anulacion ?? "") };
}

/** Etiqueta para listas y tablas. */
export function ChipAnulado({ anulacion }: { anulacion: Anulacion | null }) {
  if (!anulacion) return null;
  return <span className="chip anulado" title={`Motivo: ${anulacion.motivo}`}>Anulado</span>;
}

/** Aviso destacado en la ficha de un registro anulado. */
export function AvisoAnulado({ anulacion, quien }: { anulacion: Anulacion | null; quien?: string }) {
  if (!anulacion) return null;
  return (
    <p className="aviso-anulado" role="note">
      <strong>Anulado</strong> el {formatFechaHora(anulacion.en)}{quien ? ` por ${quien}` : ""}. Motivo: {anulacion.motivo}
    </p>
  );
}

const MINIMO_MOTIVO = 5;

/**
 * Botón "Anular" con confirmación y motivo obligatorio. Los registros no se borran:
 * quedan guardados y visibles como anulados. `onAnular` llama a la base (que valida quién puede).
 */
export function BotonAnular({ tipo, nombre, consecuencias = [], etiqueta = "Anular", onAnular }: {
  /** Qué se anula, con artículo: «el checklist», «la tarjeta». */
  tipo: string;
  nombre: string;
  consecuencias?: string[];
  etiqueta?: string;
  onAnular: (motivo: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  function cerrar() {
    if (!ocupado) setAbierto(false);
  }

  async function anular() {
    setOcupado(true);
    setError("");
    try {
      await onAnular(motivo.trim());
      setAbierto(false);
      setMotivo("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo anular.");
    } finally {
      setOcupado(false);
    }
  }

  const motivoValido = motivo.trim().length >= MINIMO_MOTIVO;

  return (
    <>
      <button type="button" className="secondary peligro" onClick={() => { setError(""); setAbierto(true); }}>
        {etiqueta}
      </button>
      <dialog
        ref={ref}
        className="dialogo-eliminar"
        aria-labelledby="dialogo-anular-titulo"
        onCancel={(e) => { e.preventDefault(); cerrar(); }}
        onClick={(e) => { if (e.target === ref.current) cerrar(); }}
      >
        {abierto && (
          <form className="dialogo-contenido" onSubmit={(e) => { e.preventDefault(); if (motivoValido) void anular(); }}>
            <div className="dialogo-icono" aria-hidden="true">!</div>
            <div>
              <h2 id="dialogo-anular-titulo">¿Anular {tipo}?</h2>
              <p className="dialogo-nombre">«{nombre}»</p>
              <p>No se borra: queda guardado y visible como <strong>anulado</strong>, con el motivo, quién y cuándo. Ya no se puede modificar.</p>
              {consecuencias.length > 0 && (
                <ul className="dialogo-consecuencias">
                  {consecuencias.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
              <label>
                Motivo de la anulación
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} required minLength={MINIMO_MOTIVO} autoFocus
                  placeholder="Ej.: cargado por error, se duplicó con el N° 123" />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
            <div className="dialogo-acciones">
              <button type="button" className="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</button>
              <button type="submit" className="boton-peligro" disabled={ocupado || !motivoValido}>
                {ocupado ? "Anulando…" : "Anular"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
