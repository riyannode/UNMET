import { StrictMode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import UnmetNavigation from "../UnmetNavigation.tsx";
import UnmetFooter from "../UnmetFooter.tsx";
import "../unmet-landing.css";

const element = document.getElementById("docs-navigation");
if (!element) throw new Error("docs navigation root missing");
const footer = document.getElementById("docs-footer");
if (!footer) throw new Error("docs footer root missing");

createRoot(element).render(
  <StrictMode>
    <BrowserRouter>
      <UnmetNavigation documentNavigation />
      {createPortal(<UnmetFooter />, footer)}
    </BrowserRouter>
  </StrictMode>,
);
