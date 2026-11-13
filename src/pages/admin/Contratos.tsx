import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormFila, TablaFilas, ZonaEliminar, textoFila } from "../../components/datos/FormFila";
import { contiene } from "../../lib/registros";
import {
  certificacionesDe, certificadosDe, eliminarFila, guardarFila, nombreContrato, referencias, texto, useComercial,
} from "../../lib/comercial";
import { CeldaCobro, ChipContrato, TablaCertificados } from "./Clientes";

/** Todos los contratos, de todos los clientes. */
export default function Contratos() {
  const { datos, error } = useComercial();
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando contratos…</p>;

  const refs = referencias(datos);
  const estados = datos.columnas.contratos.find((c) => c.columna === "estado_contrato")?.opciones ?? [];
  const visibles = datos.contratos.filter((c) =>
    (!estado || texto(c.estado_contrato) === estado) &&
    contiene(textoFila(datos.columnas.contratos, c, refs), busqueda));

  return (
    <>
      <div className="stats">
        <div className="stat stat-total"><span className="stat-label">CONTRATOS</span><span className="stat-value">{datos.contratos.length}</span></div>
        {estados.map((e) => (
          <div className={`stat${e === "Realizado - falta de pago" ? " stat-aviso" : ""}`} key={e}>
            <span className="stat-label">{e.toLocaleUpperCase("es")}</span>
            <span className="stat-value">{datos.contratos.filter((c) => texto(c.estado_contrato) === e).length}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2 className="panel-header panel-header-fila">
          Contratos y acuerdos
          <Link className="secondary enlace-boton" to="/admin/contratos/nuevo">Agregar contrato</Link>
        </h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Cliente, vehículo, modalidad…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option>
                {estados.map((e) => <option key={e}>{e}</option>)}
              </select>
            </label>
          </div>
          <TablaFilas
            columnas={datos.columnas.contratos}
            filas={visibles}
            referencias={refs}
            ocultar={["estado_contrato"]}
            enlace={(c) => `/admin/contratos/${c.id}`}
            extra={{ titulo: "Estado", celda: (c) => <ChipContrato contrato={c} /> }}
            vacio={datos.contratos.length ? "Ningún contrato coincide con los filtros." : "Todavía no hay contratos cargados."}
          />
          <p className="resultados">Cantidad de resultados: {visibles.length}</p>
        </div>
      </section>
    </>
  );
}

/** Ficha de un contrato: condiciones, certificaciones mensuales y certificados que exige. */
export function FichaContrato() {
  const { contratoId = "" } = useParams();
  const [parametros] = useSearchParams();
  const navigate = useNavigate();
  const { datos, error, refresh } = useComercial();
  const [aviso, setAviso] = useState("");

  if (!datos) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando contrato…</p>;

  const nuevo = contratoId === "nuevo";
  const contrato = nuevo ? null : datos.contratos.find((c) => c.id === contratoId) ?? null;
  if (!nuevo && !contrato) return <p className="estado">El contrato no existe. <Link to="/admin/contratos">Volver a contratos</Link></p>;

  const refs = referencias(datos);
  const clienteId = texto(contrato?.cliente_id);

  return (
    <>
      <p className="parte-resumen">
        <Link to="/admin/contratos">← Contratos</Link>
        {contrato && <><strong>{nombreContrato(datos, contrato)}</strong><ChipContrato contrato={contrato} /></>}
        {clienteId && <Link to={`/admin/clientes/${clienteId}`}>Ver cliente</Link>}
      </p>

      <section className="panel">
        <h2 className="panel-header">{contrato ? "Condiciones del contrato" : "Nuevo contrato"}</h2>
        <div className="panel-body">
          {aviso && <p className="exito" role="status">{aviso}</p>}
          <FormFila
            key={contrato?.id ?? "nuevo"}
            columnas={datos.columnas.contratos}
            fila={contrato}
            referencias={refs}
            iniciales={{ cliente_id: parametros.get("cliente") ?? "", estado_contrato: "Pendiente" }}
            guardar={(valores) => guardarFila("contratos", contrato?.id ?? null, valores)}
            onGuardado={async (id) => {
              await refresh();
              setAviso(contrato ? "Cambios guardados." : "Contrato agregado.");
              if (!contrato) navigate(`/admin/contratos/${id}`, { replace: true });
            }}
            textoNuevo="Agregar contrato"
          />
        </div>
      </section>

      {contrato && (
        <>
          <section className="panel">
            <h2 className="panel-header panel-header-fila">
              Certificaciones mensuales
              <Link className="secondary enlace-boton" to={`/admin/certificaciones/nueva?contrato=${contrato.id}`}>Nueva certificación</Link>
            </h2>
            <div className="panel-body">
              <TablaFilas
                columnas={datos.columnas.certificaciones}
                filas={certificacionesDe(datos, [contrato])}
                referencias={refs}
                enlace={(c) => `/admin/certificaciones/${c.id}`}
                extra={{ titulo: "Importe y cobro", celda: (c) => <CeldaCobro datos={datos} certificacion={c} /> }}
                vacio="Este contrato todavía no tiene certificaciones."
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-header panel-header-fila">
              Certificados y requisitos que exige
              <Link className="secondary enlace-boton" to="/admin/certificaciones?vista=certificados">Administrar</Link>
            </h2>
            <div className="panel-body">
              <TablaCertificados
                certificados={certificadosDe(datos, clienteId || null, [contrato])}
                vacio="No hay certificados asignados a este contrato ni a su cliente."
              />
            </div>
          </section>

          <ZonaEliminar
            titulo="Eliminar contrato"
            ayuda="Si el contrato tiene certificaciones o partes asociados no se puede eliminar: en ese caso pasalo a Finalizado."
            confirmacion="¿Eliminar este contrato? No se puede deshacer."
            eliminar={async () => {
              await eliminarFila("contratos", contrato.id);
              navigate("/admin/contratos");
            }}
          />
        </>
      )}
    </>
  );
}
