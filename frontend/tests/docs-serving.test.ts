import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  test("has exactly one docs source outside public", async () => {
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
    }
    expect(docs).not.toBe(source);
    expect(docs).not.toContain('src="/docs/navigation.tsx"');
    const sharedAssets = [...docs.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).filter((asset) => app.includes(asset));
    expect(sharedAssets.some((asset) => asset.endsWith(".js"))).toBe(true);
    expect(sharedAssets.some((asset) => asset.endsWith(".css"))).toBe(true);
    for (const asset of sharedAssets) await access(path.join(directory, asset));
  });

  test.each(docsPaths)("%s serves docs HTML through dev and built preview", async (route) => {
    for (const base of [devOrigin, previewOrigin]) {
      const response = await fetch(base + route, { headers: { Accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("UNMET API documentation");
      expect(html).toContain('id="docs-navigation"');
      expect(html).toContain('<main id="docs-content" tabindex="-1"');
      expect(html).toContain('href="#docs-content"');
      expect(html).toContain("PAYMENT-SIGNATURE");
      expect(html).not.toContain('<div id="root"></div>');
      const head = await fetch(base + route, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
  });

  test("legacy Vercel docs routes target the same built entry", async () => {
    const config = JSON.parse(await readFile(path.join(frontendRoot, "vercel.json"), "utf8"));
    for (const route of ["/docs", "/docs/"]) {
      expect(config.rewrites.find((rule: { source: string }) => rule.source === route)?.destination).toBe("/docs/index.html");
    }
    await access(path.join(directory, "docs/index.html"));
  });

  test("keeps app fallback and discovery bytes unchanged", async () => {
    for (const base of [devOrigin, previewOrigin]) {
      for (const route of ["/market", "/market/1", "/create-demand", "/analytics", "/docs-other"]) {
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
});
