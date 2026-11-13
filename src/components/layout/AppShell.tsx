import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import type { Rol } from "../../lib/supabase";
import { NotificationBell } from "./NotificationBell";

interface NavigationItem {
  label: string;
  to: string;
  icon: string;
  roles?: Rol[]; // sin roles = visible para todos
}

const navigation: { caption: string; items: NavigationItem[] }[] = [
  {
    caption: "OPERACIONES",
    items: [
      { label: "Mis partes", to: "/chofer", icon: "P", roles: ["chofer", "hidrogrulero"] },
      { label: "Nuevo parte", to: "/chofer/nuevo", icon: "+", roles: ["chofer", "hidrogrulero"] },
      { label: "Partes", to: "/supervisor", icon: "P", roles: ["supervisor", "admin"] },
      { label: "Mi legajo", to: "/legajo", icon: "L" },
      { label: "Legajos del personal", to: "/admin/legajos", icon: "H", roles: ["supervisor", "admin"] },
    ],
  },
  {
    caption: "ADMINISTRACIÓN",
    items: [
      { label: "Flota", to: "/admin", icon: "F", roles: ["admin"] },
      { label: "Requisitos por actividad", to: "/admin/legajos/requisitos", icon: "R", roles: ["admin"] },
      { label: "Usuarios y roles", to: "/admin/usuarios", icon: "U", roles: ["admin"] },
      { label: "Clientes", to: "/admin/datos/clientes", icon: "C", roles: ["admin"] },
      { label: "Contratos", to: "/admin/datos/contratos", icon: "K", roles: ["admin"] },
      { label: "Certificaciones", to: "/admin/datos/certificaciones", icon: "M", roles: ["admin"] },
      { label: "Caja y gastos", to: "/admin/datos/caja", icon: "$", roles: ["admin"] },
      { label: "Proveedores", to: "/admin/datos/proveedores", icon: "V", roles: ["admin"] },
    ],
  },
  {
    caption: "GESTIÓN VEHICULAR",
    items: [
      { label: "Crear gerenciamiento", to: "/gerenciamientos/nuevo", icon: "+" },
      { label: "Gerenciamientos", to: "/gerenciamientos", icon: "G" },
      { label: "Checklist vehicular", to: "/checklist", icon: "C" },
    ],
  },
  {
    caption: "TARJETA DE OBSERVACIÓN",
    items: [
      { label: "Nueva tarjeta", to: "/observaciones/nueva", icon: "+" },
      { label: "Histórico de tarjetas", to: "/observaciones", icon: "O" },
    ],
  },
];

const pageTitles: Record<string, string> = {
  "/chofer": "Mis partes",
  "/chofer/nuevo": "Nuevo parte",
  "/supervisor": "Partes",
  "/admin": "Flota",
  "/admin/flota/nuevo": "Nuevo vehículo",
  "/admin/usuarios": "Usuarios y roles",
  "/admin/datos/clientes": "Clientes",
  "/admin/datos/contratos": "Contratos y acuerdos",
  "/admin/datos/certificaciones": "Certificaciones mensuales",
  "/admin/datos/caja": "Caja y gastos",
  "/admin/datos/proveedores": "Proveedores",
  "/legajo": "Mi legajo",
  "/admin/legajos": "Legajos del personal",
  "/admin/legajos/requisitos": "Requisitos por actividad",
  "/gerenciamientos": "Gerenciamientos de viaje",
  "/gerenciamientos/nuevo": "Nuevo gerenciamiento",
  "/checklist": "Constancia checklist vehicular",
  "/observaciones": "Tarjetas de observaciones",
  "/observaciones/nueva": "Tarjeta de observación",
  "/notificaciones": "Historial de notificaciones",
};

// Pantallas que por ahora guardan sus datos en el navegador. El resto lee de Supabase.
const rutasConDatosLocales = /^\/(gerenciamientos|checklist|observaciones|notificaciones)/;

