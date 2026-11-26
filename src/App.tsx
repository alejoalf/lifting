import { Routes, Route, Navigate } from "react-router-dom";
import { RequireRole } from "./auth/RequireRole";
import { AppShell } from "./components/layout/AppShell";
import Login from "./pages/Login";
import AutorizarSalida from "./pages/AutorizarSalida";
import ChoferInicio from "./pages/chofer/Inicio";
import NuevoParte from "./pages/chofer/NuevoParte";
import SupervisorPanel from "./pages/supervisor/Panel";
import AdminPanel from "./pages/admin/Panel";
import NuevoGerenciamiento from "./pages/gerenciamientos/Nuevo";
import HistoricoGerenciamientos from "./pages/gerenciamientos/Historico";
import ConstanciaGerenciamiento from "./pages/gerenciamientos/Constancia";
import VerificarConstancia from "./pages/VerificarConstancia";
import DetalleParte from "./pages/partes/Detalle";
import InformeParte from "./pages/partes/Informe";
import Vehiculo from "./pages/admin/Flota";
import Clientes, { FichaCliente } from "./pages/admin/Clientes";
import Contratos, { FichaContrato } from "./pages/admin/Contratos";
import Certificaciones, { FichaCertificacion } from "./pages/admin/Certificaciones";
import Usuarios from "./pages/admin/Usuarios";
import Proveedores from "./pages/admin/Proveedores";
import Caja, { FichaMovimiento } from "./pages/admin/Caja";
import Strix from "./pages/admin/Strix";
import Legajo from "./pages/Legajo";
import Legajos, { LegajoDetalle } from "./pages/admin/Legajos";
import Requisitos from "./pages/admin/Requisitos";
import DocumentosChecklist from "./pages/admin/DocumentosChecklist";
import HistoricoChecklist, { DetalleChecklist } from "./pages/checklist/Historico";
import NuevoChecklist from "./pages/checklist/Nuevo";
import NuevaObservacion from "./pages/observaciones/Nueva";
import HistoricoObservaciones from "./pages/observaciones/Historico";
import Notificaciones from "./pages/Notificaciones";
import MatrizRiesgos from "./pages/MatrizRiesgos";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Pública: enlace firmado del mail de salida excepcional (lo valida la Edge Function "correos"). */}
      <Route path="/autorizar-salida" element={<AutorizarSalida />} />
      {/* Pública: comprueba el código de verificación impreso en una constancia de gerenciamiento. */}
      <Route path="/verificar/:hash" element={<VerificarConstancia />} />
      <Route element={<RequireRole roles={["chofer", "hidrogrulero", "supervisor", "admin"]}><AppShell /></RequireRole>}>
        <Route path="/chofer" element={<RequireRole roles={["chofer", "hidrogrulero"]}><ChoferInicio /></RequireRole>} />
        <Route path="/chofer/nuevo" element={<RequireRole roles={["chofer", "hidrogrulero"]}><NuevoParte /></RequireRole>} />
        <Route path="/supervisor" element={<RequireRole roles={["supervisor", "admin"]}><SupervisorPanel /></RequireRole>} />
        <Route path="/admin" element={<RequireRole roles={["admin"]}><AdminPanel /></RequireRole>} />
        {/* Disponibles para todos los roles autenticados (el guard del layout ya los cubre). */}
        <Route path="/gerenciamientos" element={<HistoricoGerenciamientos />} />
        <Route path="/gerenciamientos/nuevo" element={<NuevoGerenciamiento />} />
        <Route path="/gerenciamientos/:gerenciamientoId" element={<ConstanciaGerenciamiento />} />
        <Route path="/admin/flota/:vehiculoId" element={<RequireRole roles={["admin"]}><Vehiculo /></RequireRole>} />
        <Route path="/admin/clientes" element={<RequireRole roles={["admin"]}><Clientes /></RequireRole>} />
        <Route path="/admin/clientes/:clienteId" element={<RequireRole roles={["admin"]}><FichaCliente /></RequireRole>} />
        <Route path="/admin/contratos" element={<RequireRole roles={["admin"]}><Contratos /></RequireRole>} />
        <Route path="/admin/contratos/:contratoId" element={<RequireRole roles={["admin"]}><FichaContrato /></RequireRole>} />
        <Route path="/admin/certificaciones" element={<RequireRole roles={["admin"]}><Certificaciones /></RequireRole>} />
        <Route path="/admin/certificaciones/:certificacionId" element={<RequireRole roles={["admin"]}><FichaCertificacion /></RequireRole>} />
        <Route path="/admin/usuarios" element={<RequireRole roles={["admin"]}><Usuarios /></RequireRole>} />
        <Route path="/admin/caja" element={<RequireRole roles={["admin"]}><Caja /></RequireRole>} />
        <Route path="/admin/caja/:movimientoId" element={<RequireRole roles={["admin"]}><FichaMovimiento /></RequireRole>} />
        <Route path="/admin/strix" element={<RequireRole roles={["admin"]}><Strix /></RequireRole>} />
        <Route path="/admin/documentos-checklist" element={<Navigate to="/checklist/documentos" replace />} />
        <Route path="/admin/proveedores" element={<RequireRole roles={["admin"]}><Proveedores /></RequireRole>} />
        {/* Direcciones viejas. */}
        <Route path="/admin/datos/caja" element={<Navigate to="/admin/caja" replace />} />
        <Route path="/admin/datos/proveedores" element={<Navigate to="/admin/proveedores" replace />} />
        <Route path="/legajo" element={<Legajo />} />
        <Route path="/admin/legajos" element={<RequireRole roles={["supervisor", "admin"]}><Legajos /></RequireRole>} />
        <Route path="/admin/legajos/requisitos" element={<RequireRole roles={["admin"]}><Requisitos /></RequireRole>} />
        <Route path="/admin/legajos/:operadorId" element={<RequireRole roles={["supervisor", "admin"]}><LegajoDetalle /></RequireRole>} />
        <Route path="/partes/:id" element={<DetalleParte />} />
        <Route path="/partes/:id/informe/:perfil" element={<InformeParte />} />
        <Route path="/checklist" element={<HistoricoChecklist />} />
        <Route path="/checklist/nuevo" element={<NuevoChecklist />} />
        <Route path="/checklist/documentos" element={<RequireRole roles={["admin"]}><DocumentosChecklist /></RequireRole>} />
        <Route path="/checklist/:checklistId" element={<DetalleChecklist />} />
        <Route path="/observaciones" element={<HistoricoObservaciones />} />
        <Route path="/observaciones/nueva" element={<NuevaObservacion />} />
        <Route path="/notificaciones" element={<Notificaciones />} />
        <Route path="/matriz-riesgos" element={<MatrizRiesgos />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
