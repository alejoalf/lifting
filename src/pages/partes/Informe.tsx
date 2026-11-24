import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { DatosRiesgo, TablaTrabajos, TextoAts, TotalesStrix, hayRiesgo } from "../../components/partes/ResumenParte";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import { usePartes, useResumenParte } from "../../lib/usePartes";

const PERFILES: Record<string, string> = {
  "1": "Parte comercial",
  "2": "Dossier operativo + HSE",
  "3": "Auditoría interna",
};

const semaforoTexto = { vigente: "Vigente", "por-vencer": "Por vencer", vencido: "Vencido" };

/** Informe imprimible del parte. Se guarda como PDF desde el diálogo de impresión del navegador. */
export default function InformeParte() {
  const { id = "", perfil = "1" } = useParams();
  const { operador } = useAuth();
  const { partes, loading, error } = usePartes();
  const { resumen, error: errorResumen } = useResumenParte(id);
  const parte = partes.find((p) => p.id === id);

  const esAdmin = operador?.rol === "admin";
  const puedeVer = parte && operador && (esAdmin || operador.rol === "supervisor" || parte.creadoPor === operador.id);
  if (loading || resumen === undefined) return <p className="estado">Cargando informe…</p>;
  if (error || errorResumen) return <p className="error" role="alert">{error || errorResumen}</p>;
  if (!parte || !puedeVer || !PERFILES[perfil] || (perfil === "3" && !esAdmin) || parte.estado !== "cerrado") {
    return <p className="vacio">Este informe no está disponible. <Link to={parte ? `/partes/${parte.id}` : "/chofer"}>Volver</Link></p>;
  }

  const km = parte.kmFinal !== null ? parte.kmFinal - parte.kmInicial : null;
  const kmStrix = resumen?.strix.vinculados ? resumen.strix.km : null;
  const diferencia = km !== null && kmStrix !== null ? km - kmStrix : null;
  const checklists = resumen ? [...new Map(resumen.trabajos.filter((t) => t.checklistId !== null).map((t) => [t.checklistId, t])).values()] : [];

  return (
    <article className="informe">
      <div className="actions no-print">
        <Link className="secondary enlace-boton" to={`/partes/${parte.id}`}>Volver al parte</Link>
        <button type="button" className="primary inline" onClick={() => window.print()}>Imprimir / guardar como PDF</button>
      </div>

      <header className="informe-encabezado">
        <img src="/logo.png" alt="" width={828} height={682} />
        <div>
          <p className="informe-empresa">LIFTING PATAGONIA SAS</p>
          <h2>{PERFILES[perfil]} · Parte N° {parte.numero}</h2>
          <p>{formatFecha(parte.fecha)}{perfil === "3" && " · Uso interno exclusivo"}</p>
        </div>
      </header>

      <h3>Datos del servicio</h3>
      <dl className="detalle">
        <div><dt>Cliente</dt><dd>{parte.cliente}</dd></div>
        <div><dt>Contrato</dt><dd>{parte.contrato || "—"}</dd></div>
        <div><dt>Unidad</dt><dd>{parte.vehiculo}</dd></div>
        <div><dt>Operador</dt><dd>{parte.operador}</dd></div>
        <div><dt>Tarea</dt><dd>{parte.tarea}</dd></div>
        <div><dt>Origen</dt><dd>{parte.origen}</dd></div>
        <div><dt>Destino</dt><dd>{parte.destino}</dd></div>
        <div><dt>Inicio</dt><dd>{parte.salidaEn ? formatFechaHora(parte.salidaEn) : "—"}</dd></div>
        <div><dt>Cierre</dt><dd>{formatFechaHora(parte.cerradoEn)}</dd></div>
        <div className="detalle-ancho"><dt>Detalle de tareas</dt><dd>{parte.trabajoRealizado || "—"}</dd></div>
      </dl>

      <h3>A certificar</h3>
      <dl className="detalle">
        <div><dt>Kilómetros declarados</dt><dd>{km !== null ? `${km} km` : "—"}</dd></div>
        <div><dt>Horas de hidrogrúa / barquilla</dt><dd>{parte.horasDeclaradas !== null ? `${parte.horasDeclaradas} h` : "—"}</dd></div>
      </dl>

      {resumen && (
        <>
          <h3>Trabajos del día (gerenciamientos)</h3>
          {/* El parte comercial va al cliente: sin datos de Strix ni alertas internas. */}
          <TablaTrabajos resumen={resumen} conEnlaces={false} conStrix={perfil !== "1"} />
        </>
      )}

      {perfil !== "1" && resumen && (
        <>
          <h3>Ubicación y evaluación de riesgo</h3>
          {hayRiesgo(resumen.riesgo)
            ? <DatosRiesgo riesgo={resumen.riesgo} conEnlaceMapa={false} />
            : <p className="ayuda">El parte se abrió sin ubicación ni evaluación de viento.</p>}

          <h3>Análisis de riesgo (ATS)</h3>
          <TextoAts ats={resumen.ats} />
          {resumen.ats && (
            <p className="ayuda">
              {resumen.conformidadEn
                ? <>Conformidad del operador ({parte.operador}): {formatFechaHora(resumen.conformidadEn)}.</>
                : "El parte se registró antes de que se pidiera la conformidad con el ATS."}
            </p>
          )}

          <h3>Checklist vehicular</h3>
          {checklists.length === 0 ? (
            <p className="ayuda">Ningún gerenciamiento del parte tiene checklist vinculado.</p>
          ) : (
            <ul className="checklist-resultado">
              {checklists.map((t) => (
                <li key={t.checklistId}>
                  <span>Checklist #{t.checklistId} · {t.checklistUsuario} · {t.checklistEn ? formatFechaHora(t.checklistEn) : "—"}</span>
                  <strong className={t.checklistApto ? "texto-ok" : "texto-alto"}>{t.checklistApto ? "Apto" : "No apto"}</strong>
                </li>
              ))}
            </ul>
          )}

          <h3>Vigencia documental al inicio del servicio</h3>
          <p>
            Semáforo de salida: <strong>{parte.semaforo ? semaforoTexto[parte.semaforo] : "Sin documentos cargados"}</strong>
          </p>

          <h3>Resumen de viaje Strix</h3>
          <TotalesStrix resumen={resumen} />
        </>
      )}

      {perfil === "3" && (
        <>
          <h3>Auditoría interna</h3>
          <dl className="detalle">
            <div><dt>Odómetro declarado</dt><dd>{parte.kmInicial} → {parte.kmFinal ?? "—"} km</dd></div>
            <div><dt>KM reales Strix</dt><dd>{kmStrix !== null ? `${kmStrix.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km` : "Sin datos de Strix"}</dd></div>
            {diferencia !== null && (
              <div>
                <dt>Diferencia declarado − Strix</dt>
                <dd className={km && Math.abs(diferencia) > km * 0.2 ? "texto-alto" : undefined}>
                  {diferencia.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km
                </dd>
              </div>
            )}
            <div>
              <dt>Faltas de manejo</dt>
              <dd>
                {resumen?.strix.vinculados
                  ? `${resumen.strix.excesos ?? 0} excesos de velocidad · máxima ${resumen.strix.velocidadMaxima !== null ? `${Math.round(resumen.strix.velocidadMaxima)} km/h` : "—"}`
                  : "Sin datos de Strix"}
              </dd>
            </div>
            <div className="detalle-ancho">
              <dt>Excepciones autorizadas</dt>
              <dd>
                {parte.documentosVencidos.length === 0
                  ? "Ninguna: salida habilitada automáticamente."
                  : `Salida excepcional autorizada por ${parte.resueltoPor} el ${formatFechaHora(parte.resueltoEn)}. Motivos: ${parte.documentosVencidos.join("; ")}.`}
              </dd>
            </div>
            {parte.observaciones && <div className="detalle-ancho"><dt>Observaciones del operador</dt><dd>{parte.observaciones}</dd></div>}
          </dl>
        </>
      )}

      <footer className="informe-firma">
        <div>
          <p>{parte.firmadoPor || " "}</p>
          <span>Firma del supervisor{parte.firmadoEn ? ` · ${formatFechaHora(parte.firmadoEn)}` : " (pendiente)"}</span>
        </div>
      </footer>
    </article>
  );
}
