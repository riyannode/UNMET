import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import UnmetNavigation from "../UnmetNavigation.tsx";
import "../unmet-landing.css";

const element = document.getElementById("docs-navigation");
if (!element) throw new Error("docs navigation root missing");

createRoot(element).render(
  <StrictMode>
    <BrowserRouter>
      <UnmetNavigation documentNavigation />
    </BrowserRouter>
  </StrictMode>,
);
