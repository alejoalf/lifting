import { useEffect, useRef } from "react";

export interface PedidoEliminar {
  id: string;
  /** Qué se elimina, por ejemplo «el tramo». */
  tipo: string;
  nombre: string;
  /** Si está activo y hay onDesactivar, se ofrece desactivarlo en lugar de eliminarlo. */
  activo?: boolean;
  /** Qué más se borra o cambia al eliminarlo. */
  consecuencias: string[];
  /** Texto bajo el nombre; por defecto avisa que no se puede deshacer. */
  aviso?: string;
}

/**
 * Cuadro de confirmación para eliminar, con la opción de desactivar en su lugar.
 * Sin `onEliminar` solo ofrece desactivar (catálogos que no se borran, como la matriz de riesgos).
 */
export function DialogoEliminar({ pedido, ocupado, onCancelar, onEliminar, onDesactivar }: {
  pedido: PedidoEliminar | null; ocupado: boolean;
  onCancelar: () => void; onEliminar?: () => void; onDesactivar?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const puedeDesactivar = Boolean(pedido?.activo && onDesactivar);
  const soloDesactivar = !onEliminar;

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (pedido && !dialogo.open) dialogo.showModal();
    if (!pedido && dialogo.open) dialogo.close();
  }, [pedido]);

  return (
    <dialog
      ref={ref}
      className="dialogo-eliminar"
      aria-labelledby="dialogo-eliminar-titulo"
      onCancel={(e) => { e.preventDefault(); if (!ocupado) onCancelar(); }}
      onClick={(e) => { if (e.target === ref.current && !ocupado) onCancelar(); }}
    >
      {pedido && (
        <div className="dialogo-contenido">
          <div className="dialogo-icono" aria-hidden="true">!</div>
          <div>
            <h2 id="dialogo-eliminar-titulo">¿{soloDesactivar ? "Desactivar" : "Eliminar"} {pedido.tipo}?</h2>
            <p className="dialogo-nombre">«{pedido.nombre}»</p>
            {soloDesactivar ? (
              <p>{pedido.activo
                ? "Los datos no se borran: queda guardado pero deja de usarse. Lo podés volver a activar editándolo."
                : "Ya está desactivado. Para volver a usarlo, editalo y tildá «Activo»."}</p>
            ) : (
              <p>{pedido.aviso ?? "Esta acción no se puede deshacer y el cambio lo ven todos los usuarios al instante."}</p>
            )}
            {!soloDesactivar && pedido.consecuencias.length > 0 && (
              <ul className="dialogo-consecuencias">
                {pedido.consecuencias.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
            {puedeDesactivar && !soloDesactivar && (
              <p className="dialogo-sugerencia">
                Si solo querés que deje de usarse, podés <strong>desactivarlo</strong>: queda guardado y lo podés volver a activar.
              </p>
            )}
          </div>
          <div className="dialogo-acciones">
            <button type="button" className="secondary" onClick={onCancelar} disabled={ocupado} autoFocus>Cancelar</button>
            {puedeDesactivar && <button type="button" className="secondary" onClick={onDesactivar} disabled={ocupado}>Desactivar</button>}
            {onEliminar && (
              <button type="button" className="boton-peligro" onClick={onEliminar} disabled={ocupado}>
                {ocupado ? "Procesando…" : "Eliminar definitivamente"}
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
