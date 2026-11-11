import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import { isSupabaseConfigured } from "./lib/supabase";
import ConfigurationRequired from "./pages/ConfigurationRequired";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSupabaseConfigured
      ? <BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter>
      : <ConfigurationRequired />}
  </React.StrictMode>
);
