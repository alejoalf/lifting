import { useState } from "react";
import { Navigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { homeFor } from "../auth/RequireRole";

export default function Login() {
  const { operador, session, loading, perfilError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (operador) return <Navigate to={homeFor(operador.rol)} replace />;

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
          <div className="login-form-heading">
            <span className="login-form-kicker">BIENVENIDO/A</span>
            <h2>Iniciar sesión</h2>
            <p>Ingresá tus datos para continuar al portal.</p>
          </div>

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

          <div className="login-register-note">
            <span className="login-register-icon" aria-hidden="true">+</span>
            <p><strong>¿Nuevo en el equipo?</strong><br />La opción para registrarte estará disponible próximamente.</p>
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
