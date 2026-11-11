import { AppShell } from "../../components/layout/AppShell";
import { StatusChip, type Semaforo } from "../../components/ui/StatusChip";

// TODO (con la Tabla 8 lista): traer el estado documental real de vehículo + operador.
// La validación definitiva debe hacerse en el servidor (función SQL / Edge Function);
// acá el botón solo refleja ese resultado.
export default function NuevoParte() {
  const estado = "vigente" as Semaforo; // placeholder

  return (
    <AppShell titulo="Nuevo parte">
      <label>Vehículo<select><option>Elegí una unidad</option></select></label>
      <label>Ruta / locación<input placeholder="Ej: Ruta 7 hacia yacimiento" /></label>
      <label>Tarea
        <select><option>Transporte</option><option>Izaje con hidrogrúa</option><option>Altura con barquilla</option></select>
      </label>

      <section className="card">
        <h2>Documentación</h2>
        <StatusChip estado={estado} />
      </section>

      {estado === "vencido"
        ? <button className="primary">Solicitar autorización a Base</button>
        : <button className="primary" disabled={estado !== "vigente"}>Generar análisis de riesgo</button>}
    </AppShell>
  );
}
