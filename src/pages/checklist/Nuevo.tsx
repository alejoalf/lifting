import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { BotonEliminar } from "../../components/ui/BotonEliminar";
import { formatFecha, formatFechaHora, hoy, semaforoDe } from "../../lib/registros";
import { FORMATOS_ARCHIVO } from "../../lib/legajos";
import { crearChecklist, type ItemChecklist, type NeumaticoChecklist } from "../../lib/operaciones";
import {
  CARACTERISTICAS_NEUMATICO, ESTADOS, PLANTILLAS, armarDimension, avisarDocumentosVehiculo, borrarPrecargaVehiculo,
  cargarDocumentoLegajo, diasParaRenovar, documentoBloquea, enTemporada, esCondicionante, guardarDatosConductor,
  guardarPrecargaVehiculo, partirDimension, problemaDocumento, useDocumentosChecklist, useMisDatosConductor,
  usePrecargaVehiculo, useVehiculosChecklist,
  type DatosConductor, type DocChecklist, type EjeDef, type EstadoItem, type ItemDef, type Plantilla, type Precarga,
  type PrecargaVehiculo, type VehiculoChecklist,
} from "../../lib/checklistVehicular";

const ETIQUETA_ESTADO: Record<string, string> = { optimo: "Óptimo", regular: "Regular", mal: "Mal", observacion: "Obs.", falta: "Falta", na: "N/A" };

type NeumaticoForm = Omit<NeumaticoChecklist, "eje" | "estado"> & { estado: NeumaticoChecklist["estado"] | "" };

/**
 * Checklist pre-uso según el tipo de flota del vehículo (planilla de flota pesada del cliente y su versión liviana).
 * - Datos técnicos del vehículo: precargados, se confirman cada 6 meses.
 * - Documentos: se leen del Legajo del conductor y de Flota (una sola fuente para toda la app).
 * Un checklist apto en las últimas 24 h es condición para iniciar un gerenciamiento.
 */
export default function NuevoChecklist() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const volverAGerenciamiento = params.get("volver") === "gerenciamiento";
  const { vehiculos, error: errorVehiculos } = useVehiculosChecklist();
  const [vehiculoId, setVehiculoId] = useState(params.get("vehiculo") ?? "");
  const precarga = usePrecargaVehiculo(vehiculoId);
  const pv = precarga.precarga;
  // Los documentos dependen de la precarga (si lleva semi), así que se recargan cuando cambia.
  const docs = useDocumentosChecklist(vehiculoId, pv?.actualizadoEn);
  const conductor = useMisDatosConductor();
  const [docsNa, setDocsNa] = useState<string[]>([]);

  if (!vehiculos) return <p className="estado">Cargando vehículos…</p>;
  const vehiculo = vehiculos.find((v) => v.id === vehiculoId);
  const plantilla = vehiculo?.tipoFlota ? PLANTILLAS[vehiculo.tipoFlota] : null;
  const vehiculoListo = !!plantilla && !!pv && pv.vigente && pv.datos.tipoFlota === plantilla.tipo;
  const conductorListo = !!conductor.datos?.dni;

  return (
    <div className="panel-angosto">
      <section className="panel">
        <h2 className="panel-header">1. Unidad</h2>
        <div className="panel-body">
          {volverAGerenciamiento && (
            <p className="aviso-local">Para iniciar el gerenciamiento, el vehículo necesita un checklist <strong>apto</strong> de las últimas 24 horas.</p>
          )}
          <div className="form-grid">
            <label>Vehículo
              <select value={vehiculoId} onChange={(e) => { setVehiculoId(e.target.value); setDocsNa([]); }} required>
                <option value="" disabled>Elegí un vehículo</option>
                {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.dominio} · {v.marcaModelo}</option>)}
              </select>
            </label>
            <div>
              <span className="etiqueta-dato">Tipo de flota</span>
              <p className="dato-fijo">
                {!vehiculo ? "—" : vehiculo.tipoFlota
                  ? <span className={`chip flota-${vehiculo.tipoFlota.toLowerCase()}`}>Flota {vehiculo.tipoFlota.toLowerCase()}</span>
                  : <span className="texto-alto">Sin asignar</span>}
              </p>
            </div>
            <div>
              <span className="etiqueta-dato">Conductor</span>
              <p className="dato-fijo">{operador?.nombre_completo}</p>
            </div>
          </div>
          {errorVehiculos && <p className="error" role="alert">{errorVehiculos}</p>}
          {vehiculo && !vehiculo.tipoFlota && (
            <p className="error" role="alert">Este vehículo no tiene tipo de flota (pesada o liviana). Pedile al administrador que lo complete en Flota.</p>
          )}
          {precarga.error && <p className="error" role="alert">{precarga.error}</p>}
        </div>
      </section>

      {vehiculo && plantilla && pv !== undefined && (
        <PanelPrecargaVehiculo
          key={`${vehiculo.id}-${pv?.actualizadoEn ?? "nuevo"}`}
          vehiculo={vehiculo}
          plantilla={plantilla}
          precarga={pv}
          onGuardado={precarga.refresh}
        />
      )}

      {vehiculo && plantilla && vehiculoListo && operador && (
        <PanelDocumentacion
          vehiculo={vehiculo}
          operadorId={operador.operadorId}
          documentos={docs.documentos}
          error={docs.error || conductor.error}
          datosConductor={conductor.datos}
          docsNa={docsNa}
          onNa={setDocsNa}
          onCambio={() => { docs.refresh(); conductor.refresh(); }}
        />
      )}

      {vehiculo && plantilla && vehiculoListo && conductorListo && pv && docs.documentos && (
        <FormularioChecklist
          key={`${vehiculo.id}-${plantilla.tipo}-${pv.datos.conSemi}`}
          vehiculo={vehiculo}
          plantilla={plantilla}
          precargaVehiculo={pv.datos}
          documentos={docs.documentos}
          docsNa={docsNa}
          onGuardado={(id) => navigate(volverAGerenciamiento ? `/gerenciamientos/nuevo?vehiculo=${vehiculo.id}` : `/checklist/${id}`)}
        />
      )}
      {vehiculo && plantilla && pv !== undefined && !vehiculoListo && (
        <p className="aviso-local">Confirmá los datos precargados del vehículo para continuar.</p>
      )}
      {vehiculo && plantilla && vehiculoListo && conductor.datos && !conductorListo && (
        <p className="aviso-local">Completá tu DNI en la documentación del conductor para continuar con los controles.</p>
      )}
    </div>
  );
}

