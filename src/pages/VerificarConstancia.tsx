import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatFecha, formatFechaHora } from "../lib/registros";
import { MOTIVOS_CONSTANCIA, numeroConstancia, verificarConstancia, type Verificacion } from "../lib/constancias";

/**
 * Página pública: comprueba el código de verificación impreso en una constancia de gerenciamiento.
 * Muestra solo lo necesario para identificar el documento (no expone el detalle del trabajo).
 */
export default function VerificarConstancia() {
  const { hash = "" } = useParams();
  const [resultado, setResultado] = useState<Verificacion | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    verificarConstancia(hash)
      .then((r) => { if (activo) setResultado(r); })
      .catch((e: unknown) => { if (activo) setError(e instanceof Error ? e.message : "No se pudo verificar."); });
    return () => { activo = false; };
  }, [hash]);

  return (
    <main className="pagina-publica">
      <section className="panel panel-angosto">
        <h1 className="panel-header">Verificación de constancia</h1>
        <div className="panel-body">
          <p className="ayuda">Código: <code className="codigo-largo">{hash}</code></p>
          {error && <p className="error" role="alert">{error}</p>}
          {resultado === undefined && !error && <p className="estado">Verificando…</p>}
          {resultado === null && (
            <p className="aviso-anulado"><strong>No encontrado.</strong> Este código no corresponde a ninguna constancia emitida por Lifting Patagonia.</p>
          )}
          {resultado && (
            <>
              {resultado.integra
                ? <p className="exito"><strong>Documento auténtico.</strong> El contenido coincide con el que emitió el sistema.</p>
                : <p className="error"><strong>Atención:</strong> el contenido guardado no coincide con su código. Comunicate con la empresa.</p>}
              {resultado.version < resultado.ultimaVersion && (
                <p className="aviso-anulado">Esta es la versión {resultado.version}; existe una versión más nueva (v{resultado.ultimaVersion}) que la reemplaza.</p>
              )}
              <dl className="detalle">
                <div><dt>Constancia</dt><dd>{numeroConstancia({ gerenciamientoId: resultado.gerenciamiento, version: resultado.version })}</dd></div>
                <div><dt>Emitida</dt><dd>{formatFechaHora(resultado.emitidaEn)}</dd></div>
                <div><dt>Motivo</dt><dd>{MOTIVOS_CONSTANCIA[resultado.motivo]}</dd></div>
                <div><dt>Fecha del viaje</dt><dd>{resultado.fechaSalida ? formatFecha(resultado.fechaSalida) : "—"}</dd></div>
                <div><dt>Unidad</dt><dd>{resultado.vehiculo || "—"}</dd></div>
                <div><dt>Cliente</dt><dd>{resultado.cliente || "—"}</dd></div>
              </dl>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
