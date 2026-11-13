import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getSupabase, type Rol } from "../../lib/supabase";
import { Link } from "react-router-dom";
import { contiene } from "../../lib/registros";

interface Usuario {
  id: string | number;
  auth_user_id: string | null;
  nombre: string;
  rol: string;
  email: string | null;
  telefono: string | null;
  cuil: string | null;
  activo: boolean | null;
}

interface SolicitudRegistro {
  id: string;
  auth_user_id: string;
  nombre: string;
  email: string;
  rol_solicitado: string;
  creado_en: string;
}

const ROLES: { valor: Rol; label: string }[] = [
  { valor: "chofer", label: "Chofer" },
  { valor: "hidrogrulero", label: "Hidrogrulero" },
  { valor: "supervisor", label: "Supervisor" },
  { valor: "admin", label: "Admin" },
];

export default function Usuarios() {
  const { operador } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<SolicitudRegistro[] | null>(null);
  const [rolesSolicitados, setRolesSolicitados] = useState<Record<string, Rol>>({});
  const [error, setError] = useState("");
  const [errorSolicitudes, setErrorSolicitudes] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState<Usuario["id"] | null>(null);
  const [guardandoSolicitud, setGuardandoSolicitud] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const [resultadoUsuarios, resultadoSolicitudes] = await Promise.all([
          getSupabase().from("operadores").select("id, auth_user_id, nombre, rol, email, telefono, cuil, activo").order("nombre"),
          getSupabase().from("solicitudes_registro")
            .select("id, auth_user_id, nombre, email, rol_solicitado, creado_en")
            .eq("estado", "pendiente")
            .order("creado_en"),
        ]);
        if (!activo) return;

        if (resultadoUsuarios.error) {
          setError("No se pudieron cargar los usuarios. Revisá la conexión y los permisos (RLS) de la tabla operadores.");
        } else {
          setUsuarios(resultadoUsuarios.data ?? []);
        }

        if (resultadoSolicitudes.error) {
          setErrorSolicitudes("No se pudieron cargar las solicitudes. Verificá que la migración de registro esté aplicada y revisá los permisos RLS.");
          setSolicitudes([]);
        } else {
          const nuevasSolicitudes = resultadoSolicitudes.data ?? [];
          setSolicitudes(nuevasSolicitudes);
          setRolesSolicitados(Object.fromEntries(nuevasSolicitudes.map((solicitud) => [
            solicitud.id,
            ROLES.find((rol) => rol.valor === solicitud.rol_solicitado.toLocaleLowerCase("es"))?.valor ?? "chofer",
          ])));
        }
      } catch {
        if (!activo) return;
        setError("No se pudieron cargar los usuarios. Revisá la conexión e intentá de nuevo.");
        setErrorSolicitudes("No se pudieron cargar las solicitudes. Revisá la conexión e intentá de nuevo.");
        setUsuarios([]);
        setSolicitudes([]);
      }
    }

    void cargar();
    return () => { activo = false; };
  }, []);

  async function resolverSolicitud(solicitud: SolicitudRegistro, aprobar: boolean) {
    setAviso("");
    setError("");
    setGuardandoSolicitud(solicitud.id);
    try {
      const supabase = getSupabase();
      const resultado = aprobar
        ? await supabase.rpc("aprobar_solicitud_registro", {
          p_solicitud_id: solicitud.id,
          p_rol: rolesSolicitados[solicitud.id] ?? "chofer",
        })
        : await supabase.rpc("rechazar_solicitud_registro", { p_solicitud_id: solicitud.id });

      if (resultado.error) {
        setError(`No se pudo ${aprobar ? "aprobar" : "rechazar"} la solicitud de ${solicitud.nombre}: ${resultado.error.message}`);
        return;
      }

      setSolicitudes((actuales) => actuales?.filter((actual) => actual.id !== solicitud.id) ?? []);
      setAviso(aprobar
        ? `Solicitud aprobada. ${solicitud.nombre} ya tiene acceso con el rol ${rolesSolicitados[solicitud.id] ?? "chofer"}.`
        : `Solicitud de ${solicitud.nombre} rechazada.`);

      if (aprobar) {
        const { data, error: fallo } = await supabase
          .from("operadores")
          .select("id, auth_user_id, nombre, rol, email, telefono, cuil, activo")
          .order("nombre");
        if (fallo) {
          setError("La solicitud se aprobó, pero no se pudo actualizar la lista de operadores. Recargá la página.");
        } else {
          setUsuarios(data ?? []);
        }
      }
    } catch {
      setError(`No se pudo ${aprobar ? "aprobar" : "rechazar"} la solicitud. Revisá la conexión e intentá de nuevo.`);
    } finally {
      setGuardandoSolicitud(null);
    }
  }

  async function cambiarRol(usuario: Usuario, rol: Rol) {
    if (!usuarios) return;
    setAviso("");
    setError("");
    setGuardando(usuario.id);
    // Respeta cómo está escrito el rol en la base ("Chofer" o "chofer").
    const conMayuscula = usuarios.some((u) => /^[A-Z]/.test(u.rol));
    const valor = conMayuscula ? rol[0].toUpperCase() + rol.slice(1) : rol;
    const { data, error: fallo } = await getSupabase().from("operadores").update({ rol: valor }).eq("id", usuario.id).select("id");
    setGuardando(null);

    if (fallo || !data?.length) {
      setError(`No se pudo cambiar el rol de ${usuario.nombre}. Revisá que los administradores tengan permiso de edición (RLS) sobre operadores.`);
      return;
    }
    setUsuarios(usuarios.map((u) => (u.id === usuario.id ? { ...u, rol: valor } : u)));
    setAviso(`${usuario.nombre} ahora tiene el rol ${valor}.`);
  }

  if (!usuarios) return error ? <p className="error" role="alert">{error}</p> : <p className="estado">Cargando usuarios…</p>;

  const visibles = usuarios.filter((u) => contiene(`${u.nombre} ${u.email ?? ""} ${u.cuil ?? ""} ${u.rol}`, busqueda));

  return (
    <>
      <section className="panel">
        <h2 className="panel-header">Solicitudes de acceso</h2>
        <div className="panel-body">
          {errorSolicitudes && <p className="error" role="alert">{errorSolicitudes}</p>}
          {solicitudes === null ? <p className="estado">Cargando solicitudes…</p> : solicitudes.length === 0 ? (
            <p className="vacio">No hay solicitudes pendientes.</p>
          ) : (
            <div className="table-wrap">
              <table className="tabla tabla-izquierda">
                <thead>
                  <tr><th>Nombre</th><th>Correo</th><th>Rol solicitado</th><th>Rol asignado</th><th>Fecha</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {solicitudes.map((solicitud) => (
                    <tr key={solicitud.id}>
                      <td>{solicitud.nombre}</td>
                      <td>{solicitud.email}</td>
                      <td>{ROLES.find((rol) => rol.valor === solicitud.rol_solicitado.toLocaleLowerCase("es"))?.label ?? solicitud.rol_solicitado}</td>
                      <td>
                        <select
                          className="select-tabla"
                          aria-label={`Rol para ${solicitud.nombre}`}
                          value={rolesSolicitados[solicitud.id] ?? "chofer"}
                          disabled={guardandoSolicitud === solicitud.id}
                          onChange={(e) => setRolesSolicitados((actuales) => ({
                            ...actuales,
                            [solicitud.id]: e.target.value as Rol,
                          }))}
                        >
                          {ROLES.map((rol) => <option key={rol.valor} value={rol.valor}>{rol.label}</option>)}
                        </select>
                      </td>
                      <td>{new Date(solicitud.creado_en).toLocaleDateString("es-AR")}</td>
                      <td>
                        <div className="row">
                          <button
                            className="secondary"
                            type="button"
                            disabled={guardandoSolicitud !== null}
                            onClick={() => void resolverSolicitud(solicitud, true)}
                          >
                            {guardandoSolicitud === solicitud.id ? "Procesando…" : "Aprobar"}
                          </button>
                          <button
                            className="secondary peligro"
                            type="button"
                            disabled={guardandoSolicitud !== null}
                            onClick={() => void resolverSolicitud(solicitud, false)}
                          >
                            Rechazar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-header">Personal y operadores</h2>
        <div className="panel-body">
          <div className="form-grid compacto">
            <label>Buscar<input placeholder="Nombre, email, CUIL o rol" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {aviso && <p className="exito" role="status">{aviso}</p>}

          {usuarios.length <= 1 && (
            <p className="ayuda">Si esperabas ver más usuarios, revisá que los administradores tengan permiso de lectura (RLS) sobre toda la tabla operadores.</p>
          )}
          <div className="table-wrap">
            <table className="tabla tabla-izquierda">
              <thead>
                <tr><th>Nombre</th><th>CUIL</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Activo</th><th>Legajo</th></tr>
              </thead>
              <tbody>
                {visibles.map((u) => {
                  const esUnoMismo = u.auth_user_id === operador?.id;
                  return (
                    <tr key={u.id}>
                      <td>{u.nombre}</td>
                      <td>{u.cuil || "—"}</td>
                      <td>{u.email || "—"}</td>
                      <td>{u.telefono || "—"}</td>
                      <td>
                        <select
                          className="select-tabla"
                          aria-label={`Rol de ${u.nombre}`}
                          value={u.rol.trim().toLocaleLowerCase("es")}
                          disabled={esUnoMismo || guardando === u.id}
                          title={esUnoMismo ? "No podés cambiar tu propio rol" : undefined}
                          onChange={(e) => cambiarRol(u, e.target.value as Rol)}
                        >
                          {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
                        </select>
                      </td>
                      <td>{u.activo === null ? "—" : u.activo ? "Sí" : "No"}</td>
                      <td><Link to={`/admin/legajos/${u.id}`}>Ver legajo</Link></td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && <tr><td colSpan={7} className="vacio">Ningún usuario coincide con la búsqueda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
