import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { formatFecha, formatFechaHora, useColeccion } from "../../lib/registros";

const PERFILES: Record<string, string> = {
  "1": "Parte comercial",
  "2": "Dossier operativo + HSE",
  "3": "Auditoría interna",
};

const semaforoTexto = { vigente: "Vigente", "por-vencer": "Por vencer", vencido: "Vencido" };

/** Informe imprimible del parte. Se guarda como PDF desde el diálogo de impresión del navegador. */
export default function InformeParte() {
  const { id, perfil = "1" } = useParams();
  const { operador } = useAuth();
  const parte = useColeccion("partesDiarios").find((p) => p.id === Number(id));

  const esAdmin = operador?.rol === "admin";
  const puedeVer = parte && operador && (esAdmin || operador.rol === "supervisor" || parte.creadoPor === operador.id);
  if (!parte || !puedeVer || !PERFILES[perfil] || (perfil === "3" && !esAdmin) || parte.estado !== "cerrado") {
    return <p className="vacio">Este informe no está disponible. <Link to={parte ? `/partes/${parte.id}` : "/"}>Volver</Link></p>;
  }

  const km = parte.kmFinal !== null ? parte.kmFinal - parte.kmInicial : null;

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
          <h2>{PERFILES[perfil]} · Parte N° {parte.id}</h2>
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

      {perfil !== "1" && (
        <>
          <h3>Análisis de riesgo (ATS)</h3>
          <p className="ayuda">No disponible: el módulo de análisis de riesgo todavía no está implementado.</p>

          <h3>Vigencia documental al inicio del servicio</h3>
          <p>
            Semáforo de salida: <strong>{parte.semaforo ? semaforoTexto[parte.semaforo] : "Sin documentos cargados"}</strong>
          </p>

          <h3>Resumen de viaje Strix</h3>
          <p className="ayuda">No disponible: la integración con Strix todavía no está implementada.</p>
        </>
      )}

      {perfil === "3" && (
        <>
          <h3>Auditoría interna</h3>
          <dl className="detalle">
            <div><dt>Odómetro declarado</dt><dd>{parte.kmInicial} → {parte.kmFinal ?? "—"} km</dd></div>
            <div><dt>KM reales Strix</dt><dd>No disponible</dd></div>
            <div><dt>Faltas de manejo</dt><dd>No disponible</dd></div>
            <div className="detalle-ancho">
              <dt>Excepciones autorizadas</dt>
              <dd>
                {parte.documentosVencidos.length === 0
                  ? "Ninguna: salida habilitada automáticamente."
                  : `Salida excepcional autorizada por ${parte.resueltoPor} el ${formatFechaHora(parte.resueltoEn)}. Vencido: ${parte.documentosVencidos.join("; ")}.`}
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
