const base = new URL(process.env.BASE_URL || "http://localhost");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || base.protocol !== "http:") {
  throw new Error("Local HTTP targets only");
}
const requests = Number(process.env.REQUESTS || 60);
const concurrency = Number(process.env.CONCURRENCY || 4);
if (!Number.isInteger(requests) || requests < 1 || requests > 200 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("LOAD_BOUNDS");
const path = process.env.LOAD_PATH || "/v1/opportunities";
if (!["/v1/opportunities", "/v1/demands"].includes(path)) throw new Error("LOAD_PATH");
let cursor = 0;
const statuses: Record<number, number> = {};
const latencies: number[] = [];
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < requests) {
    cursor++;
    const start = performance.now();
    try {
      const response = await fetch(new URL(path, base), {
        method: path === "/v1/opportunities" ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: path === "/v1/opportunities" ? "{}" : undefined,
        signal: AbortSignal.timeout(25_000),
      });
      await response.arrayBuffer();
      statuses[response.status] = (statuses[response.status] || 0) + 1;
    } catch { statuses[0] = (statuses[0] || 0) + 1; }
    latencies.push(performance.now() - start);
  }
}));
latencies.sort((a, b) => a - b);
const percentile = (p: number) => Number(latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)].toFixed(2));
console.log(JSON.stringify({ requests, concurrency, path, statuses, rateLimited: statuses[429] || 0,
  overloaded: statuses[503] || 0, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }));
export {};
