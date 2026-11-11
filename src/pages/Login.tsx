import { useState } from "react";
import { Navigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { homeFor } from "../auth/RequireRole";

export default function Login() {
  const { operador, session, loading, perfilError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          ? "Email o contraseña incorrectos."
          : `No se pudo iniciar sesión: ${error.message}`);
      }
    } catch {
      setError("No se pudo conectar con Supabase. Revisá la conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login">
      <h1>Lifting Patagonia</h1>
      <p>Ingresá con tu usuario para abrir el parte del día.</p>
      <form onSubmit={entrar}>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        {session && loading && <p className="estado">Cargando tu perfil…</p>}
        {session && perfilError && <p className="error">{perfilError}</p>}
        {session && !loading && !perfilError && !operador && <p className="error">Tu cuenta inició sesión, pero no está vinculada. Completá `auth_user_id` en la fila correspondiente de `operadores` con el UUID de Authentication.</p>}
        <button className="primary" disabled={submitting}>{submitting ? "Ingresando…" : "Ingresar"}</button>
      </form>
    </main>
  );
}
