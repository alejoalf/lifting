import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, Operador } from "../lib/supabase";

interface AuthState {
  session: Session | null;
  operador: Operador | null;
  loading: boolean;
  perfilError: string | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

function parseRol(value: string): Operador["rol"] | null {
  const rol = value.trim().toLocaleLowerCase("es");
  if (rol === "chofer" || rol === "hidrogrulero" || rol === "supervisor" || rol === "admin") {
    return rol;
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [operador, setOperador] = useState<Operador | null>(null);
  const [loading, setLoading] = useState(true);
  const [perfilError, setPerfilError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setOperador(null);
      setPerfilError(null);
      setLoading(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();
    const authUserId = session.user.id;
    setLoading(true);
    setPerfilError(null);

    async function cargarOperador() {
      const { data, error } = await supabase
        .from("operadores")
        .select("auth_user_id, nombre, rol")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setOperador(null);
        setPerfilError("No se pudo consultar tu perfil en operadores. Revisá las políticas RLS de Supabase.");
      } else if (!data) {
        setOperador(null);
      } else {
        const rol = parseRol(data.rol);
        if (!rol) {
          setOperador(null);
          setPerfilError(`El rol "${data.rol}" no es válido para la app.`);
        } else {
          setOperador({
            id: data.auth_user_id,
            nombre_completo: data.nombre,
            rol,
          });
        }
      }

      setLoading(false);
    }

    void cargarOperador();
    return () => {
      active = false;
    };
  }, [session]);

  return (
    <Ctx.Provider value={{
      session,
      operador,
      loading,
      perfilError,
      signOut: async () => {
        const { error } = await getSupabase().auth.signOut();
        if (error) throw error;
      },
    }}>
      {children}
    </Ctx.Provider>
  );
}
