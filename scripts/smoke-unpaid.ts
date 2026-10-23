const base = new URL(process.env.BASE_URL || "http://localhost");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || base.protocol !== "http:") {
  throw new Error("Local HTTP targets only");
}
for (const path of ["/", "/docs", "/market", "/market/1", "/create-demand", "/analytics", "/unknown-ui"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) throw new Error("SPA_SMOKE_FAILED: " + path);
}
for (const path of ["/live", "/ready", "/health", "/v1/demands"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25_000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("json")) throw new Error("API_SMOKE_FAILED: " + path + " status=" + response.status);
}
const missing = await fetch(new URL("/v1/missing", base));
if (missing.status !== 404 || !missing.headers.get("content-type")?.includes("json")) throw new Error("API_404_FAILED");
const challenge = await fetch(new URL("/v1/opportunities", base), {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  signal: AbortSignal.timeout(20_000),
});
if (challenge.status !== 402 || !challenge.headers.has("payment-required")) throw new Error("X402_CHALLENGE_FAILED");
const required = JSON.parse(Buffer.from(challenge.headers.get("payment-required")!, "base64").toString("utf8"));
console.log(JSON.stringify({
  event: "smoke_passed", spaRoutes: 8, healthRoutes: 3, demands: 200, unknownApi: 404,
  unpaid: challenge.status, version: required.x402Version,
  accepts: required.accepts?.map((accept: { scheme: string; network: string; amount: string; asset: string }) =>
    ({ scheme: accept.scheme, network: accept.network, amount: accept.amount, asset: accept.asset })),
}));
export {};
