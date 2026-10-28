import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import { docsFile, docsLayoutPlugin, docsRoutes } from "./docs/layout.ts";
import { THEME_BOOTSTRAP } from "./theme-bootstrap.ts";

const rewriteDocumentPath = (development: boolean): Connect.NextHandleFunction => (request, response, next) => {
  const url = request.url ?? "";
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const docs = docsRoutes.find((route) => [route, route.replace(/\/$/, ""), "/" + docsFile(route),
    route === "/docs" ? "/docs/" : route].includes(pathname));
  if (docs) {
    request.url = "/" + docsFile(docs) + (queryIndex === -1 ? "" : url.slice(queryIndex));
  } else if (pathname.startsWith("/docs/") && !(development
    && ["/docs/navigation.tsx", "/docs/interactions.ts", "/docs/docs.css"].includes(pathname))) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(request.method === "HEAD" ? "" : "Documentation page not found");
    return;
  } else if (request.headers.accept?.includes("text/html")
    && /^\/(?:market(?:\/[^/]+)?|create-demand|analytics)\/?$/.test(pathname)) {
    // /analytics would otherwise resolve analytics.ts before Vite's SPA fallback.
    request.url = "/index.html" + (queryIndex === -1 ? "" : url.slice(queryIndex));
  }
  next();
};

const themeBootstrapPlugin: Plugin = {
  name: "theme-bootstrap",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replace(/<head([^>]*)>/, `<head$1><meta name="theme-color" content="#070b12"><script>${THEME_BOOTSTRAP}</script>`),
  },
};

const documentPathPlugin: Plugin = {
  name: "document-path",
  configureServer(server) {
    server.middlewares.use(rewriteDocumentPath(true));
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteDocumentPath(false));
  },
};

export default defineConfig({
  input: Object.fromEntries([
    ["main", fileURLToPath(new URL("./index.html", import.meta.url))],
    ...docsRoutes.map((route) => [route.slice(1).replaceAll("/", "-"), fileURLToPath(new URL("./" + docsFile(route), import.meta.url))]),
  ]),
  plugins: [documentPathPlugin, docsLayoutPlugin, themeBootstrapPlugin, tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
});
