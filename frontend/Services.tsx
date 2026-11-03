import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Box, Search, X } from "lucide-react";
import { Card } from "./components/ui/card.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./components/ui/input-group.tsx";
import { Button } from "./components/ui/button.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./components/ui/empty.tsx";
import { Separator } from "./components/ui/separator.tsx";
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
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
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
  const search = query.trim().toLowerCase();
  const filtered = result.state === "ready" ? result.services.filter((item) =>
    [item.capability, specificationDescription(item.specification), item.demandId].some((value) => value.toLowerCase().includes(search))) : [];
  return <div className="unmet-landing services-page"><UnmetNavigation /><main className="services-content">
    {detail ? <>
      <Link className="services-back" to={ROUTES.services.href}><ArrowLeft size={16} aria-hidden="true" /> Back to Services</Link>
      {(invalid || result.state !== "ready") && <h1>Service</h1>}
      {invalid ? <p role="alert">Invalid service route.</p> : result.state === "loading" ? <p role="status">Loading services…</p> : result.state === "error" ? <p role="alert">Services are unavailable. Please try again later.</p> : result.state === "notfound" ? <p>Service not found or demand is not fulfilled.</p> : service && <article className="service-detail">
        <p className="service-eyebrow">Fulfilled · Demand #{service.demandId}</p>
        <h1>{service.capability}</h1><p className="service-description">{specificationDescription(service.specification)}</p>
        <section><h2>Service</h2><Separator className="services-separator" /><dl>
          <dt>Service URL</dt><dd>{safeServiceUrl(service.serviceUrl) ? <a href={service.serviceUrl} target="_blank" rel="noopener noreferrer">{service.serviceUrl}</a> : service.serviceUrl}</dd>
          <dt>Builder</dt><dd>{service.builder}</dd>
        </dl></section>
        <section><h2>Provenance</h2><Separator className="services-separator" /><dl>
          <dt>Demand ID</dt><dd>{service.demandId}</dd><dt>Chain</dt><dd>{CHAIN_ID === 1952 ? "X Layer · 1952" : CHAIN_ID}</dd>
          <dt>AgentDemand contract</dt><dd>{DEMAND_CONTRACT}</dd><dt>Evidence hash</dt><dd>{service.evidenceHash}</dd>
        </dl></section>
      </article>}
    </> : <>
      <header className="services-header"><h1>Services</h1><p>Services created from fulfilled UNMET demands.</p></header>
      <label className="services-search-label" htmlFor="services-search">Search services</label>
      <InputGroup className="services-search"><InputGroupInput ref={searchInput} id="services-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by capability, request, or demand ID" /><InputGroupAddon><Search size={18} aria-hidden="true" /></InputGroupAddon>{query && <InputGroupAddon align="inline-end"><Button type="button" variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X size={16} /></Button></InputGroupAddon>}</InputGroup>
      <div className="services-layout">
        <aside className="services-rail" aria-label="Service categories"><span aria-current="page">All Services</span></aside>
        <div className="services-results">
          {result.state === "loading" ? <>
            <p className="services-sr-only" role="status">Loading services…</p>
            <div className="services-grid" aria-hidden="true">
              {[0, 1, 2].map((item) => <Card className="service-card service-skeleton" key={item}>
                <div className="service-card-header"><Skeleton className="service-skeleton-icon" /><Skeleton className="service-skeleton-title" /></div>
                <Skeleton className="service-skeleton-line" /><Skeleton className="service-skeleton-line short" />
                <Separator className="services-separator" /><Skeleton className="service-skeleton-meta" />
              </Card>)}
            </div>
          </> : result.state !== "ready" ? (
            <p className="services-error" role="alert">Services are unavailable. Please try again later.</p>
          ) : result.services.length === 0 ? (
            <Empty className="services-empty"><EmptyHeader><EmptyTitle>No fulfilled services yet.</EmptyTitle><EmptyDescription>Services will appear here when demands are fulfilled.</EmptyDescription></EmptyHeader></Empty>
          ) : filtered.length === 0 ? (
            <Empty className="services-empty"><EmptyHeader><EmptyTitle>No matching services.</EmptyTitle><EmptyDescription>Try another search or clear your query.</EmptyDescription></EmptyHeader></Empty>
          ) : (
            <ul className="services-grid">
              {filtered.map((item) => <li key={item.demandId}>
                <Link className="service-card-link" aria-labelledby={`service-title-${item.demandId}`} to={serviceHref(CHAIN_ID, DEMAND_CONTRACT!, BigInt(item.demandId))}>
                  <Card className="service-card"><article>
                    <div className="service-card-header"><Box className="service-glyph" size={20} aria-hidden="true" /><h2 id={`service-title-${item.demandId}`}>{item.capability}</h2></div>
                    <p className="service-card-description">{specificationDescription(item.specification)}</p>
                    <Separator className="services-separator" />
                    <div className="service-card-meta"><span>Demand #{item.demandId}</span><span>Fulfilled</span></div>
                  </article></Card>
                </Link>
              </li>)}
            </ul>
          )}
        </div>
      </div>
    </>}
  </main></div>;
}
