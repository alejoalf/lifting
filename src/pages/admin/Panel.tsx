import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { TablaRemota } from "../../components/datos/TablaRemota";

const etiquetas = {
  dominio: "Dominio",
  marca_modelo: "Marca / modelo",
  equipo: "Equipo",
  estado: "Estado",
  titularidad: "Titularidad",
  venc_seguro: "Vencimiento seguro",
  venc_patente: "Vencimiento patente",
};

export default function AdminPanel() {
  const { operador } = useAuth();
  const nombre = operador?.nombre_completo.trim().split(/\s+/)[0] || "administración";

  return (
    <div className="dashboard-page dashboard-admin">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">ADMINISTRACIÓN DE FLOTA</span>
          <h2>Hola, {nombre}</h2>
          <p>Un resumen claro para mantener la flota y la operación bajo control.</p>
        </div>
        <Link className="dashboard-button" to="/admin/usuarios">Gestionar usuarios <span aria-hidden="true">→</span></Link>
      </section>

      <nav className="dashboard-shortcuts" aria-label="Accesos de administración">
        <Link className="dashboard-shortcut" to="/admin/documentos">
          <span className="dashboard-shortcut-icon" aria-hidden="true">01</span>
          <span><strong>Documentación de flota</strong><small>Revisá vencimientos y legajos</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
        <Link className="dashboard-shortcut" to="/admin/usuarios">
          <span className="dashboard-shortcut-icon" aria-hidden="true">02</span>
          <span><strong>Usuarios y roles</strong><small>Administrá accesos y solicitudes</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
        <Link className="dashboard-shortcut" to="/admin/datos/clientes">
          <span className="dashboard-shortcut-icon" aria-hidden="true">03</span>
          <span><strong>Datos maestros</strong><small>Clientes, contratos y más</small></span>
          <span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span>
        </Link>
      </nav>

      <div className="dashboard-fleet">
        <div className="dashboard-section-heading">
          <span className="dashboard-section-kicker">VISTA GENERAL</span>
          <h2>Estado de la flota</h2>
          <p>Unidades registradas y agrupadas por estado.</p>
        </div>
        <TablaRemota tabla="vehiculos" titulo="Unidades" etiquetas={etiquetas} orden="dominio" agruparPor="estado" />
      </div>
    </div>
  );
}
