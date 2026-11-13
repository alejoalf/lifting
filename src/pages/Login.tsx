import { useState } from "react";
import { Navigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { homeFor } from "../auth/RequireRole";

export default function Login() {
  const { operador, session, loading, perfilError, signOut } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [requestedRole, setRequestedRole] = useState("chofer");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (operador) return <Navigate to={homeFor(operador.rol)} replace />;

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === "Invalid login credentials"
          ? "El correo o la contraseña no son correctos."
          : `No se pudo iniciar sesión: ${error.message}`);
      }
    } catch {
      setError("No se pudo conectar con el servicio. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function registrarse(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name.trim(),
            requested_role: requestedRole,
          },
        },
      });

      if (error) {
        setError(`No se pudo crear la cuenta: ${error.message}`);
        return;
      }

      if (data.user?.identities?.length === 0) {
        setError("No se pudo completar el registro con ese correo. Si ya tenés una cuenta, iniciá sesión.");
        return;
      }

      setRegistrationComplete(true);
      setSuccess("Recibimos tu solicitud. Si te pedimos verificar el correo, revisá tu bandeja de entrada. El acceso quedará disponible cuando un administrador revise y apruebe tu solicitud.");

      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          setError("La solicitud se creó, pero no se pudo cerrar la sesión automáticamente. Cerrá la sesión antes de continuar.");
        }
      }
    } catch {
      setError("No se pudo conectar con el servicio. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function salirRegistro() {
    setError("");
    try {
      await signOut();
    } catch {
      setError("No se pudo cerrar la sesión. Intentá nuevamente.");
    }
  }

  function cambiarModo(nextMode: "login" | "register") {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setRegistrationComplete(false);
  }

  function manejarTeclaTab(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const nextMode = mode === "login" ? "register" : "login";
    cambiarModo(nextMode);
    document.getElementById(nextMode === "login" ? "login-tab" : "register-tab")?.focus();
  }

  return (
    <main className="login-page">
      <section className="login-intro" aria-label="Lifting Patagonia">
        <div className="login-intro-content">
          <a className="login-brand" href="/login" aria-label="Lifting Patagonia, inicio">
            <img src="/logo.png" alt="" width={828} height={682} />
            <span>Lifting <strong>Patagonia</strong></span>
          </a>

          <div className="login-message">
            <span className="login-eyebrow"><span aria-hidden="true" /> PORTAL OPERATIVO</span>
            <h1>Tu trabajo,<br />en movimiento.</h1>
            <p>Un solo lugar para organizar la operación, gestionar tu flota y mantener cada equipo en marcha.</p>
          </div>

          <div className="login-intro-footer">
            <span className="login-rule" aria-hidden="true" />
            <span>Fuerza y compromiso en cada camino.</span>
          </div>
        </div>
        <div className="login-art" aria-hidden="true">
          <span className="login-art-ring" />
          <span className="login-art-line" />
          <span className="login-art-dot" />
          <span className="login-art-word">LP</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-tabs" role="tablist" aria-label="Acceso al portal">
            <button
              id="login-tab"
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              aria-controls="login-tabpanel"
              tabIndex={mode === "login" ? 0 : -1}
              className={mode === "login" ? "is-active" : ""}
              onKeyDown={manejarTeclaTab}
              onClick={() => cambiarModo("login")}
            >
              Iniciar sesión
            </button>
            <button
              id="register-tab"
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              aria-controls="login-tabpanel"
              tabIndex={mode === "register" ? 0 : -1}
              className={mode === "register" ? "is-active" : ""}
              onKeyDown={manejarTeclaTab}
              onClick={() => cambiarModo("register")}
            >
              Registrarme
            </button>
          </div>

          <div className="login-form-heading">
            <span className="login-form-kicker">{mode === "login" ? "BIENVENIDO/A" : "NUEVA CUENTA"}</span>
            <h2>{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</h2>
            <p>{mode === "login" ? "Ingresá tus datos para continuar al portal." : "Completá tus datos y solicitá acceso al portal."}</p>
          </div>

          <div id="login-tabpanel" role="tabpanel" aria-labelledby={mode === "login" ? "login-tab" : "register-tab"}>
            {mode === "login" ? (
              <form className="login-form" onSubmit={entrar}>
                <label htmlFor="login-email">Correo electrónico</label>
                <div className="login-input-wrap">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="5" width="17" height="14" rx="2" />
                    <path d="m4.5 7 7.5 6 7.5-6" />
                  </svg>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="login-password-label">
                  <label htmlFor="login-password">Contraseña</label>
                </div>
                <div className="login-input-wrap">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <rect x="4.5" y="10" width="15" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
                  </svg>
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Ingresá tu contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>

                {error && <p className="login-notice login-notice-error" role="alert">{error}</p>}
                {session && loading && <p className="login-notice login-notice-info" role="status">Estamos preparando tu perfil…</p>}
                {session && perfilError && <p className="login-notice login-notice-error" role="alert">{perfilError}</p>}
                {session && !loading && !perfilError && !operador && (
                  <p className="login-notice login-notice-error" role="alert">
                    Tu cuenta inició sesión, pero todavía no está vinculada a un operador. Contactá al administrador para completar la configuración.
                  </p>
                )}

                <button className="login-submit" type="submit" disabled={submitting}>
                  <span>{submitting ? "Ingresando…" : "Ingresar al portal"}</span>
                  {!submitting && <span className="login-submit-arrow" aria-hidden="true">→</span>}
                </button>
              </form>
            ) : registrationComplete ? (
              <div className="login-complete">
                <span className="login-complete-icon" aria-hidden="true">✓</span>
                {success && <p className="login-notice login-notice-info" role="status">{success}</p>}
                {error && <p className="login-notice login-notice-error" role="alert">{error}</p>}
                {session && <button className="secondary" type="button" onClick={() => void salirRegistro()}>Cerrar sesión</button>}
                <button className="login-submit" type="button" onClick={() => cambiarModo("login")}>Volver a iniciar sesión</button>
              </div>
            ) : (
              <form className="login-form" onSubmit={registrarse}>
                <label htmlFor="register-name">Nombre y apellido</label>
                <div className="login-input-wrap">
                  <input
                    id="register-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Tu nombre completo"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    minLength={2}
                    required
                  />
                </div>

                <label htmlFor="register-email">Correo electrónico</label>
                <div className="login-input-wrap">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="5" width="17" height="14" rx="2" />
                    <path d="m4.5 7 7.5 6 7.5-6" />
                  </svg>
                  <input
                    id="register-email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <label htmlFor="register-role">Rol que solicitás</label>
                <div className="login-input-wrap login-select-wrap">
                  <select id="register-role" value={requestedRole} onChange={(e) => setRequestedRole(e.target.value)}>
                    <option value="chofer">Chofer</option>
                    <option value="hidrogrulero">Hidrogrulero</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <p className="login-role-help">El rol es una solicitud. Un administrador revisará y definirá el acceso final.</p>

                <label htmlFor="register-password">Contraseña</label>
                <div className="login-input-wrap">
                  <input
                    id="register-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>

                <label htmlFor="register-confirm-password">Confirmar contraseña</label>
                <div className="login-input-wrap">
                  <input
                    id="register-confirm-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repetí tu contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>

                {error && <p className="login-notice login-notice-error" role="alert">{error}</p>}
                <button className="login-submit" type="submit" disabled={submitting}>
                  <span>{submitting ? "Enviando solicitud…" : "Crear cuenta y solicitar acceso"}</span>
                  {!submitting && <span className="login-submit-arrow" aria-hidden="true">→</span>}
                </button>
              </form>
            )}
          </div>

          <p className="login-privacy">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Acceso seguro para personal autorizado
          </p>
        </div>
        <footer className="login-footer">© {new Date().getFullYear()} Lifting Patagonia <span>·</span> Todos los derechos reservados</footer>
      </section>
    </main>
  );
}
