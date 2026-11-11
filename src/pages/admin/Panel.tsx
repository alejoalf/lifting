import { Shell, Chip } from "../../components";
export default function AdminPanel() {
  return (
    <Shell titulo="Flota">
      <p className="vacio">Dashboard de unidades y vencimientos. Ejemplo de estado:</p>
      <div className="row"><Chip estado="vigente" /><Chip estado="por-vencer" /><Chip estado="vencido" /></div>
    </Shell>
  );
}
