import { useState } from "react";
import { FormDocumento, TablaDocumentos } from "../../components/legajo/Legajo";
import { TIPOS_DOC_VEHICULO, contiene, semaforoDe, useColeccion } from "../../lib/registros";
import { useDominios } from "../../lib/useVehiculos";

export default function DocumentosFlota() {
  const documentos = useColeccion("documentos");
  const dominios = useDominios();
  const [clase, setClase] = useState("");
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const filtrados = documentos.filter((d) =>
    (!clase || d.entidad === clase) &&
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
        <h2 className="panel-header">Legajo documental completo</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Dominio, operador o documento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Clase
              <select value={clase} onChange={(e) => setClase(e.target.value)}>
                <option value="">Todos</option><option value="vehiculo">Vehículos</option><option value="operador">Operadores</option>
              </select>
            </label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option><option value="vigente">Vigente</option><option value="por-vencer">Por vencer</option><option value="vencido">Vencido</option>
              </select>
            </label>
          </div>
          {documentos.length > 0 && filtrados.length === 0
            ? <p className="vacio">Ningún documento coincide con los filtros.</p>
            : <TablaDocumentos documentos={filtrados} mostrarEntidad />}
        </div>
      </section>
    </>
  );
}
