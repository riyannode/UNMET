import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { docsFile, docsRoutes } from "../docs/layout.ts";
import { THEME_BOOTSTRAP } from "../theme-bootstrap.ts";
import { build, createServer, preview, type PreviewServer, type ViteDevServer } from "vite";

const frontendRoot = path.resolve(import.meta.dir, "..");
const configFile = path.join(frontendRoot, "vite.config.ts");
let server: ViteDevServer;
let production: PreviewServer;
let directory: string;
let devOrigin: string;
let previewOrigin: string;
const docsPaths = ["/docs", "/docs/", "/docs/index.html", "/docs?from=nav", "/docs/?from=nav"];

function origin(server: ViteDevServer | PreviewServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  // Assert the ownership boundary before starting listeners or doing a build.
  await access(path.join(frontendRoot, "docs/index.html"));
  directory = await mkdtemp(path.join(os.tmpdir(), "unmet-mpa-"));
  server = await createServer({ configFile, root: frontendRoot, logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: true } });
  await server.listen();
  devOrigin = origin(server);
  await build({ configFile, root: frontendRoot, logLevel: "silent", build: { outDir: directory, emptyOutDir: true } });
  production = await preview({ configFile, root: frontendRoot, logLevel: "silent", build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  previewOrigin = origin(production);
}, 60000);

