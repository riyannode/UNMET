import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import UnmetLanding from "./UnmetLanding.tsx";
import "./app.css";

const el = document.getElementById("root");
if (!el) throw new Error("root missing");
createRoot(el).render(
  <StrictMode>
    <UnmetLanding />
  </StrictMode>,
);
