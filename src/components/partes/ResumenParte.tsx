import { Link } from "react-router-dom";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import type { ResumenParte, RiesgoParte, TrabajoParte } from "../../lib/usePartes";

// Bloques del resumen del parte (riesgo, ATS, trabajos y Strix). Los usan el detalle del parte y su informe PDF.

export const TEXTO_RIESGO: Record<string, { texto: string; clase: string }> = {
  habilitado: { texto: "Habilitado", clase: "vigente" },
  precaucion: { texto: "Precaución", clase: "por-vencer" },
  suspendido: { texto: "Suspender", clase: "vencido" },
  "sin-datos": { texto: "Sin evaluar", clase: "sin-datos" },
};

const kmTexto = (km: number | null) => (km === null ? "—" : `${km.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`);
const horasTexto = (h: number | null) => (h === null ? "—" : `${h.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`);

export function hayRiesgo(r: RiesgoParte) {
  return !!(r.origen || r.estado);
}

/** Dónde se abrió el parte y qué indicaba la matriz de riesgos en ese momento. */
export function DatosRiesgo({ riesgo, conEnlaceMapa = true }: { riesgo: RiesgoParte; conEnlaceMapa?: boolean }) {
  const mapa = riesgo.latitud !== null && riesgo.longitud !== null
    ? `https://www.google.com/maps?q=${riesgo.latitud},${riesgo.longitud}` : "";
  return (
    <dl className="detalle">
      <div>
        <dt>Ubicación</dt>
        <dd>
          {riesgo.origen === "tramo" ? `Tramo: ${riesgo.tramo || "—"}` : riesgo.origen === "gps" ? "GPS del teléfono" : "No informada"}
          {riesgo.precision !== null && <small> (± {Math.round(riesgo.precision)} m)</small>}
          {riesgo.latitud !== null && riesgo.longitud !== null && <small> · {riesgo.latitud.toFixed(5)}, {riesgo.longitud.toFixed(5)}</small>}
          {conEnlaceMapa && mapa && <> · <a href={mapa} target="_blank" rel="noreferrer">Ver en mapa</a></>}
        </dd>
      </div>
      {riesgo.estado && <div><dt>Evaluación de viento</dt><dd>{TEXTO_RIESGO[riesgo.estado]?.texto ?? riesgo.estado}</dd></div>}
      {riesgo.equipo && <div><dt>Equipo evaluado</dt><dd>{riesgo.equipo}</dd></div>}
      {riesgo.viento !== null && <div><dt>Viento a altura de trabajo</dt><dd>{Math.round(riesgo.viento)} km/h</dd></div>}
      {riesgo.rafaga !== null && <div><dt>Ráfagas</dt><dd>{Math.round(riesgo.rafaga)} km/h</dd></div>}
      {riesgo.nivel && <div><dt>Nivel de riesgo</dt><dd>{riesgo.nivel}</dd></div>}
      {riesgo.climaMomento && <div><dt>Datos del clima de</dt><dd>{formatFechaHora(riesgo.climaMomento)}</dd></div>}
      {riesgo.motivos.length > 0 && <div className="detalle-ancho"><dt>Motivos</dt><dd>{riesgo.motivos.join(" · ")}</dd></div>}
    </dl>
  );
}

/** ATS guardado al abrir el parte: una línea por peligro o medida. */
export function TextoAts({ ats }: { ats: string }) {
  if (!ats.trim()) return <p className="ayuda">El parte se abrió sin ATS (no se indicó la ubicación o la matriz no tenía peligros para el lugar).</p>;
  return <div className="ats">{ats.split("\n").map((linea, i) => linea.trim() ? <p key={i}>{linea}</p> : null)}</div>;
}

function ChecklistTrabajo({ t, conEnlace }: { t: TrabajoParte; conEnlace: boolean }) {
  if (t.checklistId === null) return <>—</>;
  const texto = `#${t.checklistId} ${t.checklistApto ? "apto" : "no apto"}`;
  return conEnlace ? <Link to={`/checklist/${t.checklistId}`}>{texto}</Link> : <>{texto}</>;
}

/** Trabajos (gerenciamientos) que agrupa el parte, con checklist y datos de Strix. */
export function TablaTrabajos({ resumen, conEnlaces = true, conStrix = true }: { resumen: ResumenParte; conEnlaces?: boolean; conStrix?: boolean }) {
  if (resumen.trabajos.length === 0) {
    return <p className="vacio">Todavía no hay gerenciamientos dentro de este parte.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead>
          <tr><th>Gerenc.</th><th>Salida</th><th>Recorrido</th><th>Km declarados</th>{conStrix && <th>Km Strix</th>}<th>Checklist</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {resumen.trabajos.map((t) => (
            <tr key={t.id}>
              <td>{conEnlaces ? <Link to="/gerenciamientos">#{t.id}</Link> : `#${t.id}`}</td>
              <td>{formatFecha(t.fechaSalida)} {t.horaSalida}</td>
              <td>{t.origen} → {t.destino}</td>
              <td>{kmTexto(t.distanciaKm)}</td>
              {conStrix && <td>{t.strixRecorridos ? kmTexto(t.strixKm) : "—"}</td>}
              <td><ChecklistTrabajo t={t} conEnlace={conEnlaces} /></td>
              <td>{t.autorizacion === "autorizado" ? (t.estado === "cerrado" ? "Cerrado" : "Autorizado") : "Pendiente"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Totales de Strix de los trabajos del parte. */
export function TotalesStrix({ resumen }: { resumen: ResumenParte }) {
  const s = resumen.strix;
  if (s.vinculados === 0) {
    return <p className="ayuda">Sin datos de Strix: ningún gerenciamiento del parte tiene recorridos vinculados todavía.</p>;
  }
  return (
    <dl className="detalle">
      <div><dt>Km reales (Strix)</dt><dd>{kmTexto(s.km)}</dd></div>
      <div><dt>Horas en marcha</dt><dd>{horasTexto(s.horasMarcha)}</dd></div>
      <div><dt>Horas en ralentí</dt><dd>{horasTexto(s.horasRalenti)}</dd></div>
      <div><dt>Velocidad máxima</dt><dd>{s.velocidadMaxima === null ? "—" : `${Math.round(s.velocidadMaxima)} km/h`}</dd></div>
      <div><dt>Excesos de velocidad</dt><dd>{s.excesos ?? 0}</dd></div>
      <div><dt>Trabajos con Strix</dt><dd>{s.vinculados} de {resumen.trabajos.length}</dd></div>
    </dl>
  );
}
