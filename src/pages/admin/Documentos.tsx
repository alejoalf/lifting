import { useState } from "react";
import { FormDocumento, TablaDocumentos } from "../../components/legajo/Legajo";
import { TIPOS_DOC_VEHICULO, contiene, semaforoDe, useColeccion } from "../../lib/registros";
import { useDominios } from "../../lib/useVehiculos";

export default function DocumentosFlota() {
  const documentos = useColeccion("documentos");
  const dominios = useDominios();
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const filtrados = documentos.filter((d) =>
    d.entidad === "vehiculo" &&
    (!estado || semaforoDe(d.vencimiento) === estado) &&
    contiene(`${d.entidadNombre} ${d.tipo}`, busqueda));

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Cargar documento de un vehículo</h2>
        <div className="panel-body">
          <FormDocumento tipos={TIPOS_DOC_VEHICULO} dominios={dominios} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Documentos de la flota</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Dominio o documento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option><option value="vigente">Vigente</option><option value="por-vencer">Por vencer</option><option value="vencido">Vencido</option>
              </select>
            </label>
          </div>
          {filtrados.length === 0 && (busqueda || estado)
            ? <p className="vacio">Ningún documento coincide con los filtros.</p>
            : <TablaDocumentos documentos={filtrados} mostrarEntidad />}
        </div>
      </section>
    </>
  );
}
