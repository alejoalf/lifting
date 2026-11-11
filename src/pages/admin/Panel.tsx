import { StatusChip } from "../../components/ui/StatusChip";
export default function AdminPanel() {
  return (
    <>
      <p className="vacio">Dashboard de unidades y vencimientos. Ejemplo de estado:</p>
      <div className="row"><StatusChip estado="vigente" /><StatusChip estado="por-vencer" /><StatusChip estado="vencido" /></div>
    </>
  );
}
