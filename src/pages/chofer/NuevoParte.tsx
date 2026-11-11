import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { PARA_SUPERVISORES, agregar, formatFecha, hoy, notificar, useColeccion } from "../../lib/registros";

// PENDIENTE (cuando el cliente defina los documentos y las reglas de bloqueo):
// mostrar acá el estado documental real de vehículo + operador. Esa validación
// debe hacerse en el servidor. Mientras tanto, toda salida pasa por autorización de Base.
export default function NuevoParte() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const abierto = useColeccion("partes").find(
    (p) => p.creadoPor === operador?.id && p.estado !== "cerrado" && p.estado !== "rechazado",
  );

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

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operador) return;
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? "").trim();

    const parte = agregar("partes", {
      creadoPor: operador.id,
      operador: operador.nombre_completo,
      creadoEn: new Date().toISOString(),
      fecha: hoy(),
      vehiculo: texto("vehiculo"),
      tarea: texto("tarea"),
      cliente: texto("cliente"),
      locacion: texto("locacion"),
      kmInicial: Number(texto("kmInicial")),
      observaciones: texto("observaciones"),
      estado: "pendiente",
      resueltoPor: "",
      resueltoEn: "",
      motivoRechazo: "",
      salidaEn: "",
      cerradoEn: "",
      kmFinal: null,
      trabajoRealizado: "",
    });
    notificar(
      PARA_SUPERVISORES,
      `Pedido de autorización: parte N° ${parte.id}`,
      `${operador.nombre_completo} pide autorización para salir con ${parte.vehiculo} (${parte.tarea}).`,
      `/partes/${parte.id}`,
    );
    navigate(`/partes/${parte.id}`);
  }

  return (
    <form className="panel" onSubmit={enviar}>
      <h2 className="panel-header">Datos del parte</h2>
      <div className="panel-body">
        <div className="form-grid">
          <label>Fecha<input value={formatFecha(hoy())} readOnly disabled /></label>
          <label>Operador<input value={operador?.nombre_completo ?? ""} readOnly disabled /></label>
        </div>
        <div className="form-grid">
          <label>Vehículo <small>(dominio o número interno)</small><input name="vehiculo" required /></label>
          <label>Kilometraje inicial<input type="number" name="kmInicial" min="0" step="1" required /></label>
          <label>Tarea
            <select name="tarea" defaultValue="" required>
              <option value="" disabled>Elegí una tarea</option>
              <option>Transporte</option><option>Izaje con hidrogrúa</option><option>Altura con barquilla</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>Cliente<input name="cliente" required /></label>
          <label>Ruta / locación<input name="locacion" placeholder="Ej: Ruta 7 hacia yacimiento" required /></label>
        </div>
        <label>Observaciones <small>(opcional)</small><textarea name="observaciones" rows={3} /></label>

        <p className="ayuda">Al guardar, el parte queda pendiente de autorización de Base. No salgas hasta que esté autorizado.</p>
        <div className="actions">
          <button type="submit" className="primary inline">Guardar y pedir autorización</button>
        </div>
      </div>
    </form>
  );
}
