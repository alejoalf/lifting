import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { actualizar, useColeccion } from "../../lib/registros";

export function NotificationBell() {
  const { operador } = useAuth();
  const location = useLocation();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const propias = useColeccion("notificaciones").filter((n) => n.para === operador?.id);
  const sinLeer = propias.filter((n) => !n.leida).length;

  useEffect(() => setAbierto(false), [location.pathname]);

  useEffect(() => {
    if (!abierto) return;
    function cerrarSiAfuera(event: MouseEvent) {
      if (!contenedor.current?.contains(event.target as Node)) setAbierto(false);
    }
    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", cerrarSiAfuera);
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.removeEventListener("mousedown", cerrarSiAfuera);
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [abierto]);

  return (
    <div className="bell" ref={contenedor}>
      <button
        type="button"
        className="icon-button"
        aria-label={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : "Notificaciones"}
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
        </svg>
        {sinLeer > 0 && <span className="bell-count" aria-hidden="true">{sinLeer}</span>}
      </button>

      {abierto && (
        <div className="bell-menu">
          <p className="bell-menu-title">NOTIFICACIONES</p>
          {propias.length === 0 && <p className="bell-empty">No tenés notificaciones.</p>}
          {propias.slice(0, 4).map((n) => (
            <Link
              key={n.id}
              to="/notificaciones"
              className={`bell-item${n.leida ? "" : " no-leida"}`}
              onClick={() => actualizar("notificaciones", n.id, { leida: true })}
            >
              <span className="bell-item-title">{n.titulo}</span>
              <span>{n.mensaje}</span>
            </Link>
          ))}
          <Link to="/notificaciones" className="bell-all">Ver todo</Link>
        </div>
      )}
    </div>
  );
}
