import { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider";

export type Semaforo = "vigente" | "por-vencer" | "vencido";
const label: Record<Semaforo, string> = { vigente: "Vigente", "por-vencer": "Por vencer", vencido: "Vencido" };

export const Chip = ({ estado }: { estado: Semaforo }) => (
  <span className={`chip ${estado}`}>{label[estado]}</span>
);

export function Shell({ titulo, children }: { titulo: string; children: ReactNode }) {
  const { operador, signOut } = useAuth();
  return (
    <>
      <header className="top">
        <div><strong>Lifting Patagonia</strong><span className="rol">{operador?.nombre_completo} · {operador?.rol}</span></div>
        <button className="link" onClick={signOut}>Salir</button>
      </header>
      <main><h1>{titulo}</h1>{children}</main>
    </>
  );
}
