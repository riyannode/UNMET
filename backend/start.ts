try {
  const { startServer } = await import("./server.ts");
  await startServer();
} catch {
  console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", event: "startup_failed", code: "STARTUP_UNAVAILABLE" }));
  process.exitCode = 1;
}
export {};
