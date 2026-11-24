import { useState } from "react";
import { DialogoEliminar, type PedidoEliminar } from "./DialogoEliminar";

/**
 * Botón "Borrar" con confirmación. `onEliminar` borra en la base (que valida quién puede);
 * si falla, muestra el motivo debajo del botón.
 */
export function BotonEliminar({ tipo, nombre, consecuencias = [], etiqueta = "Borrar", aviso, onEliminar }: {
  /** Qué se borra, con artículo: «el checklist», «la tarjeta». */
  tipo: string;
  nombre: string;
  consecuencias?: string[];
  etiqueta?: string;
  aviso?: string;
  onEliminar: () => Promise<void>;
}) {
  const [pedido, setPedido] = useState<PedidoEliminar | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function eliminar() {
    setOcupado(true);
    setError("");
    try {
      await onEliminar();
      setPedido(null);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo borrar.");
      setPedido(null);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="secondary peligro"
        onClick={() => { setError(""); setPedido({ id: nombre, tipo, nombre, consecuencias, aviso: aviso ?? "Se borra de la base y no se puede deshacer." }); }}
      >
        {etiqueta}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <DialogoEliminar pedido={pedido} ocupado={ocupado} onCancelar={() => setPedido(null)} onEliminar={() => void eliminar()} />
    </>
  );
}
