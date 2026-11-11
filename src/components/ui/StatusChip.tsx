import type { Semaforo } from "../../lib/registros";

export type { Semaforo };

const label: Record<Semaforo, string> = {
  vigente: "Vigente",
  "por-vencer": "Por vencer",
  vencido: "Vencido",
};

/** Semáforo documental. Sin estado (null) significa que no hay documentos cargados. */
export function StatusChip({ estado }: { estado: Semaforo | null }) {
  if (!estado) return <span className="chip sin-datos">Sin documentos</span>;
  return <span className={`chip ${estado}`}>{label[estado]}</span>;
}
