import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { actualizar, esPara, formatFechaHora, marcarNotificacionesLeidas, useColeccion } from "../lib/registros";

const pestañas = [
  { clave: "todas", label: "Todas las notificaciones" },
  { clave: "no-leidas", label: "No leídas" },
  { clave: "leidas", label: "Leídas" },
] as const;

export default function Notificaciones() {
  const { operador } = useAuth();
  const [pestaña, setPestaña] = useState<(typeof pestañas)[number]["clave"]>("todas");
  const propias = useColeccion("notificaciones").filter((n) => esPara(n, operador));
  const visibles = propias.filter((n) => pestaña === "todas" || (pestaña === "leidas") === n.leida);

  return (
    <>
      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Filtrar notificaciones">
          {pestañas.map((p) => (
            <button key={p.clave} type="button" role="tab" aria-selected={pestaña === p.clave} className="tab" onClick={() => setPestaña(p.clave)}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="secondary" disabled={!propias.some((n) => !n.leida)} onClick={() => operador && marcarNotificacionesLeidas(operador)}>
          Marcar todo como leído
        </button>
      </div>

      <section className="panel">
        <h2 className="panel-header">Hacé clic en una notificación para abrirla.</h2>
        <div className="panel-body">
          {visibles.length === 0 && <p className="vacio">No hay notificaciones para mostrar.</p>}
          {visibles.map((n) => (
            <Link
              key={n.id}
              to={n.enlace || "/notificaciones"}
              className={`notificacion${n.leida ? "" : " no-leida"}`}
              onClick={() => actualizar("notificaciones", n.id, { leida: true })}
            >
              <span className="notificacion-titulo">
                {n.titulo}
                <span className="notificacion-estado">{n.leida ? "Leída" : "No leída"}</span>
              </span>
              <span className="notificacion-mensaje">{n.mensaje}</span>
              <span className="notificacion-fecha">{formatFechaHora(n.fecha)}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
