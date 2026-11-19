import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getSupabase } from "../../lib/supabase";

interface Solicitud {
  nombre: string;
  email: string;
  rol_solicitado: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  /** false: la cuenta se creó con Google y la persona todavía no eligió el rol. */
  rol_confirmado?: boolean;
  proveedor?: string;
}

const ROLES = [
  { valor: "chofer", label: "Chofer" },
  { valor: "hidrogrulero", label: "Hidrogrulero" },
  { valor: "supervisor", label: "Supervisor" },
  { valor: "admin", label: "Administrador" },
];

const nombreRol = (valor: string) => ROLES.find((r) => r.valor === valor.toLocaleLowerCase("es"))?.label ?? valor;

/**
 * Cuenta con sesión iniciada que todavía no está vinculada a un operador: completa
 * la solicitud de acceso (cuentas creadas con Google), espera la aprobación o
 * ve que fue rechazada.
 */
export function EstadoCuenta() {
  const { session, signOut, recargarPerfil } = useAuth();
  const [solicitud, setSolicitud] = useState<Solicitud | null | undefined>(undefined);
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const userId = session?.user.id;

  const cargar = useCallback(async () => {
    if (!userId) return;
    const { data, error: fallo } = await getSupabase()
      .from("solicitudes_registro")
      .select("*")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (fallo) {
      setError("No se pudo consultar tu solicitud de acceso. Revisá la conexión e intentá de nuevo.");
      setSolicitud(null);
      return;
    }
    const s = data as Solicitud | null;
    setSolicitud(s);
    if (s) {
      setNombre(s.nombre);
      setRol(s.rol_confirmado === false ? "" : s.rol_solicitado.toLocaleLowerCase("es"));
    }
  }, [userId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAviso("");
    setEnviando(true);
    try {
      const { error: fallo } = await getSupabase().rpc("completar_solicitud_registro", { p_nombre: nombre, p_rol: rol });
      if (fallo) {
        setError(fallo.message);
        return;
      }
      setEditando(false);
      await cargar();
    } catch {
      setError("No se pudo conectar con el servicio. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  async function salir() {
    setError("");
    try {
      await signOut();
    } catch {
      setError("No se pudo cerrar la sesión. Intentá nuevamente.");
    }
  }

  async function verificar() {
    setAviso("");
    setError("");
    const { data, error: fallo } = await getSupabase().from("operadores").select("id").eq("auth_user_id", userId ?? "").maybeSingle();
    if (fallo) setError("No se pudo verificar tu acceso. Intentá de nuevo.");
    else if (data) recargarPerfil();
    else setAviso("Todavía no aprobaron tu solicitud. Probá de nuevo más tarde.");
  }

  const correo = solicitud?.email || session?.user.email || "";
  const completar = solicitud?.estado === "pendiente" && (solicitud.rol_confirmado === false || editando);

  let titulo = "Tu cuenta";
  let texto = "";
  if (solicitud === undefined) texto = "Consultando el estado de tu cuenta…";
  else if (solicitud === null) texto = "Tu cuenta inició sesión, pero no está vinculada a un operador ni tiene una solicitud de acceso. Contactá al administrador.";
  else if (completar) { titulo = "Completá tu solicitud"; texto = "Confirmá tu nombre y elegí el rol que solicitás. Un administrador revisará y definirá el acceso final."; }
  else if (solicitud.estado === "pendiente") { titulo = "Solicitud enviada"; texto = "Un administrador tiene que aprobar tu acceso. Cuando lo haga, vas a poder entrar al portal."; }
  else if (solicitud.estado === "rechazada") { titulo = "Solicitud rechazada"; texto = "Tu solicitud de acceso fue rechazada. Si creés que es un error, contactá al administrador."; }
  else texto = "Tu solicitud fue aprobada, pero la cuenta no está activa. Contactá al administrador.";

  return (
    <>
      <div className="login-form-heading">
        <span className="login-form-kicker">{correo || "TU CUENTA"}</span>
        <h2>{titulo}</h2>
        <p>{texto}</p>
      </div>

      {completar ? (
        <form className="login-form" onSubmit={(e) => void enviar(e)}>
          <label htmlFor="cuenta-nombre">Nombre y apellido</label>
          <div className="login-input-wrap">
            <input id="cuenta-nombre" type="text" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={2} required />
          </div>
          <label htmlFor="cuenta-rol">Rol que solicitás</label>
          <div className="login-input-wrap login-select-wrap">
            <select id="cuenta-rol" value={rol} onChange={(e) => setRol(e.target.value)} required>
              <option value="" disabled>Elegí un rol</option>
              {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
            </select>
          </div>
          <p className="login-role-help">El rol es una solicitud. Un administrador revisará y definirá el acceso final.</p>
          {error && <p className="login-notice login-notice-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={enviando || !rol}>
            <span>{enviando ? "Enviando…" : "Enviar solicitud"}</span>
            {!enviando && <span className="login-submit-arrow" aria-hidden="true">→</span>}
          </button>
          <button className="login-link-boton" type="button" onClick={() => void salir()}>Usar otra cuenta</button>
        </form>
      ) : (
        <div className="login-complete">
          {solicitud?.estado === "pendiente" && (
            <>
              <span className="login-complete-icon" aria-hidden="true">✓</span>
              <dl className="login-resumen">
                <div><dt>Nombre</dt><dd>{solicitud.nombre}</dd></div>
                <div><dt>Rol solicitado</dt><dd>{nombreRol(solicitud.rol_solicitado)}</dd></div>
              </dl>
            </>
          )}
          {error && <p className="login-notice login-notice-error" role="alert">{error}</p>}
          {aviso && <p className="login-notice login-notice-info" role="status">{aviso}</p>}
          {solicitud?.estado === "pendiente" && (
            <button className="login-submit" type="button" onClick={() => void verificar()}>
              <span>Ya me aprobaron: entrar</span>
              <span className="login-submit-arrow" aria-hidden="true">→</span>
            </button>
          )}
          {solicitud?.estado === "pendiente" && (
            <button className="login-link-boton" type="button" onClick={() => { setEditando(true); setAviso(""); }}>Corregir mis datos</button>
          )}
          <button className="secondary" type="button" onClick={() => void salir()}>Cerrar sesión</button>
        </div>
      )}
    </>
  );
}
