import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import UnmetLanding from "./UnmetLanding.tsx";
import "./app.css";

const el = document.getElementById("root");
if (!el) throw new Error("root missing");
const path = window.location.pathname.replace(/\/+$/, "") || "/";
const page = path === "/market" ? <App /> : <UnmetLanding />;

createRoot(el).render(
  <StrictMode>
    {page}
  </StrictMode>,
);
