import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router";
import { Toaster } from "sonner";
import UnmetLanding from "./UnmetLanding.tsx";
import UnmetNavigation from "./UnmetNavigation.tsx";
import { ROUTES } from "./routing.ts";
import "./app.css";

const App = lazy(() => import("./App.tsx"));
const MarketRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.MarketRoute })));
const DemandDetailRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.DemandDetailRoute })));
const CreateDemandRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.CreateDemandRoute })));
const AnalyticsRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.AnalyticsRoute })));

function WorkspaceLoading() {
  return <main className="unmet-not-found" role="status">Loading UNMET…</main>;
}

function NotFoundRoute() {
  return (
    <main className="unmet-not-found">
      <h1>Page not found</h1>
      <p>This UNMET route does not exist</p>
      <Link to={ROUTES.landing.href}>Home</Link>
      <Link to={ROUTES.market.href}>Explore Market</Link>
    </main>
  );
}

function CanonicalRoute() {
  const { pathname } = useLocation();
  useEffect(() => {
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = "https://unmetxyz.my.id" + (pathname === "/" ? "/" : pathname);
  }, [pathname]);
  return null;
}

function DocsRoute() {
  return (
    <main className="unmet-docs-page" aria-label="Documentation">
      <UnmetNavigation />
      <section className="unmet-docs-content">
        <h1>UNMET API docs</h1>
        <p>Public demand data is free. Ranked demand intelligence is a separate OKX x402 paid endpoint.</p>
        <nav aria-label="API documentation">
          <a href="/docs/index.html">Read API documentation</a>
          <a href="/api.md">API reference (Markdown)</a>
          <a href="/openapi.json">OpenAPI 3.1</a>
          <a href="/payment.md">Payment and recovery guide</a>
          <a href="/.well-known/api-catalog">RFC 9727 API catalog</a>
        </nav>
      </section>
    </main>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("root missing");

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <CanonicalRoute />
      <Routes>
        <Route path={ROUTES.landing.path} element={<UnmetLanding />} />
        <Route path={ROUTES.docs.path} element={<DocsRoute />} />
        <Route element={<Suspense fallback={<WorkspaceLoading />}><App /></Suspense>}>
          <Route id="market" path={ROUTES.market.path} element={<MarketRoute />} />
          <Route id="demand-detail" path={ROUTES.demandDetail.path} element={<DemandDetailRoute />} />
          <Route id="create-demand" path={ROUTES.createDemand.path} element={<CreateDemandRoute />} />
          <Route id="analytics" path={ROUTES.analytics.path} element={<AnalyticsRoute />} />
        </Route>
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
      <Toaster
        position="top-right"
        theme="light"
        closeButton
        toastOptions={{
          duration: 5000,
          style: {
            background: "#ffffff",
            color: "#192800",
            border: "1px solid #d9e3ce",
            fontFamily: "Inter Tight, sans-serif",
          },
          actionButtonStyle: {
            background: "#eff6e5",
            color: "#192800",
          },
        }}
      />
    </BrowserRouter>
  </StrictMode>,
);
