import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatFecha, formatFechaHora } from "../../lib/registros";
import {
  MOTIVOS_CONSTANCIA, enlaceVerificacion, numeroConstancia, useConstancias,
  type Constancia, type ContenidoConstancia,
} from "../../lib/constancias";

const fechaHora = (valor: string | null | undefined) => (valor ? formatFechaHora(valor) : "—");
const siNo = (valor: boolean | null | undefined) => (valor === null || valor === undefined ? "—" : valor ? "Sí" : "No");
const numero = (valor: number | null | undefined, unidad: string, decimales = 1) =>
  valor === null || valor === undefined ? "—" : `${Number(valor).toLocaleString("es-AR", { maximumFractionDigits: decimales })} ${unidad}`;

/**
 * Constancia de un gerenciamiento: el documento congelado que emitió la base al cerrarlo.
 * Se imprime o se guarda como PDF desde el navegador; el código de verificación permite comprobarla.
 */
export default function ConstanciaGerenciamiento() {
  const { gerenciamientoId = "" } = useParams();
  const { constancias, error } = useConstancias(gerenciamientoId);
  const [elegida, setElegida] = useState<number | null>(null);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!constancias) return <p className="estado">Cargando constancia…</p>;
  if (constancias.length === 0) {
    return (
      <section className="panel panel-angosto">
        <h2 className="panel-header">Gerenciamiento #{gerenciamientoId}</h2>
        <div className="panel-body">
          <p>Todavía no tiene constancia. Se emite sola cuando el gerenciamiento se <strong>cierra</strong>: a partir de ahí queda congelada y con su código de verificación.</p>
          <p><Link to="/gerenciamientos">← Volver a gerenciamientos</Link></p>
        </div>
      </section>
    );
  }

  const ultima = constancias[0];
  const constancia = constancias.find((c) => c.version === elegida) ?? ultima;

  return (
    <article className="informe constancia">
      <div className="actions no-print">
        <Link className="secondary enlace-boton" to="/gerenciamientos">Volver</Link>
        {constancias.length > 1 && (
          <label className="constancia-version">Versión
            <select value={constancia.version} onChange={(e) => setElegida(Number(e.target.value))}>
              {constancias.map((c) => (
                <option key={c.version} value={c.version}>
                  v{c.version} · {MOTIVOS_CONSTANCIA[c.motivo]} · {formatFechaHora(c.emitidaEn)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="primary inline" onClick={() => window.print()}>Imprimir / guardar como PDF</button>
      </div>

      <Documento constancia={constancia} reemplazadaPor={constancia.version < ultima.version ? ultima.version : null} />
    </article>
  );
}

function Documento({ constancia, reemplazadaPor }: { constancia: Constancia; reemplazadaPor: number | null }) {
  const c: ContenidoConstancia = constancia.contenido;
  const v = c.viaje;
  const p = c.personas;

  return (
    <>
      <header className="informe-encabezado">
        <img src="/logo.png" alt="" width={828} height={682} />
        <div>
          <p className="informe-empresa">LIFTING PATAGONIA SAS</p>
          <h2>Constancia de gerenciamiento N° {numeroConstancia(constancia)}</h2>
          <p>Emitida el {formatFechaHora(constancia.emitidaEn)} · {MOTIVOS_CONSTANCIA[constancia.motivo]}</p>
        </div>
      </header>

      {reemplazadaPor && (
        <p className="aviso-anulado"><strong>Versión reemplazada.</strong> La versión vigente de este documento es la v{reemplazadaPor}.</p>
      )}
      {c.anulacion && (
        <p className="aviso-anulado">
          <strong>GERENCIAMIENTO ANULADO</strong> el {fechaHora(c.anulacion.en)}{c.anulacion.por ? ` por ${c.anulacion.por}` : ""}. Motivo: {c.anulacion.motivo}
        </p>
      )}

      <h3>Datos del viaje</h3>
      <dl className="detalle">
        <div><dt>Salida</dt><dd>{formatFecha(v.fecha_salida)} {v.hora_salida} hs.</dd></div>
        <div><dt>Llegada</dt><dd>{formatFecha(v.fecha_llegada)} {v.hora_llegada} hs.</dd></div>
        <div><dt>Origen</dt><dd>{v.origen}</dd></div>
        <div><dt>Destino</dt><dd>{v.destino}</dd></div>
        <div><dt>Distancia declarada</dt><dd>{numero(v.distancia_km, "km", 0)}</dd></div>
        <div><dt>Línea / sector</dt><dd>{v.linea || "—"}</dd></div>
        <div><dt>Teléfono de contacto</dt><dd>{v.telefono || "—"}</dd></div>
        <div><dt>Material radioactivo</dt><dd>{siNo(v.radioactivo)}</dd></div>
        <div><dt>Traslada pasajeros</dt><dd>{siNo(v.pasajeros)}</dd></div>
        <div className="detalle-ancho"><dt>Motivo / trabajo</dt><dd>{v.motivo || "—"}</dd></div>
        <div className="detalle-ancho"><dt>Rutas</dt><dd>{v.rutas || "—"}</dd></div>
      </dl>

      <h3>Unidad, cliente y contrato</h3>
      <dl className="detalle">
        <div><dt>Dominio</dt><dd>{c.vehiculo.dominio || "—"}</dd></div>
        <div><dt>Marca / modelo</dt><dd>{c.vehiculo.marca_modelo || "—"}</dd></div>
        <div><dt>Equipo</dt><dd>{c.vehiculo.equipo || "—"}</dd></div>
        <div><dt>Cliente</dt><dd>{c.cliente ? c.cliente.razon_social : "—"}</dd></div>
        <div><dt>CUIT</dt><dd>{c.cliente?.cuit || "—"}</dd></div>
        <div><dt>Contrato</dt><dd>{c.contrato ? [c.contrato.modalidad, c.contrato.unidad_medida].filter(Boolean).join(" · ") : "—"}</dd></div>
      </dl>

      <h3>Personas y autorización</h3>
      <dl className="detalle">
        <div><dt>Conductor</dt><dd>{p.conductor}</dd></div>
        <div><dt>Segundo conductor</dt><dd>{p.conductor2 || "—"}</dd></div>
        <div><dt>Cargado por</dt><dd>{p.cargado_por || "—"}</dd></div>
        <div><dt>Cargado el</dt><dd>{fechaHora(p.cargado_en)}</dd></div>
        <div><dt>Autorizado por</dt><dd>{p.autorizado_por || "—"}</dd></div>
        <div><dt>Autorizado el</dt><dd>{fechaHora(p.autorizado_en)}</dd></div>
        <div><dt>Cerrado el</dt><dd>{fechaHora(p.cerrado_en)}</dd></div>
      </dl>

      <h3>Condición de inicio: checklist vehicular</h3>
      {c.checklist ? (
        <dl className="detalle">
          <div><dt>Checklist</dt><dd>#{c.checklist.id}</dd></div>
          <div><dt>Realizado</dt><dd>{fechaHora(c.checklist.realizado_en)}</dd></div>
          <div><dt>Por</dt><dd>{c.checklist.usuario || "—"}</dd></div>
          <div><dt>Resultado</dt><dd>{c.checklist.apto ? "APTO" : "NO APTO"}</dd></div>
          {c.checklist.fallas && c.checklist.fallas.length > 0 && (
            <div className="detalle-ancho"><dt>Observaciones</dt><dd>{c.checklist.fallas.join("; ")}</dd></div>
          )}
        </dl>
      ) : <p>Sin checklist vinculado.</p>}

      {c.parte && (
        <>
          <h3>Parte diario y análisis de riesgo</h3>
          <dl className="detalle">
            <div><dt>Parte</dt><dd>N° {c.parte.numero} · {formatFecha(c.parte.fecha)}</dd></div>
            <div><dt>Evaluación</dt><dd>{c.parte.riesgo || "—"}</dd></div>
            <div><dt>Nivel de riesgo</dt><dd>{c.parte.nivel_riesgo || "—"}</dd></div>
            <div><dt>Conformidad del operador con el ATS</dt><dd>{fechaHora(c.parte.conformidad_operador_en)}</dd></div>
            {c.parte.ats && <div className="detalle-ancho"><dt>ATS</dt><dd className="texto-preformateado">{c.parte.ats}</dd></div>}
          </dl>
        </>
      )}

      <h3>Datos del rastreo satelital (Strix)</h3>
      {c.strix ? (
        <dl className="detalle">
          <div><dt>Kilómetros</dt><dd>{numero(c.strix.km, "km")}</dd></div>
          <div><dt>Horas en marcha</dt><dd>{numero(c.strix.horas_marcha, "h")}</dd></div>
          <div><dt>Horas en ralentí</dt><dd>{numero(c.strix.horas_ralenti, "h")}</dd></div>
          <div><dt>Velocidad máxima</dt><dd>{numero(c.strix.velocidad_maxima, "km/h", 0)}</dd></div>
          <div><dt>Excesos de velocidad</dt><dd>{c.strix.excesos ?? "—"}</dd></div>
          <div><dt>Calculado el</dt><dd>{fechaHora(c.strix.calculado_en)}</dd></div>
        </dl>
      ) : <p>Sin datos de Strix al momento de la emisión.</p>}

      <div className="informe-firma constancia-firmas">
        <div><p>{p.conductor}</p><span>Conductor</span></div>
        <div><p>{p.autorizado_por || ""}</p><span>Responsable que autorizó</span></div>
      </div>

      <footer className="constancia-verificacion">
        <p>
          Documento generado por el sistema al {constancia.motivo === "cierre" ? "cerrarse" : "registrarse"} el gerenciamiento.
          No puede modificarse: cualquier corrección se emite como una versión nueva.
        </p>
        <p><strong>Código de verificación (SHA-256):</strong> <code>{constancia.hash}</code></p>
        <p><strong>Verificar en:</strong> {enlaceVerificacion(constancia.hash)}</p>
      </footer>
    </>
  );
}
