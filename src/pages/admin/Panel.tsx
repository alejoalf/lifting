import { AppShell } from "../../components/layout/AppShell";
import { StatusChip } from "../../components/ui/StatusChip";
export default function AdminPanel() {
  return (
    <AppShell titulo="Flota">
      <p className="vacio">Dashboard de unidades y vencimientos. Ejemplo de estado:</p>
      <div className="row"><StatusChip estado="vigente" /><StatusChip estado="por-vencer" /><StatusChip estado="vencido" /></div>
    </AppShell>
  );
}