function formatRole(rol: Rol) {
  return rol === "admin" ? "Administrador" : rol === "hidrogrulero" ? "Hidrogrúa" : rol[0].toUpperCase() + rol.slice(1);
}

export function AppShell() {
  const { operador, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const focusPageAfterNavigation = useRef(false);

  useEffect(() => {
    setMobileOpen(false);
    if (focusPageAfterNavigation.current) {
      focusPageAfterNavigation.current = false;
      pageHeading.current?.focus();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const focusableElements = sidebar.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusableElements?.[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        mobileMenuButton.current?.focus();
      } else if (event.key === "Tab" && focusableElements?.length) {
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  async function salir() {
    setSignOutError("");
    try {
      await signOut();
    } catch {
      setSignOutError("No se pudo cerrar la sesión. Intentá de nuevo.");
    }
  }

  const title = pageTitles[location.pathname]
    ?? (location.pathname.includes("/informe/") ? "Informe del parte"
      : location.pathname.startsWith("/partes/") ? "Parte diario"
        : location.pathname.startsWith("/admin/legajos/") ? "Legajo del operador"
          : location.pathname.startsWith("/admin/flota/") ? "Vehículo" : "Lifting Patagonia");
  const esInicio = ["/chofer", "/supervisor", "/admin"].includes(location.pathname);
  const groups = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => operador && (!item.roles || item.roles.includes(operador.rol))),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Cerrar menú"
          onClick={() => {
            setMobileOpen(false);
            mobileMenuButton.current?.focus();
          }}
        />
      )}

      <aside ref={sidebar} className={`sidebar${mobileOpen ? " is-open" : ""}`} id="primary-navigation">
        <NavLink
          className="brand"
          to={operador ? (operador.rol === "admin" ? "/admin" : operador.rol === "supervisor" ? "/supervisor" : "/chofer") : "/login"}
          aria-label="Lifting Patagonia, inicio"
          onClick={() => { focusPageAfterNavigation.current = mobileOpen; }}
        >
          <img className="brand-mark" src="/logo.png" alt="" width={828} height={682} />
          <span className="brand-name">Lifting Patagonia</span>
        </NavLink>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {groups.map((group) => (
            <div key={group.caption}>
              <p className="sidebar-caption">{group.caption}</p>
              <div className="nav-list">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    onClick={() => { focusPageAfterNavigation.current = mobileOpen; }}
                  >
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-status" aria-hidden="true" />
          <span className="sidebar-caption">PORTAL OPERATIVO</span>
        </div>
      </aside>

      <div className={`workspace${esInicio ? " workspace-dashboard" : ""}`}>
        <header className="workspace-header">
          <button
            ref={mobileMenuButton}
            className="icon-button mobile-menu-button"
            type="button"
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileOpen}
            aria-controls="primary-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span>
          </button>
          <button
            className="icon-button collapse-button"
            type="button"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          </button>

          <div className="header-section">
            <span className="header-eyebrow">LIFTING PATAGONIA</span>
            <span className="header-title">{title}</span>
          </div>

          <div className="user-menu">
            <NotificationBell />
            <div className="user-details">
              <span className="user-name">{operador?.nombre_completo}</span>
              {operador && <span className="user-role">{formatRole(operador.rol)}</span>}
            </div>
            <button className="sign-out-button" type="button" onClick={salir}>Salir</button>
          </div>
        </header>

        {signOutError && <p className="sign-out-error" role="alert">{signOutError}</p>}

        <main className="page-content">
          <div className="page-heading">
            <p className="page-kicker">OPERACIONES</p>
            <h1 ref={pageHeading} tabIndex={-1}>{title}</h1>
          </div>
          {rutasConDatosLocales.test(location.pathname) && (
            <p className="aviso-local" role="note">
              Versión de prueba: lo que cargues en esta pantalla se guarda solo en este navegador, todavía no en la base de datos.
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
