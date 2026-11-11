import { useAuth } from "../auth/AuthProvider";
import { FormDocumento, TablaDocumentos } from "../components/legajo/Legajo";
import { TIPOS_DOC_OPERADOR, documentosDe, peorSemaforo, useColeccion } from "../lib/registros";

export function EstadoDocumental({ estado }: { estado: ReturnType<typeof peorSemaforo> }) {
  if (!estado) return <span className="chip sin-datos">Sin legajo</span>;
  return estado === "vencido"
    ? <span className="chip vencido">Bloqueado</span>
    : <span className="chip vigente">Habilitado</span>;
}

export default function Legajo() {
  const { operador } = useAuth();
  const documentos = useColeccion("documentos");
  if (!operador) return null;

  const propios = documentos.filter((d) => d.entidad === "operador" && d.entidadId === operador.id);
  const estado = peorSemaforo(documentosDe(documentos, "operador", operador.id));

  return (
    <>
      <section className="panel">
        <h2 className="panel-header panel-header-fila">Mi estado documental<EstadoDocumental estado={estado} /></h2>
        <div className="panel-body">
          <p className="ayuda">
            Quedás bloqueado si tenés algún documento vencido. Al renovar uno, cargalo de nuevo: cuenta el de vencimiento más lejano.
          </p>
          <TablaDocumentos documentos={propios} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Cargar documento</h2>
        <div className="panel-body">
          <FormDocumento tipos={TIPOS_DOC_OPERADOR} operador={{ id: operador.id, nombre: operador.nombre_completo }} />
        </div>
      </section>
    </>
  );
}
