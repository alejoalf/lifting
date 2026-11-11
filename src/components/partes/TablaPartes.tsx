import { Link } from "react-router-dom";
import { ESTADOS_PARTE, formatFecha, type EstadoParte, type Parte } from "../../lib/registros";

export function EstadoParteChip({ estado }: { estado: EstadoParte }) {
  return <span className={`chip estado-${estado}`}>{ESTADOS_PARTE[estado]}</span>;
}

export function TablaPartes({ partes, mostrarOperador = false }: { partes: Parte[]; mostrarOperador?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="tabla">
        <thead>
          <tr>
            <th>N°</th><th>Fecha</th>{mostrarOperador && <th>Operador</th>}<th>Vehículo</th><th>Tarea</th>
            <th>Cliente</th><th>Ruta / locación</th><th>Estado</th><th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {partes.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{formatFecha(p.fecha)}</td>
              {mostrarOperador && <td>{p.operador}</td>}
              <td>{p.vehiculo}</td>
              <td>{p.tarea}</td>
              <td>{p.cliente}</td>
              <td>{p.locacion}</td>
              <td><EstadoParteChip estado={p.estado} /></td>
              <td><Link to={`/partes/${p.id}`}>Ver parte</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
