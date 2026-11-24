import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSupabase } from "../lib/supabase";

interface ParteEnlace {
  nro_parte: number;
  estado: string;
  origen: string;
  destino: string;
  tipo_tarea: string;
  documentos_vencidos: string[] | null;
  vehiculos: { dominio: string } | null;
  operadores: { nombre: string } | null;
}

/**
 * Página pública del enlace del mail de "pedido de salida excepcional".
 * No ejecuta nada al abrirse (los antivirus de correo abren los enlaces solos): el administrador confirma
 * con un botón. La firma del enlace la verifica la Edge Function "correos".
 */
export default function AutorizarSalida() {
  const [params] = useSearchParams();
  const enlace = { parte: params.get("parte") ?? "", op: params.get("op") ?? "", exp: params.get("exp") ?? "", firma: params.get("firma") ?? "" };
  const [accion, setAccion] = useState<"autorizar" | "frenar">(params.get("accion") === "frenar" ? "frenar" : "autorizar");
  const [datos, setDatos] = useState<{ parte: ParteEnlace; administrador: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let activo = true;
    getSupabase().functions.invoke("correos", { body: { accion: "ver", ...enlace } }).then(async ({ data, error: fallo }) => {
      if (!activo) return;
      if (fallo) {
        const cuerpo = await (fallo as { context?: Response }).context?.json?.().catch(() => null);
        setError(cuerpo?.error ?? "No se pudo abrir el pedido. El enlace puede haber vencido.");
        return;
      }
      setDatos(data);
    });
    return () => { activo = false; };
    // El enlace no cambia mientras la página está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accion === "frenar" && !motivo.trim()) return setError("Indicá el motivo por el que se frena la unidad.");
    setError("");
    setEnviando(true);
    const { data, error: fallo } = await getSupabase().functions.invoke("correos", { body: { accion, motivo, ...enlace } });
    setEnviando(false);
    if (fallo) {
      const cuerpo = await (fallo as { context?: Response }).context?.json?.().catch(() => null);
      return setError(cuerpo?.error ?? "No se pudo registrar la decisión.");
    }
    setResultado(String(data?.mensaje ?? "Listo."));
  }

  const parte = datos?.parte;
  const pendiente = parte?.estado === "Excepcion";

  return (
    <main className="pagina-publica">
      <section className="panel panel-angosto">
        <h1 className="panel-header">Pedido de salida excepcional</h1>
        <div className="panel-body">
          {!datos && !error && <p className="estado">Verificando el enlace…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {parte && (
            <>
              <dl className="detalle">
                <div><dt>Parte</dt><dd>N° {parte.nro_parte}</dd></div>
                <div><dt>Unidad</dt><dd>{parte.vehiculos?.dominio ?? "—"}</dd></div>
                <div><dt>Operador</dt><dd>{parte.operadores?.nombre ?? "—"}</dd></div>
                <div><dt>Tarea</dt><dd>{parte.tipo_tarea}</dd></div>
                <div><dt>Recorrido</dt><dd>{parte.origen} → {parte.destino}</dd></div>
              </dl>
              {(parte.documentos_vencidos ?? []).length > 0 && (
                <div className="aviso-local aviso-falla"><p>Motivos del bloqueo:</p><ul>{parte.documentos_vencidos!.map((m) => <li key={m}>{m}</li>)}</ul></div>
              )}

              {resultado ? (
                <p className="aviso-local aviso-ok" role="status">{resultado}</p>
              ) : !pendiente ? (
                <p className="aviso-local" role="status">Este pedido ya fue resuelto (estado actual: {parte.estado}).</p>
              ) : (
                <form onSubmit={confirmar}>
                  <fieldset className="segmento">
                    <legend>Decisión de {datos?.administrador}</legend>
                    <div className="segmento-opciones">
                      <label className={`segmento-opcion segmento-ingreso${accion === "autorizar" ? " is-active" : ""}`}>
                        <input type="radio" name="accion" checked={accion === "autorizar"} onChange={() => setAccion("autorizar")} />
                        Autorizar salida
                      </label>
                      <label className={`segmento-opcion segmento-egreso${accion === "frenar" ? " is-active" : ""}`}>
                        <input type="radio" name="accion" checked={accion === "frenar"} onChange={() => setAccion("frenar")} />
                        Frenar unidad
                      </label>
                    </div>
                  </fieldset>
                  {accion === "frenar" && (
                    <label>Motivo<textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></label>
                  )}
                  <div className="actions">
                    <button type="submit" className="primary inline" disabled={enviando}>
                      {enviando ? "Registrando…" : accion === "autorizar" ? "Confirmar: autorizar salida excepcional" : "Confirmar: frenar unidad"}
                    </button>
                  </div>
                  <p className="ayuda">Queda registrado a tu nombre. El operador recibe el aviso en la app.</p>
                </form>
              )}
            </>
          )}
          <p className="ayuda"><Link to="/login">Entrar a la app</Link></p>
        </div>
      </section>
    </main>
  );
}