// ---------- Datos precargados del vehículo ----------

function EstadoPrecarga({ precarga }: { precarga: Precarga<unknown> | null }) {
  if (!precarga) return <span className="chip vencido">Sin cargar</span>;
  if (!precarga.vigente) return <span className="chip vencido">Vencidos: renovar</span>;
  const dias = diasParaRenovar(precarga);
  return <span className={`chip ${dias <= 15 ? "por-vencer" : "vigente"}`}>Vigentes hasta {formatFecha(precarga.vigenteHasta.slice(0, 10))}</span>;
}

/** Dimensión con el formato de la planilla: ___ / ___ R ___. */
function CampoDimension({ valor, onChange, etiqueta }: { valor: string; onChange: (v: string) => void; etiqueta: string }) {
  const partes = partirDimension(valor);
  const cambiar = (campo: "ancho" | "perfil" | "rodado", v: string) => {
    const p = { ...partes, [campo]: v };
    onChange(armarDimension(p.ancho, p.perfil, p.rodado));
  };
  return (
    <fieldset className="dimension">
      <legend>{etiqueta}</legend>
      <div className="dimension-campos">
        <input aria-label="Ancho" inputMode="decimal" placeholder="295" value={partes.ancho} onChange={(e) => cambiar("ancho", e.target.value)} />
        <span aria-hidden="true">/</span>
        <input aria-label="Perfil" inputMode="decimal" placeholder="80" value={partes.perfil} onChange={(e) => cambiar("perfil", e.target.value)} />
        <span aria-hidden="true">R</span>
        <input aria-label="Rodado" inputMode="decimal" placeholder="22.5" value={partes.rodado} onChange={(e) => cambiar("rodado", e.target.value)} />
      </div>
    </fieldset>
  );
}

