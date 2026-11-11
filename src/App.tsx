import { Routes, Route, Navigate } from "react-router-dom";
import { RequireRole } from "./auth/RequireRole";
import { AppShell } from "./components/layout/AppShell";
import Login from "./pages/Login";
import ChoferInicio from "./pages/chofer/Inicio";
import NuevoParte from "./pages/chofer/NuevoParte";
import SupervisorPanel from "./pages/supervisor/Panel";
import AdminPanel from "./pages/admin/Panel";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireRole roles={["chofer", "hidrogrulero", "supervisor", "admin"]}><AppShell /></RequireRole>}>
        <Route path="/chofer" element={<RequireRole roles={["chofer", "hidrogrulero"]}><ChoferInicio /></RequireRole>} />
        <Route path="/chofer/nuevo" element={<RequireRole roles={["chofer", "hidrogrulero"]}><NuevoParte /></RequireRole>} />
        <Route path="/supervisor" element={<RequireRole roles={["supervisor", "admin"]}><SupervisorPanel /></RequireRole>} />
        <Route path="/admin" element={<RequireRole roles={["admin"]}><AdminPanel /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
