import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getSupabase, type Rol } from "../../lib/supabase";
import { contiene, documentosDe, peorSemaforo, useColeccion } from "../../lib/registros";
import { EstadoDocumental } from "../Legajo";

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

const ROLES: { valor: Rol; label: string }[] = [
  { valor: "chofer", label: "Chofer" },
  { valor: "hidrogrulero", label: "Hidrogrulero" },
  { valor: "supervisor", label: "Supervisor" },
  { valor: "admin", label: "Admin" },
];

export default function Usuarios() {
  const { operador } = useAuth();
  const documentos = useColeccion("documentos");
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState<Usuario["id"] | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let activo = true;
    getSupabase().from("operadores").select("id, auth_user_id, nombre, rol, email, telefono, cuil, activo").order("nombre")
      .then(({ data, error: fallo }) => {
        if (!activo) return;
        if (fallo) setError("No se pudieron cargar los usuarios. Revisá la conexión y los permisos (RLS) de la tabla operadores.");
        else setUsuarios(data ?? []);
      });
    return () => { activo = false; };
  }, []);

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
              <tr><th>Nombre</th><th>CUIL</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Activo</th><th>Estado documental</th></tr>
            </thead>
            <tbody>
              {visibles.map((u) => {
                const esUnoMismo = u.auth_user_id === operador?.id;
                const estado = u.auth_user_id ? peorSemaforo(documentosDe(documentos, "operador", u.auth_user_id)) : null;
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
                    <td><EstadoDocumental estado={estado} /></td>
                  </tr>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan={7} className="vacio">Ningún usuario coincide con la búsqueda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