function PanelPrecargaVehiculo({ vehiculo, plantilla, precarga, onGuardado }: {
  vehiculo: VehiculoChecklist;
  plantilla: Plantilla;
  precarga: Precarga<PrecargaVehiculo> | null;
  onGuardado: () => Promise<void>;
}) {
  const tipoCambio = !!precarga && precarga.datos.tipoFlota !== plantilla.tipo;
  const debeRenovar = !precarga || !precarga.vigente || tipoCambio;
  const [editando, setEditando] = useState(debeRenovar);
  const previo = precarga?.datos;
  const [datos, setDatos] = useState<PrecargaVehiculo>(() => ({
    tipoFlota: plantilla.tipo,
    interno: previo?.interno ?? "",
    marca: previo?.marca || vehiculo.marcaModelo,
    potenciaHp: previo?.potenciaHp ?? "",
    empresa: previo?.empresa ?? "",
    sector: previo?.sector ?? "",
    conSemi: plantilla.tipo === "Pesada" && !!previo?.conSemi,
    semiDominio: previo?.semiDominio ?? "",
    semiInterno: previo?.semiInterno ?? "",
    dimensiones: previo?.dimensiones ?? {},
  }));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const ejes = plantilla.ejes.filter((e) => datos.conSemi || !e.semi);
  const campo = (nombre: keyof PrecargaVehiculo) => ({
    value: String(datos[nombre] ?? ""),
    onChange: (e: { target: { value: string } }) => setDatos({ ...datos, [nombre]: e.target.value }),
  });

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setGuardando(true);
    try {
      await guardarPrecargaVehiculo(vehiculo.id, {
        ...datos,
        semiDominio: datos.conSemi ? datos.semiDominio.trim().toUpperCase() : "",
        semiInterno: datos.conSemi ? datos.semiInterno : "",
        dimensiones: Object.fromEntries(ejes.map((e) => [e.id, datos.dimensiones[e.id] ?? ""])),
      });
      await onGuardado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron guardar los datos del vehículo.");
      setGuardando(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-header panel-header-fila">
        2. Datos precargados del vehículo
        <EstadoPrecarga precarga={tipoCambio ? null : precarga} />
      </h2>
      <div className="panel-body">
        {!editando && precarga ? (
          <>
            <dl className="detalle">
              <div><dt>Dominio</dt><dd>{vehiculo.dominio}</dd></div>
              <div><dt>N° de interno</dt><dd>{previo?.interno || "—"}</dd></div>
              <div><dt>Marca</dt><dd>{previo?.marca || "—"}</dd></div>
              {plantilla.tipo === "Pesada" && <div><dt>Potencia</dt><dd>{previo?.potenciaHp ? `${previo.potenciaHp} HP` : "—"}</dd></div>}
              <div><dt>Empresa / sector</dt><dd>{[previo?.empresa, previo?.sector].filter(Boolean).join(" · ") || "—"}</dd></div>
              {previo?.conSemi && <div><dt>Semi</dt><dd>{previo.semiDominio}{previo.semiInterno ? ` · Int. ${previo.semiInterno}` : ""}</dd></div>}
            </dl>
            <p className="ayuda">
              Actualizados por {precarga.actualizadoPor || "—"} el {formatFechaHora(precarga.actualizadoEn)}. Se renuevan cada 6 meses.
              La documentación del vehículo se toma de Flota.
            </p>
            <div className="actions">
              <BotonEliminar
                etiqueta="Borrar datos"
                tipo="los datos precargados del vehículo"
                nombre={vehiculo.dominio}
                consecuencias={[
                  "Se van a volver a pedir completos antes del próximo checklist.",
                  "Los checklists ya guardados no cambian: conservan los datos con los que se hicieron.",
                ]}
                onEliminar={async () => { await borrarPrecargaVehiculo(vehiculo.id); await onGuardado(); }}
              />
              <button type="button" className="secondary" onClick={() => setEditando(true)}>Actualizar datos</button>
            </div>
          </>
        ) : (
          <form onSubmit={guardar}>
            <p className="aviso-local">
              {!precarga ? "Este vehículo todavía no tiene datos precargados. Completalos una vez y se autocompletan en los próximos checklists."
                : tipoCambio ? "Cambió el tipo de flota del vehículo: revisá y confirmá los datos."
                  : !precarga.vigente ? "Pasaron 6 meses desde la última confirmación: revisá y confirmá los datos para seguir."
                    : "Revisá los datos y guardá para renovar la vigencia por 6 meses."}
            </p>
            <div className="form-grid">
              <label>N° de interno<input {...campo("interno")} /></label>
              <label>Marca / modelo<input {...campo("marca")} required /></label>
              {plantilla.tipo === "Pesada" && <label>Potencia (HP)<input type="number" min="0" {...campo("potenciaHp")} /></label>}
              <label>Empresa<input {...campo("empresa")} /></label>
              <label>Sector<input {...campo("sector")} /></label>
            </div>
            {plantilla.tipo === "Pesada" && (
              <>
                <label className="check">
                  <input type="checkbox" checked={datos.conSemi} onChange={(e) => setDatos({ ...datos, conSemi: e.target.checked })} />
                  Opera con semirremolque
                </label>
                {datos.conSemi && (
                  <div className="form-grid">
                    <label>Dominio del semi<input {...campo("semiDominio")} required /></label>
                    <label>N° de interno del semi<input {...campo("semiInterno")} /></label>
                  </div>
                )}
              </>
            )}
            <h3 className="checklist-subtitulo">Dimensiones de neumáticos</h3>
            <div className="form-grid compacto">
              {ejes.map((e) => (
                <CampoDimension
                  key={e.id}
                  etiqueta={e.nombre}
                  valor={datos.dimensiones[e.id] ?? ""}
                  onChange={(v) => setDatos({ ...datos, dimensiones: { ...datos.dimensiones, [e.id]: v } })}
                />
              ))}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
              {!debeRenovar && <button type="button" className="secondary" onClick={() => setEditando(false)}>Cancelar</button>}
              <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : "Confirmar datos del vehículo"}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ---------- Documentación (Legajo y Flota) ----------

function EstadoDocumento({ doc, na }: { doc: DocChecklist; na: boolean }) {
  if (na) return <span className="chip sin-datos">No aplica</span>;
  const problema = problemaDocumento(doc);
  if (problema === "falta cargar") return <span className={`chip ${doc.condicionante ? "vencido" : "sin-datos"}`}>Falta cargar</span>;
  if (problema === "en revisión") return <span className="chip en-revision">En revisión</span>;
  if (problema === "vencido") return <span className="chip vencido">Venció el {formatFecha(doc.vencimiento ?? "")}</span>;
  if (!doc.vencimiento) return <span className="chip vigente">Vigente</span>;
  return <span className={`chip ${semaforoDe(doc.vencimiento)}`}>Vto. {formatFecha(doc.vencimiento)}</span>;
}

/** Carga una licencia en el legajo desde el checklist: queda en el legajo y la usan todas las secciones. */
function CargarEnLegajo({ doc, operadorId, onCargado }: { doc: DocChecklist; operadorId: string; onCargado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [vencimiento, setVencimiento] = useState("");
  const [clase, setClase] = useState(doc.clase ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!abierto) return <button type="button" className="text-button" onClick={() => setAbierto(true)}>Cargar en mi legajo</button>;

  async function guardar() {
    if (!archivo) return setError("Adjuntá una foto o PDF del documento.");
    if (!vencimiento) return setError("Indicá el vencimiento.");
    setError("");
    setGuardando(true);
    try {
      await cargarDocumentoLegajo({ operadorId, tipoId: doc.tipoId, vencimiento, clase, archivo });
      setAbierto(false);
      onCargado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el documento.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cargar-legajo">
      <div className="form-grid compacto">
        <label>Vencimiento<input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} /></label>
        {doc.conClase && <label>Clase<input value={clase} placeholder="Ej. C, E1" onChange={(e) => setClase(e.target.value)} /></label>}
        <label>Foto o PDF<input type="file" accept={FORMATOS_ARCHIVO} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
      </div>
      <p className="ayuda">Queda en tu legajo. Si no sos supervisor, un supervisor lo tiene que aprobar antes de que habilite el checklist.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
        <button type="button" className="primary inline" onClick={() => void guardar()} disabled={guardando}>{guardando ? "Cargando…" : "Cargar"}</button>
      </div>
    </div>
  );
}

function DatosDelConductor({ datos, onGuardado }: { datos: DatosConductor | null; onGuardado: () => void }) {
  const [editando, setEditando] = useState(!datos?.dni);
  const [dni, setDni] = useState(datos?.dni ?? "");
  const [legajo, setLegajo] = useState(datos?.nroLegajo ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!datos) return <p className="estado">Cargando tus datos…</p>;
  if (!editando) {
    return (
      <p className="parte-resumen">
        DNI <strong>{datos.dni}</strong>{datos.nroLegajo && <> · Legajo <strong>{datos.nroLegajo}</strong></>}
        {" "}<button type="button" className="text-button" onClick={() => setEditando(true)}>Editar</button>
      </p>
    );
  }

  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      await guardarDatosConductor(dni, legajo);
      setEditando(false);
      onGuardado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron guardar tus datos.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="form-grid compacto">
        <label>DNI<input value={dni} inputMode="numeric" onChange={(e) => setDni(e.target.value)} /></label>
        <label>N° de legajo <small>(opcional)</small><input value={legajo} onChange={(e) => setLegajo(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {datos.dni && <button type="button" className="secondary" onClick={() => setEditando(false)}>Cancelar</button>}
        <button type="button" className="primary inline" onClick={() => void guardar()} disabled={guardando || !dni.trim()}>
          {guardando ? "Guardando…" : "Guardar en mi legajo"}
        </button>
      </div>
    </div>
  );
}

function PanelDocumentacion({ vehiculo, operadorId, documentos, error, datosConductor, docsNa, onNa, onCambio }: {
  vehiculo: VehiculoChecklist;
  operadorId: string;
  documentos: DocChecklist[] | null;
  error: string;
  datosConductor: DatosConductor | null;
  docsNa: string[];
  onNa: (claves: string[]) => void;
  onCambio: () => void;
}) {
  const [avisado, setAvisado] = useState("");
  const [errorAviso, setErrorAviso] = useState("");
  if (!documentos) return <section className="panel"><div className="panel-body"><p className="estado">Cargando documentación…</p></div></section>;

  const delVehiculo = documentos.filter((d) => d.aplicaA === "vehiculo");
  const delConductor = documentos.filter((d) => d.aplicaA === "operador");
  const faltantesVehiculo = delVehiculo.filter((d) => problemaDocumento(d) !== "");
  const bloquean = documentos.filter((d) => documentoBloquea(d, docsNa.includes(d.clave)));

  async function avisar() {
    setErrorAviso("");
    try {
      await avisarDocumentosVehiculo(vehiculo.id, faltantesVehiculo.map((d) => `${d.nombre} (${problemaDocumento(d)})`));
      setAvisado("Listo: se avisó a los administradores para que lo carguen en Flota.");
    } catch (fallo) {
      setErrorAviso(fallo instanceof Error ? fallo.message : "No se pudo avisar.");
    }
  }

  const fila = (d: DocChecklist, accion?: ReactNode) => (
    <li key={d.clave} className={d.condicionante ? "es-condicionante" : undefined}>
      <span>
        {d.nombre}
        {d.condicionante && <span className="etiqueta-condicionante">Condicionante</span>}
        {d.clase && <small> · Clase {d.clase}</small>}
      </span>
      <span className="doc-estado">
        <EstadoDocumento doc={d} na={docsNa.includes(d.clave)} />
        {d.admiteNa && (
          <label className="check">
            <input
              type="checkbox"
              checked={docsNa.includes(d.clave)}
              onChange={(e) => onNa(e.target.checked ? [...docsNa, d.clave] : docsNa.filter((c) => c !== d.clave))}
            />
            No aplica
          </label>
        )}
        {accion}
      </span>
    </li>
  );

  return (
    <section className="panel">
      <h2 className="panel-header panel-header-fila">
        3. Documentación
        {bloquean.length > 0
          ? <span className="chip vencido">{bloquean.length} bloquea{bloquean.length > 1 ? "n" : ""}</span>
          : <span className="chip vigente">En regla</span>}
      </h2>
      <div className="panel-body">
        <h3 className="checklist-subtitulo">Conductor <small>(Mi legajo)</small></h3>
        <DatosDelConductor key={datosConductor ? `${datosConductor.dni}-${datosConductor.nroLegajo}` : "cargando"} datos={datosConductor} onGuardado={onCambio} />
        <ul className="checklist-resultado lista-documentos">
          {delConductor.map((d) => fila(d, problemaDocumento(d) === "falta cargar" || problemaDocumento(d) === "vencido"
            ? <CargarEnLegajo doc={d} operadorId={operadorId} onCargado={onCambio} />
            : undefined))}
        </ul>

        <h3 className="checklist-subtitulo">Vehículo <small>(Flota)</small></h3>
        <ul className="checklist-resultado lista-documentos">
          {delVehiculo.map((d) => fila(d))}
        </ul>
        {faltantesVehiculo.length > 0 && (
          <div className="actions actions-inicio">
            <button type="button" className="secondary" onClick={() => void avisar()} disabled={!!avisado}>Avisar al administrador</button>
          </div>
        )}
        {avisado && <p className="exito" role="status">{avisado}</p>}
        {errorAviso && <p className="error" role="alert">{errorAviso}</p>}
        <p className="ayuda">
          Los documentos se toman del legajo de cada conductor y de la ficha del vehículo en Flota: lo que se carga acá queda
          disponible en el parte diario y en el resto de la app. Un documento que vence hoy sigue vigente todo el día.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

// ---------- Controles ----------

function FilaControl({ item, estado, vencimiento, onChange }: {
  item: ItemDef;
  estado: EstadoItem | "";
  vencimiento?: DocChecklist;
  onChange: (estado: EstadoItem) => void;
}) {
  const condicionante = esCondicionante(item);
  const temporada = enTemporada(item);
  const falla = estado === "mal" || (condicionante && estado !== "" && estado !== "optimo" && estado !== "na");
  return (
    <li className={`${falla ? "checklist-falla" : ""}${condicionante ? " es-condicionante" : ""}`}>
      <fieldset className="segmento">
        <legend>
          {item.texto}
          {condicionante && <span className="etiqueta-condicionante">{temporada ? "Condicionante (temporada)" : "Condicionante"}</span>}
          {vencimiento && (
            <small className={problemaDocumento(vencimiento) ? "texto-alto" : undefined}>
              {" "}· {vencimiento.vencimiento ? `Vto. ${formatFecha(vencimiento.vencimiento)}` : "sin vencimiento en Flota"}
            </small>
          )}
        </legend>
        {item.nota && <p className="ayuda nota-item">{item.nota}</p>}
        <div className="segmento-opciones seis">
          {ESTADOS.map((opcion) => {
            // En temporada (ej. kit de invierno de mayo a septiembre) no se puede marcar "No aplica".
            const bloqueado = opcion.valor === "na" && temporada;
            return (
              <label key={opcion.valor} title={bloqueado ? "Obligatorio en esta época del año" : opcion.texto}
                className={`segmento-opcion segmento-${opcion.valor}${estado === opcion.valor ? " is-active" : ""}${bloqueado ? " is-disabled" : ""}`}>
                <input type="radio" name={`item-${item.id}`} value={opcion.valor} checked={estado === opcion.valor}
                  disabled={bloqueado} onChange={() => onChange(opcion.valor)} />
                {ETIQUETA_ESTADO[opcion.valor]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </li>
  );
}

function FilaNeumatico({ eje, presiones, valor, onChange }: {
  eje: EjeDef;
  presiones: number[];
  valor: NeumaticoForm;
  onChange: (v: NeumaticoForm) => void;
}) {
  const set = (cambio: Partial<NeumaticoForm>) => onChange({ ...valor, ...cambio });
  const siNo = (campo: "tuercas" | "checkpoint" | "soporte", texto: string) => (
    <label>{texto}
      <select value={valor[campo] ?? ""} onChange={(e) => set({ [campo]: e.target.value as "si" | "no" })} required>
        <option value="" disabled>Elegí</option>
        <option value="si">Correcto</option>
        <option value="no">Con falla</option>
      </select>
    </label>
  );
  const falla = valor.estado === "malo" || valor.tuercas === "no" || valor.checkpoint === "no" || valor.soporte === "no";
  return (
    <div className={`neumatico${falla ? " checklist-falla" : ""}`}>
      <h4>{eje.nombre}</h4>
      <div className="form-grid compacto">
        <label>Presión (PSI)
          <select value={valor.presion} onChange={(e) => set({ presion: e.target.value })} required>
            <option value="" disabled>Elegí</option>
            {presiones.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Estado
          <select value={valor.estado} onChange={(e) => set({ estado: e.target.value as NeumaticoChecklist["estado"] })} required>
            <option value="" disabled>Elegí</option>
            <option value="bueno">Bueno</option>
            <option value="regular">Regular</option>
            <option value="malo">Malo</option>
          </select>
        </label>
        <label>Características
          <select value={valor.caracteristica} onChange={(e) => set({ caracteristica: e.target.value })} required>
            {CARACTERISTICAS_NEUMATICO.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <CampoDimension etiqueta="Dimensiones" valor={valor.dimension} onChange={(dimension) => set({ dimension })} />
        {eje.auxilio ? siNo("soporte", "Soporte") : (
          <>
            {siNo("tuercas", "Ajuste de tuerca")}
            {siNo("checkpoint", "Check point")}
          </>
        )}
      </div>
    </div>
  );
}

function FormularioChecklist({ vehiculo, plantilla, precargaVehiculo, documentos, docsNa, onGuardado }: {
  vehiculo: VehiculoChecklist;
  plantilla: Plantilla;
  precargaVehiculo: PrecargaVehiculo;
  documentos: DocChecklist[];
  docsNa: string[];
  onGuardado: (id: number) => void;
}) {
  const conSemi = plantilla.tipo === "Pesada" && precargaVehiculo.conSemi;
  const pasos = useMemo(() => plantilla.pasos
    .map((p) => ({ ...p, items: p.items.filter((i) => conSemi || !i.semi) }))
    .filter((p) => p.items.length > 0), [plantilla, conSemi]);
  const ejes = useMemo(() => plantilla.ejes.filter((e) => conSemi || !e.semi), [plantilla, conSemi]);
  const todos = pasos.flatMap((p) => p.items);
  const docsPorClave = useMemo(() => new Map(documentos.map((d) => [d.clave, d])), [documentos]);

  const [estados, setEstados] = useState<Record<string, EstadoItem | "">>({});
  const [neumaticos, setNeumaticos] = useState<Record<string, NeumaticoForm>>(() => Object.fromEntries(ejes.map((e) => [e.id, {
    presion: "", estado: "", caracteristica: e.caracteristica, dimension: precargaVehiculo.dimensiones?.[e.id] ?? "",
  }])));
  const [obsPasos, setObsPasos] = useState<Record<string, string>>({});
  const [declaracion, setDeclaracion] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const pendientes = todos.filter((i) => !estados[i.id]).length;

  // Misma regla que la base: documentación en regla, condicionantes en Óptimo/N/A, ningún "Mal" y neumáticos bien.
  const fallas = [
    ...documentos.filter((d) => documentoBloquea(d, docsNa.includes(d.clave))).map((d) => `Documentación: ${d.nombre} (${problemaDocumento(d)})`),
    ...todos.filter((i) => estados[i.id] === "mal" || (esCondicionante(i) && estados[i.id] && estados[i.id] !== "optimo" && estados[i.id] !== "na")).map((i) => i.texto),
    ...ejes.flatMap((e) => {
      const n = neumaticos[e.id];
      return [n.estado === "malo" && "estado malo", n.tuercas === "no" && "ajuste de tuercas", n.checkpoint === "no" && "check point", n.soporte === "no" && "soporte"]
        .filter(Boolean).map((m) => `Neumáticos ${e.nombre}: ${m}`);
    }),
  ];
  const conObservaciones = todos.some((i) => ["regular", "observacion", "falta", "mal"].includes(estados[i.id] ?? ""));

  function cambiarEstado(id: string, estado: EstadoItem) {
    setError("");
    setEstados((actuales) => ({ ...actuales, [id]: estado }));
  }

  function marcarResto(items: ItemDef[]) {
    setError("");
    setEstados((actuales) => ({ ...actuales, ...Object.fromEntries(items.filter((i) => !actuales[i.id]).map((i) => [i.id, "optimo"])) }));
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardando) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    if (pendientes > 0) return setError(`Faltan marcar ${pendientes} controles.`);
    if (conObservaciones && !texto("observaciones")) return setError("Describí en observaciones los controles marcados como Regular, Mal, Observación o Falta.");
    if (!declaracion) return setError("Confirmá la declaración jurada para guardar.");

    setGuardando(true);
    try {
      const items: ItemChecklist[] = pasos.flatMap((p) => p.items.map((i) => ({
        id: i.id, item: i.texto, paso: p.titulo, estado: estados[i.id] as EstadoItem, ...(esCondicionante(i) ? { condicionante: true } : {}),
      })));
      const id = await crearChecklist({
        vehiculoId: vehiculo.id,
        km: texto("km") ? Number(texto("km")) : null,
        items,
        neumaticos: ejes.map((e) => ({ eje: e.nombre, ...neumaticos[e.id] }) as NeumaticoChecklist),
        encabezado: { lugar: texto("lugar"), horometro: texto("horometro"), semiMillaje: texto("semiMillaje"), companero: texto("companero") },
        observaciones: texto("observaciones"),
        observacionesPasos: Object.fromEntries(Object.entries(obsPasos).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
        docsNa,
      });
      onGuardado(id);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo guardar el checklist.");
      setGuardando(false);
    }
  }

  const renderPaso = (paso: (typeof pasos)[number]) => (
    <section className="panel" key={paso.id}>
      <h2 className="panel-header panel-header-fila">
        {paso.titulo}
        <button type="button" className="secondary" onClick={() => marcarResto(paso.items)}>Resto en Óptimo</button>
      </h2>
      <div className="panel-body">
        {paso.nota && <p className="aviso-local">{paso.nota}</p>}
        {paso.id === "p9" && (
          <label>Compañero que asistió en el control<input name="companero" placeholder="Nombre y apellido" required /></label>
        )}
        <ul className="checklist-items">
          {paso.items.map((item) => (
            <FilaControl
              key={item.id}
              item={item}
              estado={estados[item.id] ?? ""}
              vencimiento={item.vencimiento ? docsPorClave.get(item.vencimiento) : undefined}
              onChange={(estado) => cambiarEstado(item.id, estado)}
            />
          ))}
        </ul>
        {paso.observaciones && (
          <label>Observaciones del paso <small>(opcional)</small>
            <textarea rows={2} value={obsPasos[paso.id] ?? ""} onChange={(e) => setObsPasos({ ...obsPasos, [paso.id]: e.target.value })} />
          </label>
        )}
      </div>
    </section>
  );

  const antes = pasos.filter((p) => Number(p.id.slice(1)) < 6);
  const despues = pasos.filter((p) => Number(p.id.slice(1)) >= 6);

  return (
    <form onSubmit={enviar}>
      <section className="panel">
        <h2 className="panel-header">4. {plantilla.titulo} · {formatFecha(hoy())}</h2>
        <div className="panel-body">
          <p className="ayuda referencias">
            Referencias: <strong>Óptimo</strong>, <strong>Regular</strong>, <strong>Mal</strong>, <strong>Obs.</strong> (observación), <strong>Falta</strong>, <strong>N/A</strong> (no aplica).
            Los controles <span className="etiqueta-condicionante">Condicionante</span> tienen que estar en Óptimo para circular.
          </p>
          <div className="form-grid">
            <label>Lugar<input name="lugar" placeholder="Base, locación o yacimiento" required /></label>
            <label>Kilometraje<input type="number" name="km" min="0" step="1" inputMode="numeric" required /></label>
            {plantilla.tipo === "Pesada" && <label>Horómetro <small>(opcional)</small><input type="number" name="horometro" min="0" step="0.1" inputMode="decimal" /></label>}
            {conSemi && <label>Millaje del semi <small>(opcional)</small><input type="number" name="semiMillaje" min="0" step="1" inputMode="numeric" /></label>}
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => marcarResto(todos)}>Marcar todo lo pendiente en Óptimo</button>
          </div>
        </div>
      </section>

      {antes.map(renderPaso)}

      <section className="panel">
        <h2 className="panel-header">Paso 6 · Neumáticos</h2>
        <div className="panel-body">
          <p className="ayuda">Las dimensiones se autocompletan con los datos precargados. Presión y control de tuercas son condicionantes.</p>
          {ejes.map((e) => (
            <FilaNeumatico
              key={e.id}
              eje={e}
              presiones={plantilla.presiones}
              valor={neumaticos[e.id]}
              onChange={(v) => { setError(""); setNeumaticos((actuales) => ({ ...actuales, [e.id]: v })); }}
            />
          ))}
        </div>
      </section>

      {despues.map(renderPaso)}

      <section className="panel">
        <h2 className="panel-header">Cierre</h2>
        <div className="panel-body">
          <label>Observaciones {conObservaciones ? <small>(obligatorio: describí lo marcado)</small> : <small>(opcional)</small>}
            <textarea name="observaciones" rows={3} required={conObservaciones} />
          </label>

          {fallas.length > 0 ? (
            <div className="aviso-local aviso-falla" role="status">
              <p>La unidad quedará <strong>NO APTA</strong> para circular y no se podrá iniciar un gerenciamiento. Se avisará a los supervisores.</p>
              <ul>{fallas.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ) : pendientes === 0 ? (
            <p className="aviso-local aviso-ok" role="status">Todos los condicionantes están en orden: la unidad quedará <strong>apta</strong>.</p>
          ) : (
            <p className="ayuda">Faltan marcar {pendientes} {pendientes === 1 ? "control" : "controles"}.</p>
          )}

          <label className="check declaracion">
            <input type="checkbox" checked={declaracion} onChange={(e) => setDeclaracion(e.target.checked)} />
            Declaro bajo juramento que realicé personalmente los controles y que los datos son verídicos.
          </label>

          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <Link className="secondary enlace-boton" to="/checklist">Cancelar</Link>
            <button type="submit" className="primary inline" disabled={guardando}>{guardando ? "Guardando…" : "Guardar checklist"}</button>
          </div>
        </div>
      </section>
    </form>
  );
}
