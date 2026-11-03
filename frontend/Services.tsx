import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { CHAIN_ID, DEMAND_CONTRACT } from "./contract.ts";
import { parseDemandId, parseDemandRoute, ROUTES, serviceHref } from "./routing.ts";
import { specificationDescription } from "../shared/rfq.ts";
import UnmetNavigation from "./UnmetNavigation.tsx";
import "./unmet-landing.css";
import "./services.css";

type Service = { demandId: string; capability: string; specification: string; builder: string; serviceUrl: string; evidenceHash: string };
type Result = { state: "loading" | "error" | "notfound" } | { state: "ready"; services: Service[] };

function isService(value: unknown): value is Service {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.demandId === "string" && parseDemandId(row.demandId) !== null &&
    [row.capability, row.specification, row.builder, row.serviceUrl, row.evidenceHash].every((field) => typeof field === "string");
}

export function safeServiceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export default function Services({ detail = false }: { detail?: boolean }) {
  const params = useParams();
  const identity = detail ? parseDemandRoute(params.chainId, params.contract, params.demandId) : null;
  const invalid = detail && (!identity || identity.chainId !== CHAIN_ID || !DEMAND_CONTRACT || identity.contract !== DEMAND_CONTRACT.toLowerCase());
  const id = identity?.demandId.toString();
  const requestKey = detail ? `detail:${id}` : "list";
  const [loaded, setLoaded] = useState<{ key: string; result: Result }>({ key: requestKey, result: { state: "loading" } });
  const result: Result = loaded.key === requestKey ? loaded.result : { state: "loading" };
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    const setResult = (result: Result) => setLoaded({ key: requestKey, result });
    setResult({ state: "loading" });
    void (async () => {
      try {
        const response = await fetch(detail ? `/v1/services/${id}` : "/v1/services", { signal: controller.signal });
        if (response.status === 404 && detail) { if (!controller.signal.aborted) setResult({ state: "notfound" }); return; }
        if (!response.ok) throw new Error("unavailable");
        const value: unknown = await response.json();
        if (typeof value !== "object" || value === null) throw new Error("invalid response");
        const data = value as Record<string, unknown>;
        if (!DEMAND_CONTRACT || data.chainId !== CHAIN_ID || typeof data.contract !== "string" || data.contract.toLowerCase() !== DEMAND_CONTRACT.toLowerCase()) throw new Error("deployment mismatch");
        const services: unknown = detail ? [data.service] : data.services;
        if (!Array.isArray(services) || !services.every(isService) || (detail && services[0].demandId !== id)) throw new Error("invalid response");
        if (!controller.signal.aborted) setResult({ state: "ready", services });
      } catch { if (!controller.signal.aborted) setResult({ state: "error" }); }
    })();
    return () => controller.abort();
  }, [detail, id, invalid, requestKey]);
  const service = result.state === "ready" ? result.services[0] : undefined;
  return <div className="unmet-landing services-page"><UnmetNavigation /><main className="services-content">
    {detail ? <><Link to={ROUTES.services.href}>Back to Services</Link>{(invalid || result.state !== "ready") && <h1>Service</h1>}</> : <><h1>Services</h1><p>Services created from fulfilled UNMET demands.</p></>}
    {invalid ? <p role="alert">Invalid service route.</p> : result.state === "loading" ? <p role="status">Loading services…</p> : result.state === "error" ? <p role="alert">Services are unavailable. Please try again later.</p> : result.state === "notfound" ? <p>Service not found or demand is not fulfilled.</p> : detail && service ? <article className="service-card">
      <h1>{service.capability}</h1><p>Fulfilled</p><h2>Originating request</h2><p>{specificationDescription(service.specification)}</p>
      <dl><dt>Service URL</dt><dd>{safeServiceUrl(service.serviceUrl) ? <a href={service.serviceUrl} target="_blank" rel="noopener noreferrer">{service.serviceUrl}</a> : service.serviceUrl}</dd><dt>Builder</dt><dd>{service.builder}</dd><dt>Evidence hash</dt><dd>{service.evidenceHash}</dd><dt>Demand ID</dt><dd>{service.demandId}</dd><dt>Chain</dt><dd>{CHAIN_ID}</dd><dt>Contract</dt><dd>{DEMAND_CONTRACT}</dd></dl>
    </article> : result.state === "ready" && result.services.length ? <ul className="services-grid">{result.services.map((item) => <li className="service-card" key={item.demandId}><article><h2>{item.capability}</h2><p>Fulfilled · Demand #{item.demandId}</p><h3>Originating request</h3><p>{specificationDescription(item.specification)}</p><p>Builder: {item.builder}</p><Link to={serviceHref(CHAIN_ID, DEMAND_CONTRACT!, BigInt(item.demandId))}>View Service</Link></article></li>)}</ul> : <p>No fulfilled services yet.</p>}
  </main></div>;
}
