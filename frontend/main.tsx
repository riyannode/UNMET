import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
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
      <p>This UNMET route does not exist.</p>
      <Link to={ROUTES.landing.href}>Home</Link>
      <Link to={ROUTES.market.href}>Explore Market</Link>
    </main>
  );
}

function DocsRoute() {
  return (
    <main className="unmet-docs-page" aria-label="Documentation">
      <UnmetNavigation />
    </main>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("root missing");

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path={ROUTES.landing.path} element={<UnmetLanding />} />
        <Route path={ROUTES.docs.path} element={<DocsRoute />} />
        <Route element={<Suspense fallback={<WorkspaceLoading />}><App /></Suspense>}>
          <Route id="market" path={ROUTES.market.path} element={<MarketRoute />} />
          <Route id="demand-detail" path={ROUTES.demandDetail.path} element={<DemandDetailRoute />} />
          <Route id="create-demand" path={ROUTES.createDemand.path} element={<CreateDemandRoute />} />
          <Route id="analytics" path={ROUTES.analytics.path} element={<AnalyticsRoute />} />
          <Route id="my-activity" path={ROUTES.myActivity.path} element={<Navigate to={ROUTES.analytics.href} replace />} />
        </Route>
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
