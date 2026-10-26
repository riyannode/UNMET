import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";

const frontendRoot = path.resolve(import.meta.dir, "..");
const docsHtml = await readFile(path.join(frontendRoot, "public/docs/index.html"), "utf8");
let server: ViteDevServer;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    configFile: path.join(frontendRoot, "vite.config.ts"),
    root: frontendRoot,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not bind a TCP listener");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.httpServer?.closeAllConnections();
  await server?.close();
});

describe("public API documentation", () => {
  test.each(["/docs", "/docs/", "/docs/index.html", "/docs?from=nav", "/docs/?from=nav"]) (
    "%s serves the canonical static document",
    async (route) => {
      const response = await fetch(origin + route);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toBe(docsHtml);
      const head = await fetch(origin + route, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    },
  );

  test("unrelated paths keep their SPA fallback", async () => {
    const other = await fetch(origin + "/docs-other");
    expect(other.status).toBe(200);
    expect(await other.text()).toContain('<div id="root"></div>');

    const market = await fetch(origin + "/market");
    expect(market.status).toBe(200);
    expect(await market.text()).toContain('<div id="root"></div>');
  });

  test("all same-origin discovery links serve their public resources", async () => {
    const urls = [...docsHtml.matchAll(/href="([^"]+)"/g)]
      .map((match) => new URL(match[1], origin))
      .filter((url) => url.origin === origin);
    const publicResources = new Map<string, { mime?: string; validate: (body: string) => void }>([
      ["/openapi.json", { mime: "application/json", validate: (body) => expect(JSON.parse(body).openapi).toBe("3.1.0") }],
      ["/api.md", { mime: "text/markdown", validate: (body) => expect(body).toContain("# UNMET Demand API") }],
      ["/payment.md", { mime: "text/markdown", validate: (body) => expect(body).toContain("# UNMET API payment guide") }],
      ["/.well-known/api-catalog", { validate: (body) => expect(JSON.parse(body).linkset).toBeArray() }],
    ]);

    for (const path of publicResources.keys()) {
      expect(urls.some((url) => url.pathname === path)).toBe(true);
    }
    for (const url of urls) {
      const expected = url.pathname === "/" ? { mime: "text/html" } : publicResources.get(url.pathname);
      expect(expected).toBeDefined();
      if (!expected) throw new Error(`Unregistered same-origin docs link: ${url.pathname}`);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      if (expected.mime) expect(response.headers.get("content-type")).toContain(expected.mime);
      const body = await response.text();
      if ("validate" in expected) expected.validate(body);
    }
  });
});
