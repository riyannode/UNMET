import { loadRuntimeCredentials } from "./runtime-credentials.ts";

try {
  const clear = loadRuntimeCredentials();
  try {
    const { startServer } = await import("./server.ts");
    await startServer();
  } finally { clear(); }
} catch {
  console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", event: "startup_failed", code: "STARTUP_UNAVAILABLE" }));
  process.exitCode = 1;
}
export {};
