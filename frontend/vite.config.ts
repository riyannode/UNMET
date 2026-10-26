import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const rewriteDocumentPath: Connect.NextHandleFunction = (request, _response, next) => {
  const url = request.url ?? "";
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  if (pathname === "/docs" || pathname === "/docs/") {
    request.url = "/docs/index.html" + (queryIndex === -1 ? "" : url.slice(queryIndex));
  } else if (request.headers.accept?.includes("text/html")
    && /^\/(?:market(?:\/[^/]+)?|create-demand|analytics)\/?$/.test(pathname)) {
    // /analytics would otherwise resolve analytics.ts before Vite's SPA fallback.
    request.url = "/index.html" + (queryIndex === -1 ? "" : url.slice(queryIndex));
  }
  next();
};

const documentPathPlugin: Plugin = {
  name: "document-path",
  configureServer(server) {
    server.middlewares.use(rewriteDocumentPath);
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteDocumentPath);
  },
};

export default defineConfig({
  input: {
    main: fileURLToPath(new URL("./index.html", import.meta.url)),
    docs: fileURLToPath(new URL("./docs/index.html", import.meta.url)),
  },
  plugins: [documentPathPlugin, tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
});