afterAll(async () => {
  production?.httpServer.closeAllConnections();
  if (production) await new Promise<void>((resolve, reject) => production.httpServer.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
  server?.httpServer?.closeAllConnections();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Vite documentation MPA", () => {
  test("keeps the canonical docs root outside public", async () => {
    expect(await readFile(path.join(frontendRoot, "docs/index.html"), "utf8")).toContain('id="docs-navigation"');
    expect(await access(path.join(frontendRoot, "public/docs/index.html")).then(() => true, () => false)).toBe(false);
  });

  test("processes both HTML entries and shares the navigation bundle and stylesheet", async () => {
    const app = await readFile(path.join(directory, "index.html"), "utf8");
    const docs = await readFile(path.join(directory, "docs/index.html"), "utf8");
    const source = await readFile(path.join(frontendRoot, "docs/index.html"), "utf8");
    for (const html of [app, docs]) {
      expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/);
      expect(html).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/);
      expect(html.match(/<meta name="theme-color"/g)).toHaveLength(1);
      expect(html.indexOf('<meta name="theme-color"')).toBeLessThan(html.indexOf(`<script>${THEME_BOOTSTRAP}</script>`));
      expect(html).toContain(`<script>${THEME_BOOTSTRAP}</script>`);
      expect(html.indexOf(`<script>${THEME_BOOTSTRAP}</script>`)).toBeLessThan(html.indexOf('rel="stylesheet"'));
    }
    for (const route of docsRoutes) {
      const html = await readFile(path.join(directory, docsFile(route)), "utf8");
      expect(html.match(/<meta name="theme-color"/g)).toHaveLength(1);
      expect(html.indexOf('<meta name="theme-color"')).toBeLessThan(html.indexOf(`<script>${THEME_BOOTSTRAP}</script>`));
      expect(html).toContain(`<script>${THEME_BOOTSTRAP}</script>`);
      expect(html.indexOf(`<script>${THEME_BOOTSTRAP}</script>`)).toBeLessThan(html.indexOf('rel="stylesheet"'));
    }
    expect(docs).not.toBe(source);
    expect(docs).not.toContain('src="/docs/navigation.tsx"');
    const sharedAssets = [...docs.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).filter((asset) => app.includes(asset));
    expect(sharedAssets.some((asset) => asset.endsWith(".js"))).toBe(true);
    expect(sharedAssets.some((asset) => asset.endsWith(".css"))).toBe(true);
    for (const asset of sharedAssets) await access(path.join(directory, asset));
    const sharedCss = await Promise.all(sharedAssets.filter((asset) => asset.endsWith(".css")).map((asset) => readFile(path.join(directory, asset), "utf8")));
    expect(sharedCss.some((css) => css.includes("--unmet-theme-page"))).toBe(true);
  });

  test.each(docsPaths)("%s serves docs HTML through dev and built preview", async (route) => {
    for (const base of [devOrigin, previewOrigin]) {
      const response = await fetch(base + route, { headers: { Accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("Introduction · UNMET Docs");
      expect(html).toContain('id="docs-navigation"');
      expect(html.match(/id="docs-footer"/g)).toHaveLength(1);
      expect(html).toContain('<main id="docs-content" tabindex="-1"');
      expect(html).toContain('href="#docs-content"');
      expect(html).toContain('href="/docs/api/payments/"');
      expect(html).not.toContain('<div id="root"></div>');
      const head = await fetch(base + route, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
  });

  test("keeps app fallback and discovery bytes unchanged", async () => {
    for (const base of [devOrigin, previewOrigin]) {
      for (const route of ["/market", "/market/1", "/services", "/services/1952/0x1111111111111111111111111111111111111111/42", "/create-demand", "/analytics", "/docs-other"]) {
        const response = await fetch(base + route, { headers: { Accept: "text/html" } });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('<div id="root"></div>');
      }
      for (const resource of ["openapi.json", "api.md", "payment.md", "robots.txt", "sitemap.xml", ".well-known/api-catalog"]) {
        const response = await fetch(base + "/" + resource);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(await readFile(path.join(frontendRoot, "public", resource), "utf8"));
      }
    }
  });

  test("publishes exactly the approved routes with complete static navigation", async () => {
    const approved = ["/docs", "/docs/getting-started/", "/docs/getting-started/builders/", "/docs/getting-started/agents/",
      "/docs/demand-market/", "/docs/demand-market/proposals/", "/docs/demand-market/review/", "/docs/demand-market/refunds/",
      "/docs/api/", "/docs/api/intelligence/", "/docs/api/payments/", "/docs/api/errors/", "/docs/roadmap/"];
    expect(docsRoutes).toEqual(approved);
    const htmlPages = new Map(await Promise.all(approved.map(async (route) =>
      [route, await readFile(path.join(directory, docsFile(route)), "utf8")] as const)));
    for (const [route, html] of htmlPages) {
      expect(html.match(/id="docs-footer"/g)).toHaveLength(1);
      expect(html).toMatch(/<\/div>\s*<div id="docs-footer"><\/div>\s*<\/body>/);
      expect(html.match(/<h1>/g)?.length).toBe(1);
      expect(html).not.toMatch(/github\.com|AGENTS\.md|FUTURE_IMPLEMENTATION\.md|PAYMENT_RECOVERY\.md/);
      expect(html).not.toContain("<!--docs-");
      expect(html).not.toContain("docs-sidebar-label");
      expect(html).not.toContain(">Documents<");
      expect(html).toContain('aria-label="Browse documentation"');
      expect(html).toMatch(/<div class="docs-grid">\s*<div class="docs-toolbar">/);
      expect(html.match(/<details[ >]/g)?.length).toBe(5);
      expect(html.match(/<details open data-active-group/g)?.length).toBe(1);
      expect(html.match(/<details open/g)?.length).toBe(1);
      expect(html.match(/data-active-group/g)?.length).toBe(1);
      expect(html).toContain(`href="${route}" aria-current="page"`);
      expect(html).toContain('aria-label="On this page"');
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      const toc = html.match(/<aside class="docs-toc"[\s\S]*?<\/aside>/)?.[0] ?? "";
      const headings = [...html.matchAll(/<h[23] id="([^"]+)">/g)].map((match) => match[1]);
      expect([...toc.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])).toEqual(headings);
      for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
        const target = new URL(href!, "https://unmetxyz.my.id" + route);
        expect(target.hostname).toBe("unmetxyz.my.id");
        const page = htmlPages.get(target.pathname);
        if (target.hash) {
          expect(page).toBeDefined();
          expect(page).toContain(`id="${target.hash.slice(1)}"`);
        } else {
          expect(page !== undefined || ["/", "/market", "/services", "/create-demand", "/openapi.json", "/api.md", "/payment.md", "/.well-known/api-catalog"].includes(target.pathname)).toBe(true);
        }
      }
      const cssLinks = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)];
      expect(cssLinks.length).toBeGreaterThan(0);
      const css = (await Promise.all(cssLinks.map(([, href]) => readFile(path.join(directory, href!), "utf8")))).join("");
      expect(css).toContain(".docs-grid");
      expect(css).toContain("grid-template-columns");
      expect(css).toContain("--unmet-theme-page");
    }
    const sitemap = await readFile(path.join(directory, "sitemap.xml"), "utf8");
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]!).pathname);
    expect(new Set(locations)).toEqual(new Set(["/", ...approved]));
    expect(locations.length).toBe(approved.length + 1);
    expect(await readFile(path.join(directory, "payment.md"), "utf8")).not.toContain("github.com");
  });

  test.each(docsRoutes.filter((route) => route !== "/docs"))("%s supports direct URLs, aliases, query and HEAD", async (route) => {
    for (const base of [devOrigin, previewOrigin]) {
      for (const alias of [route, route.slice(0, -1), route + "index.html", route + "?from=sidebar"]) {
        const response = await fetch(base + alias, { headers: { Accept: "text/html" } });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        const html = await response.text();
        expect(html).toContain(`rel="canonical" href="https://unmetxyz.my.id${route}"`);
        expect(html).toContain('class="docs-article"');
        expect(html.match(/id="docs-footer"/g)).toHaveLength(1);
        expect(html).not.toContain('<div id="root"></div>');
        const head = await fetch(base + alias, { method: "HEAD" });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
      }
    }
  });

  test.each(["/docs/missing", "/docs/api/missing/", "/docs/sources/AGENTS.md", "/docs/missing.html"])("%s returns real 404 without the app fallback", async (route) => {
    for (const base of [devOrigin, previewOrigin]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(base + route, { method, headers: { Accept: "text/html" } });
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('<div id="root"></div>');
      }
    }
  });

  test("places article navigation arrows beside the title in the correct direction", async () => {
    for (const [index, route] of docsRoutes.entries()) {
      const html = await readFile(path.join(directory, docsFile(route)), "utf8");
      const navigation = html.match(/<nav class="docs-related"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
      const links = [...navigation.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)];
      expect(links.map(([, href]) => href)).toEqual([docsRoutes[index - 1], docsRoutes[index + 1]].filter(Boolean));
      for (const [, href, label] of links) {
        const previous = href === docsRoutes[index - 1];
        const text = label!.replace(/<[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
        expect(text).toMatch(previous ? /^Previous< .+/ : /^Next.+ >$/);
        expect(label).toContain(`<span aria-hidden="true">${previous ? "&lt;" : "&gt;"}</span>`);
      }
    }
  });

  test("publishes highlighted code examples with unchanged copyable text", async () => {
    const examples = [
      ["docs/api/index.html", "curl -sS \"https://unmetxyz.my.id/v1/demands\" \\\n  -H \"Accept: application/json\""],
      ["docs/api/errors/index.html", "{\n  \"error\": {\n    \"code\": \"INVALID_LIMIT\",\n    \"message\": \"limit must be between 1 and 50\"\n  }\n}"],
      ["docs/api/intelligence/index.html", "curl -i \"https://unmetxyz.my.id/v1/insights\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Accept: application/json\" \\\n  --data '{\"minBounty\":\"10.000000\",\"status\":\"open\",\"sort\":\"score\",\"limit\":10}'"]
    ];
    for (const [file, expected] of examples) {
      const html = await readFile(path.join(directory, file!), "utf8");
      expect(html).toContain('<figure class="docs-code-block">');
      expect(html).toContain('class="docs-code-copy"');
      expect(html).toContain('tabindex="0" aria-label=');
      const code = html.match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/)?.[1] ?? "";
      expect(code).toContain('class="docs-code-');
      const text = code.replace(/<[^>]+>/g, "").replaceAll("&quot;", '"').replaceAll("&#x27;", "'")
        .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
      expect(text).toBe(expected);
    }
  });

  test("keeps consumer API constraints and phase status visible", async () => {
    const api = await readFile(path.join(directory, "docs/api/intelligence/index.html"), "utf8");
    const schema = JSON.parse(await readFile(path.join(directory, "openapi.json"), "utf8"));
    for (const name of ["DemandsResponse", "InsightsResponse"]) {
      const response = schema.components.schemas[name];
      expect(response.required).toContain("escrowToken");
      expect(response.properties.escrowToken.$ref).toBe("#/components/schemas/EscrowToken");
    }
    expect(schema.components.schemas.EscrowToken.required).toEqual(["address", "symbol", "decimals"]);
    expect(schema.components.schemas.EscrowToken.properties.decimals).toMatchObject({ minimum: 0, maximum: 255 });
    const bountyPattern = new RegExp(schema.components.schemas.InsightsQuery.properties.minBounty.pattern);
    expect(bountyPattern.test("1.12345678")).toBe(true);
    expect(bountyPattern.test("1.")).toBe(false);
    for (const field of Object.keys(schema.components.schemas.InsightsQuery.properties)) expect(api).toContain(field);
    for (const sort of schema.components.schemas.InsightsQuery.properties.sort.enum) expect(api).toContain(sort);
    for (const value of ["32 KiB", "4,294,967,295", "1 to 50", "scoreBreakdown", "economicSignals", "reasoning"]) expect(api).toContain(value);
    const roadmap = await readFile(path.join(directory, "docs/roadmap/index.html"), "utf8");
    expect(schema.paths["/v1/demands/prepare"].post.operationId).toBe("prepareDemand");
    expect(schema.components.schemas.DemandsResponse.properties.demands.items.$ref).toBe("#/components/schemas/PublicDemand");
    expect(schema.paths["/v1/services"].get.responses["400"].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorResponse");
    const phase = (id: string) => roadmap.match(new RegExp('<h2 id="' + id + '">[\\s\\S]*?(?=<h2|</article>)'))?.[0] ?? "";
    for (const id of ["automatic-validation", "rfq", "service-registry", "service-discovery", "intelligence-expansion"]) {
      expect(phase(id)).toMatch(/IMPLEMENTED/);
      expect(phase(id)).not.toContain("PROPOSED — NOT IMPLEMENTED");
    }
    expect(phase("automatic-validation")).toMatch(/source\/integration/i);
    expect(phase("automatic-validation")).toContain("G0.6");
    expect(phase("intelligence-expansion")).toMatch(/reduced scope/i);
    expect(phase("intelligence-expansion")).toMatch(/unsupported/i);
    expect(phase("capability-resolver")).toContain("DEFERRED — DEMAND-DRIVEN");
    expect(phase("capability-resolver")).toContain("NOT IMPLEMENTED");
    const payments = await readFile(path.join(directory, "docs/api/payments/index.html"), "utf8");
    for (const value of ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE", "1952", "196", "L1 finality"]) expect(payments).toContain(value);
    expect(payments).toContain("x-payment-info");
    expect(payments).toContain('href="/openapi.json"');
    expect(schema.paths["/v1/insights"].post["x-payment-info"].price).toEqual({ mode: "fixed", currency: "USD", amount: "0.01" });
    const recovery = await readFile(path.join(directory, "docs/api/errors/index.html"), "utf8");
    expect(recovery).toContain("There is no public UNMET recovery endpoint");
    expect(recovery).toContain("Do not create a fresh authorization");
  });

  test("documents current preparation, guarded proposals and cached discovery", async () => {
    const article = (file: string) => readFile(path.join(directory, "docs", file, "index.html"), "utf8");
    const agents = await article("getting-started/agents");
    expect(agents).toContain("POST /v1/demands/prepare");
    expect(agents).toMatch(/unsigned/i);
    expect(agents).not.toContain("There is no current HTTP RFQ preparation endpoint");
    const builders = await article("getting-started/builders");
    expect(builders).not.toContain("does not currently provide a fulfilled-service registry");
    for (const html of [builders, await article("demand-market/proposals")]) {
      expect(html).toContain("PASS");
      expect(html).toMatch(/attestation/i);
      expect(html).not.toMatch(/validation[^<.]*is proposed/i);
    }
    const api = await article("api");
    expect(api).toContain("POST /v1/x402/validate");
    expect(api).toContain("PUT /v1/services/:chainId/:contract/:demandId/discovery");
    for (const filter of ["capability", "network", "asset", "maxPrice", "state"]) expect(api).toContain(`<code>${filter}</code>`);
    const discovery = api.match(/<h2 id="service-discovery">[\s\S]*?(?=<h2|<\/article>)/)?.[0] ?? "";
    for (const state of ["pending", "metadata_invalid", "compatible", "incompatible", "unavailable", "stale"]) expect(discovery).toMatch(new RegExp("\\b" + state + "\\b"));
    expect(api).toMatch(/activity.storage/i);
    const intelligence = await article("api/intelligence");
    for (const field of ["blockHash", "marketActivity", "usageEvidence"]) expect(intelligence).toContain(`<code>${field}</code>`);
    expect(intelligence).toMatch(/unsupported/i);
    expect(intelligence).toMatch(/finality/i);
  });

});
