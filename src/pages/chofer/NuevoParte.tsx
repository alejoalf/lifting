import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { crearParte, useCatalogoPartes, usePartes, type TipoTarea } from "../../lib/usePartes";
import { formatFecha, hoy } from "../../lib/registros";

const tareas: { valor: TipoTarea; etiqueta: string }[] = [
  { valor: "Transporte", etiqueta: "Transporte" },
  { valor: "Izaje Hidrogrua", etiqueta: "Izaje con hidrogrúa" },
  { valor: "Altura Barquilla", etiqueta: "Altura con barquilla" },
];

function esTipoTarea(valor: string): valor is TipoTarea {
  return tareas.some((tarea) => tarea.valor === valor);
}

export default function NuevoParte() {
  const { operador } = useAuth();
  const navigate = useNavigate();
  const { partes, loading: cargandoPartes, error: errorPartes } = usePartes();
  const { catalogo, loading: cargandoCatalogo, error: errorCatalogo } = useCatalogoPartes();
  const [clienteId, setClienteId] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [tipoTarea, setTipoTarea] = useState<TipoTarea | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!operador) return null;
  if (cargandoPartes || cargandoCatalogo) return <p className="estado">Cargando datos para crear el parte…</p>;
  if (errorPartes || errorCatalogo) {
    return <p className="error" role="alert">{errorPartes || errorCatalogo}</p>;
  }

  const abierto = partes.find((parte) =>
    parte.creadoPor === operador.id && parte.estado !== "cerrado" && parte.estado !== "frenado");
  if (abierto) {
    return (
      <section className="panel">
        <h2 className="panel-header">Ya tenés un parte pendiente</h2>
        <div className="panel-body">
          <p>El parte N° {abierto.numero} debe completar el control documental antes de iniciar una salida.</p>
          <div className="actions"><Link to={`/partes/${abierto.id}`} className="primary inline">Ver parte pendiente</Link></div>
        </div>
      </section>
    );
  }

  const contratos = catalogo.contratos.filter((contrato) =>
    contrato.clienteId === clienteId && contrato.vehiculoId === vehiculoId);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!tipoTarea) {
      setError("Elegí el tipo de tarea.");
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const parte = await crearParte({
        clienteId,
        contratoId: contratoId || null,
        vehiculoId,
        tipoTarea,
        origen: String(form.get("origen") ?? "").trim(),
        destino: String(form.get("destino") ?? "").trim(),
        kmInicial: Number(form.get("kmInicial")),
        observaciones: String(form.get("observaciones") ?? "").trim(),
      });
      navigate(`/partes/${parte.id}`);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo registrar el parte. Revisá la conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
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
          <label>Cliente
            <select value={clienteId} onChange={(event) => {
              setClienteId(event.target.value);
              setContratoId("");
            }} required>
              <option value="" disabled>Elegí un cliente</option>
              {catalogo.clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}
            </select>
          </label>
          <label>Vehículo disponible
            <select value={vehiculoId} onChange={(event) => {
              setVehiculoId(event.target.value);
              setContratoId("");
            }} required>
              <option value="" disabled>Elegí un vehículo</option>
              {catalogo.vehiculos.map((vehiculo) => <option key={vehiculo.id} value={vehiculo.id}>{vehiculo.nombre}</option>)}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>Contrato <small>(opcional)</small>
            <select value={contratoId} onChange={(event) => setContratoId(event.target.value)}>
              <option value="">Sin contrato</option>
              {contratos.map((contrato) => <option key={contrato.id} value={contrato.id}>{contrato.nombre}</option>)}
            </select>
          </label>
          <label>Kilometraje inicial<input type="number" name="kmInicial" min="0" step="1" required /></label>
          <label>Tarea
            <select value={tipoTarea} onChange={(event) => {
              const value = event.target.value;
              setTipoTarea(esTipoTarea(value) ? value : "");
            }} required>
              <option value="" disabled>Elegí una tarea</option>
              {tareas.map((tarea) => <option key={tarea.valor} value={tarea.valor}>{tarea.etiqueta}</option>)}
            </select>
          </label>
        </div>
        {clienteId && vehiculoId && contratos.length === 0 && (
          <p className="ayuda">No hay contratos vigentes para esta combinación de cliente y vehículo.</p>
        )}
        {catalogo.clientes.length === 0 && <p className="error" role="alert">No hay clientes disponibles para crear un parte.</p>}
        {catalogo.vehiculos.length === 0 && <p className="error" role="alert">No hay vehículos disponibles para crear un parte.</p>}
        <div className="form-grid">
          <label>Origen<input name="origen" required /></label>
          <label>Destino<input name="destino" placeholder="Ruta o locación" required /></label>
        </div>
        <label>Observaciones <small>(opcional)</small><textarea name="observaciones" rows={3} /></label>
        <p className="aviso-local" role="note">
          El control documental todavía no está conectado a Supabase. El parte se guardará como pendiente y no habilita la salida del vehículo.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary inline" disabled={submitting || !catalogo.clientes.length || !catalogo.vehiculos.length}>
            {submitting ? "Guardando…" : "Registrar parte pendiente"}
          </button>
        </div>
      </div>
    </form>
  );
}
