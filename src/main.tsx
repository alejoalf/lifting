import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import { isSupabaseConfigured } from "./lib/supabase";
import "./styles.css";

function ConfiguracionRequerida() {
  return (
    <main className="configuracion">
      <section className="card">
        <h1>Lifting Patagonia</h1>
        <h2>Falta configurar Supabase</h2>
        <p>La app necesita las credenciales de tu proyecto para iniciar sesión y cargar los datos.</p>
        <ol>
          <li>Creá un archivo <code>.env.local</code> en la carpeta principal del proyecto.</li>
          <li>Copiá las variables de <code>.env.example</code> y completalas con los datos de Supabase.</li>
          <li>Reiniciá el servidor con <code>npm run dev</code>.</li>
        </ol>
        <p className="ayuda">Encontrás la URL y la clave pública en la configuración de API de tu proyecto Supabase.</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSupabaseConfigured
      ? <BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter>
      : <ConfiguracionRequerida />}
  </React.StrictMode>
);
