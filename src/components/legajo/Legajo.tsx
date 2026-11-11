import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { agregar, formatFecha, hoy, normalizarDominio, semaforoDe, type Documento } from "../../lib/registros";
import { StatusChip } from "../ui/StatusChip";

interface FormDocumentoProps {
  tipos: string[];
  /** Operador dueño del documento. Si falta, el formulario pide el vehículo. */
  operador?: { id: string; nombre: string };
  /** Dominios sugeridos al cargar un documento de vehículo. */
  dominios?: string[];
}

export function FormDocumento({ tipos, operador, dominios = [] }: FormDocumentoProps) {
  const { operador: usuario } = useAuth();
  const [guardado, setGuardado] = useState("");

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usuario) return;
    const form = event.currentTarget;
    const datos = new FormData(form);
    const dominio = String(datos.get("vehiculo") ?? "").trim();
    const archivo = datos.get("archivo");

    agregar("documentos", {
      entidad: operador ? "operador" : "vehiculo",
      entidadId: operador ? operador.id : normalizarDominio(dominio),
      entidadNombre: operador ? operador.nombre : dominio.toUpperCase(),
      tipo: String(datos.get("tipo")),
      vencimiento: String(datos.get("vencimiento")),
      archivoNombre: archivo instanceof File ? archivo.name : "",
      cargadoPor: usuario.nombre_completo,
      cargadoEn: hoy(),
    });
    setGuardado(`Documento "${datos.get("tipo")}" cargado.`);
    form.reset();
  }

  return (
    <form onSubmit={enviar}>
      <div className="form-grid">
        {!operador && (
          <label>Vehículo <small>(dominio)</small>
            <input name="vehiculo" list="dominios-flota" required />
            <datalist id="dominios-flota">{dominios.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
        )}
        <label>Tipo de documento
          <select name="tipo" defaultValue="" required>
            <option value="" disabled>Elegí un tipo</option>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Fecha de vencimiento<input type="date" name="vencimiento" required /></label>
        <label>Archivo <small>(PDF o foto)</small><input type="file" name="archivo" accept="application/pdf,image/*" required /></label>
      </div>
      <p className="ayuda">
        Por ahora solo se registra el nombre del archivo; el archivo en sí todavía no se guarda. La fecha se carga a mano hasta que esté la lectura automática.
      </p>
      {guardado && <p className="exito" role="status">{guardado}</p>}
      <div className="actions"><button type="submit" className="primary inline">Cargar documento</button></div>
    </form>
  );
}

export function TablaDocumentos({ documentos, mostrarEntidad = false }: { documentos: Documento[]; mostrarEntidad?: boolean }) {
  if (documentos.length === 0) return <p className="vacio">Todavía no hay documentos cargados.</p>;
  const ordenados = [...documentos].sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));

  return (
    <div className="table-wrap">
      <table className="tabla tabla-izquierda">
        <thead>
          <tr>
            {mostrarEntidad && <><th>Corresponde a</th><th>Clase</th></>}
            <th>Documento</th><th>Vencimiento</th><th>Estado</th><th>Archivo</th><th>Cargado por</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((d) => (
            <tr key={d.id}>
              {mostrarEntidad && <><td>{d.entidadNombre}</td><td>{d.entidad === "vehiculo" ? "Vehículo" : "Operador"}</td></>}
              <td>{d.tipo}</td>
              <td>{formatFecha(d.vencimiento)}</td>
              <td><StatusChip estado={semaforoDe(d.vencimiento)} /></td>
              <td>{d.archivoNombre || "—"}</td>
              <td>{d.cargadoPor} · {formatFecha(d.cargadoEn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
