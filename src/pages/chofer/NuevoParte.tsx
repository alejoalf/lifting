import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { StatusChip } from "../../components/ui/StatusChip";
import {
  PARA_ADMINS, PARA_SUPERVISORES, agregar, documentosDe, formatFecha, hoy, normalizarDominio, notificar,
  peorSemaforo, semaforoDe, useColeccion,
} from "../../lib/registros";
import { useDominios } from "../../lib/useVehiculos";

// Barrera de salida (Módulo A): con algún documento VENCIDO del vehículo o del operador,
// el parte no puede iniciarse y solo queda "Solicitar autorización a Base".
// PENDIENTE: esta validación tiene que repetirse en el servidor cuando el legajo esté en la base.
// PENDIENTE (Módulo B): generar el Análisis de Riesgo (ATS) y pedir la conformidad antes de salir.
export default function NuevoParte() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const dominios = useDominios();
  const documentos = useColeccion("documentos");
  const [vehiculo, setVehiculo] = useState("");
  const abierto = useColeccion("partesDiarios").find(
    (p) => p.creadoPor === operador?.id && (p.estado === "excepcion" || p.estado === "en_curso"),
  );

  if (!operador) return null;

  if (abierto) {
    return (
      <section className="panel">
        <h2 className="panel-header">Ya tenés un parte abierto</h2>
        <div className="panel-body">
          <p>Cerrá el parte N° {abierto.id} antes de abrir uno nuevo.</p>
          <div className="actions"><Link to={`/partes/${abierto.id}`} className="primary inline">Ver parte N° {abierto.id}</Link></div>
        </div>
      </section>
    );
  }

  const docsVehiculo = vehiculo.trim() ? documentosDe(documentos, "vehiculo", normalizarDominio(vehiculo)) : [];
  const docsOperador = documentosDe(documentos, "operador", operador.id);
  const controlados = [...docsVehiculo, ...docsOperador];
  const semaforo = peorSemaforo(controlados);
  const descripcion = (d: (typeof controlados)[number]) =>
    `${d.tipo} (${d.entidad === "vehiculo" ? "vehículo" : "operador"}, vence ${formatFecha(d.vencimiento)})`;
  const vencidos = controlados.filter((d) => semaforoDe(d.vencimiento) === "vencido").map(descripcion);
  const porVencer = controlados.filter((d) => semaforoDe(d.vencimiento) === "por-vencer").map(descripcion);
  const bloqueado = vencidos.length > 0;

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();
    const ahora = new Date().toISOString();

    const parte = agregar("partesDiarios", {
      creadoPor: operador.id,
      operador: operador.nombre_completo,
      creadoEn: ahora,
      fecha: hoy(),
      cliente: texto("cliente"),
      contrato: texto("contrato"),
      vehiculo: vehiculo.trim().toUpperCase(),
      tarea: texto("tarea"),
      origen: texto("origen"),
      destino: texto("destino"),
      kmInicial: Number(texto("kmInicial")),
      observaciones: texto("observaciones"),
      semaforo,
      documentosVencidos: vencidos,
      estado: bloqueado ? "excepcion" : "en_curso",
      resueltoPor: "",
      resueltoEn: "",
      motivoFreno: "",
      salidaEn: bloqueado ? "" : ahora,
      cerradoEn: "",
      kmFinal: null,
      horasDeclaradas: null,
      trabajoRealizado: "",
      firmadoPor: "",
      firmadoEn: "",
    });

    const enlace = `/partes/${parte.id}`;
    if (bloqueado) {
      notificar(PARA_ADMINS, `Pedido de autorización: parte N° ${parte.id}`,
        `${operador.nombre_completo} pide salida excepcional con ${parte.vehiculo}. Vencido: ${vencidos.join("; ")}.`, enlace);
    } else {
      notificar(PARA_SUPERVISORES, `Operación en curso: parte N° ${parte.id}`,
        `${operador.nombre_completo} salió con ${parte.vehiculo} hacia ${parte.destino}.`, enlace);
    }
    navigate(enlace);
  }

  return (
    <form className="panel" onSubmit={enviar}>
      <h2 className="panel-header">Datos del parte</h2>
      <div className="panel-body">
        <div className="form-grid">
          <label>Fecha<input value={formatFecha(hoy())} readOnly disabled /></label>
          <label>Operador<input value={operador.nombre_completo} readOnly disabled /></label>
        </div>
        <div className="form-grid">
          <label>Cliente<input name="cliente" required /></label>
          <label>Contrato <small>(opcional)</small><input name="contrato" /></label>
        </div>
        <div className="form-grid">
          <label>Vehículo <small>(dominio)</small>
            <input list="dominios-parte" value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} required />
            <datalist id="dominios-parte">{dominios.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label>Kilometraje inicial<input type="number" name="kmInicial" min="0" step="1" required /></label>
          <label>Tarea
            <select name="tarea" defaultValue="" required>
              <option value="" disabled>Elegí una tarea</option>
              <option>Transporte</option><option>Izaje con hidrogrúa</option><option>Altura con barquilla</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>Origen<input name="origen" required /></label>
          <label>Destino <small>(ruta / locación)</small><input name="destino" placeholder="Ej: Ruta 7 hacia yacimiento" required /></label>
        </div>
        <label>Observaciones <small>(opcional)</small><textarea name="observaciones" rows={3} /></label>
      </div>

      <h2 className="panel-header panel-header-fila">Semáforo de salida<StatusChip estado={semaforo} /></h2>
      <div className="panel-body">
        {vencidos.length > 0 && (
          <>
            <p className="error">No podés iniciar el parte: hay documentación vencida.</p>
            <ul>{vencidos.map((d) => <li key={d}>{d}</li>)}</ul>
          </>
        )}
        {porVencer.length > 0 && (
          <>
            <p>Documentación por vencer en 15 días o menos:</p>
            <ul>{porVencer.map((d) => <li key={d}>{d}</li>)}</ul>
          </>
        )}
        {semaforo === "vigente" && <p>Documentación del vehículo y del operador en regla.</p>}
        {(docsVehiculo.length === 0 || docsOperador.length === 0) && (
          <p className="ayuda">
            {docsOperador.length === 0 && <>No tenés documentos cargados en <Link to="/legajo">tu legajo</Link>. </>}
            {docsVehiculo.length === 0 && (vehiculo.trim() ? "Este vehículo no tiene documentos cargados. " : "Elegí un vehículo para controlar su documentación. ")}
            Lo que no está cargado no se puede controlar.
          </p>
        )}

        <div className="actions">
          <button type="submit" className="primary inline">{bloqueado ? "Solicitar autorización a Base" : "Iniciar parte"}</button>
        </div>
      </div>
    </form>
  );
}
