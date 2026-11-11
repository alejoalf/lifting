import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";

interface AppShellProps {
  titulo: string;
  children: ReactNode;
}

export function AppShell({ titulo, children }: AppShellProps) {
  const { operador, signOut } = useAuth();

  return (
    <>
      <header className="top">
        <div>
          <strong>Lifting Patagonia</strong>
          <span className="rol">{operador?.nombre_completo} · {operador?.rol}</span>
        </div>
        <button className="link" onClick={signOut}>Salir</button>
      </header>
      <main>
        <h1>{titulo}</h1>
        {children}
      </main>
    </>
  );
}
