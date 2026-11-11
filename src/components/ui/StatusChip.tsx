export type Semaforo = "vigente" | "por-vencer" | "vencido";

const label: Record<Semaforo, string> = {
  vigente: "Vigente",
  "por-vencer": "Por vencer",
  vencido: "Vencido",
};

interface StatusChipProps {
  estado: Semaforo;
}

export function StatusChip({ estado }: StatusChipProps) {
  return <span className={`chip ${estado}`}>{label[estado]}</span>;
}
