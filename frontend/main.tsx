import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import UnmetLanding from "./UnmetLanding.tsx";
import { ROUTES } from "./routing.ts";
import "./app.css";

const App = lazy(() => import("./App.tsx"));
const MarketRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.MarketRoute })));
const DemandDetailRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.DemandDetailRoute })));
const CreateDemandRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.CreateDemandRoute })));
const MyActivityRoute = lazy(() => import("./App.tsx").then((module) => ({ default: module.MyActivityRoute })));

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

const el = document.getElementById("root");
if (!el) throw new Error("root missing");

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path={ROUTES.landing.path} element={<UnmetLanding />} />
        <Route element={<Suspense fallback={<WorkspaceLoading />}><App /></Suspense>}>
          <Route id="market" path={ROUTES.market.path} element={<MarketRoute />} />
          <Route id="demand-detail" path={ROUTES.demandDetail.path} element={<DemandDetailRoute />} />
          <Route id="create-demand" path={ROUTES.createDemand.path} element={<CreateDemandRoute />} />
          <Route id="my-activity" path={ROUTES.myActivity.path} element={<MyActivityRoute />} />
        </Route>
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
