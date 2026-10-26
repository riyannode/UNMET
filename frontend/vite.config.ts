import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const rewriteDocsPath: Connect.NextHandleFunction = (request, _response, next) => {
  const url = request.url ?? "";
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  if (pathname === "/docs" || pathname === "/docs/") {
    request.url = "/docs/index.html" + (queryIndex === -1 ? "" : url.slice(queryIndex));
  }
  next();
};

const docsPathPlugin: Plugin = {
  name: "docs-path",
  configureServer(server) {
    server.middlewares.use(rewriteDocsPath);
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteDocsPath);
  },
};

export default defineConfig({
  plugins: [docsPathPlugin, tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
});
