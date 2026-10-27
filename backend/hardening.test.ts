import { expect, test } from "bun:test";
import { createApp } from "./server.ts";
import { PaymentError } from "./payment-error.ts";

test("invalid requests never enter payment verification", async () => {
  let paid = 0;
  const server = createApp({ middleware: (_req, res) => { paid++; res.status(402).end(); } }).listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  try {
    for (const [body, type, status] of [
      ['{"limit":51}', "application/json", 400],
      ['{"unknown":true}', "application/json", 400],
      ['{', "application/json", 400],
      ['{"minBounty":"' + "1".repeat(33_000) + '"}', "application/json", 413],
      ['{}', "text/plain", 415],
    ] as const) {
      const response = await fetch("http://127.0.0.1:" + address.port + "/v1/opportunities", {
        method: "POST", headers: { "content-type": type }, body,
      });
      expect(response.status).toBe(status);
      await response.text();
    }
    expect(paid).toBe(0);
    const valid = await fetch("http://127.0.0.1:" + address.port + "/v1/opportunities", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(valid.status).toBe(402);
    expect(paid).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { request } from "node:http";
import type { Express } from "express";
import { loadOperationalConfig } from "./config.ts";
import { createBoundedFetch, settleStatusErrorCode, withBoundedFetch, withBoundedFetchDeadline } from "./upstream.ts";
import { createDemandIndexState, refreshIndex } from "./server.ts";
import { type Address, type PublicClient } from "viem";
import { loadConfig } from "./contract.ts";

async function withServer(app: Express, task: (url: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  try { await task("http://127.0.0.1:" + address.port); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

test("per-route limits expire and forged forwarding headers cannot change an untrusted client", async () => {
  let paid = 0;
  let now = 1000;
  const app = createApp({ middleware: (_req, res) => { paid++; res.status(402).end(); } }, {
    client: { getBlock: async () => { throw new Error("offline fixture"); } } as unknown as PublicClient,
    config: loadOperationalConfig({ RATE_OPPORTUNITIES: "1", RATE_DEMANDS: "1" }), now: () => now,
  });
  await withServer(app, async (url) => {
    expect((await post(url, { "x-forwarded-for": "192.0.2.1" })).status).toBe(402);
    const limited = await post(url, { "x-forwarded-for": "192.0.2.2" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    const demands = await fetch(url + "/v1/demands");
    expect(demands.status).not.toBe(429);
    expect((await fetch(url + "/v1/demands")).status).toBe(429);
    expect((await fetch(url + "/live")).status).toBe(200);
    expect((await fetch(url + "/v1/unknown")).status).toBe(404);
    now += 60_001;
    expect((await post(url)).status).toBe(402);
    expect(paid).toBe(2);
  });
});

test("different socket clients have independent quotas and full limiter state fails closed", async () => {
  const app = createApp({ middleware: (_req, res) => { res.status(402).end(); } }, {
    config: loadOperationalConfig({ RATE_OPPORTUNITIES: "1", RATE_MAX_KEYS: "2" }),
  });
  const send = (url: string, localAddress: string) => new Promise<number>((resolve, reject) => {
    const req = request(url + "/v1/opportunities", { method: "POST", localAddress, headers: { "content-type": "application/json" } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("error", reject); req.end("{}");
  });
  await withServer(app, async (url) => {
    expect(await send(url, "127.0.0.2")).toBe(402);
    expect(await send(url, "127.0.0.3")).toBe(402);
    expect(await send(url, "127.0.0.2")).toBe(429);
    expect(await send(url, "127.0.0.4")).toBe(503);
  });
});

test("overload precedes payment and finish, errors, and aborts release admission exactly once", async () => {
  let calls = 0;
  let finish: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let closed: (() => void) | undefined;
  const app = createApp({ middleware: (req, res, next) => {
    calls++;
    if (req.get("test-error")) return next(new Error("private-provider-secret"));
    if (req.get("test-hold")) {
      finish = () => res.status(402).end();
      res.once("close", () => closed?.());
      entered?.();
    } else res.status(402).end();
  } }, { config: loadOperationalConfig({ MAX_IN_FLIGHT: "1", RATE_OPPORTUNITIES: "100" }) });
  await withServer(app, async (url) => {
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = post(url, { "test-hold": "1" });
    await started;
    const rejected = await post(url);
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("retry-after")).toBe("1");
    expect(calls).toBe(1);
    finish?.();
    expect((await first).status).toBe(402);
    expect((await post(url)).status).toBe(402);
    const failed = await post(url, { "test-error": "1" });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private-provider-secret");
    expect((await post(url)).status).toBe(402);
    const abort = new AbortController();
    const holding = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { closed = resolve; });
    const pending = fetch(url + "/v1/opportunities", {
      method: "POST", headers: { "content-type": "application/json", "test-hold": "1" }, body: "{}", signal: abort.signal,
    }).catch(() => undefined);
    await holding;
    abort.abort();
    await pending;
    await released;
    expect((await post(url)).status).toBe(402);
  });
});

test("RPC transport rejects overload, aborts timeouts, caps response bytes, then recovers", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (new URL(req.url).pathname === "/slow") await Bun.sleep(200);
    return new Response(new URL(req.url).pathname === "/large" ? "x".repeat(2048) : "ok");
  } });
  try {
    const bounded = createBoundedFetch({ maxInFlight: 1, timeoutMs: 50, maxBytes: 1024 });
    const pending = bounded(server.url + "slow");
    await expect(bounded(server.url)).rejects.toThrow("UPSTREAM_CAPACITY");
    await expect(pending).rejects.toThrow("UPSTREAM_TIMEOUT_OR_SIZE");
    expect(await (await bounded(server.url)).text()).toBe("ok");
    await expect(bounded(server.url + "large")).rejects.toThrow("UPSTREAM_RESPONSE_TOO_LARGE");
    expect((await bounded(server.url)).status).toBe(200);
    const statusTransport = createBoundedFetch({ maxInFlight: 1, timeoutMs: 1000, maxBytes: 1024 });
    const deadlineRead = withBoundedFetch(statusTransport, () => withBoundedFetchDeadline(Date.now() + 25,
      () => withBoundedFetch(statusTransport, () => fetch(server.url + "slow"))));
    await expect(deadlineRead).rejects.toThrow("UPSTREAM_TIMEOUT_OR_SIZE");
  } finally { await server.stop(true); }
});

test("settle status errors expose only safe transient or deterministic categories", () => {
  for (const message of ["UPSTREAM_TIMEOUT_OR_SIZE", "UPSTREAM_UNAVAILABLE", "UPSTREAM_CAPACITY",
    "Facilitator getSettleStatus failed (408): detail", "Facilitator getSettleStatus failed (429): detail",
    "Facilitator getSettleStatus failed (503): detail"]) {
    expect(settleStatusErrorCode(new Error(message))).toBe("PAYMENT_STATUS_TEMPORARY");
  }
  for (const message of ["Facilitator getSettleStatus failed (400): private detail", "UPSTREAM_RESPONSE_TOO_LARGE",
    "malformed response private marker"]) {
    expect(settleStatusErrorCode(new Error(message))).toBe("PAYMENT_STATUS_UNAVAILABLE");
    expect(settleStatusErrorCode(new Error(message))).not.toContain("private");
  }
});

test("unsafe configuration is rejected without echoing supplied values", () => {
  for (const env of [
    { MAX_IN_FLIGHT: "0" }, { RATE_MAX_KEYS: "Infinity" }, { TRUSTED_PROXIES: "true" },
    { TRUSTED_PROXIES: "0.0.0.0/33" }, { XLAYER_RPC_URL: "unused", FRONTEND_ORIGIN: "https://host/path" },
  ]) expect(() => loadOperationalConfig(env)).toThrow("CONFIG_INVALID");
});

test("Mainnet payment confirmation RPC is validated independently of the market RPC", () => {
  expect(loadOperationalConfig({ XLAYER_RPC_URL: "https://testnet.example", X402_RPC_URL: "https://mainnet.example" }).x402RpcUrl)
    .toBe("https://mainnet.example");
  expect(loadOperationalConfig({ XLAYER_RPC_URL: "https://testnet.example" }).x402RpcUrl).toBe("https://rpc.xlayer.tech");
  expect(() => loadOperationalConfig({ X402_RPC_URL: "file:///tmp/rpc" })).toThrow("CONFIG_INVALID: X402_RPC_URL");
});

test("index capacity failure leaves the previous complete checkpoint intact", async () => {
  const state = createDemandIndexState();
  state.ready = true;
  state.lastIndexedBlock = 1n;
  const hash = "0x" + "a".repeat(64) as `0x${string}`;
  state.lastIndexedBlockHash = hash;
  const client = {
    getBlock: async (args?: { blockNumber: bigint }) => ({ number: args?.blockNumber ?? 2n, hash }),
    getLogs: async () => [],
    readContract: async () => 100n,
  } as unknown as PublicClient;
  await expect(refreshIndex(client, "0x0000000000000000000000000000000000000001" as Address, state,
    loadOperationalConfig({ INDEX_MAX_DEMANDS: "2" }))).rejects.toThrow("INDEX_CAPACITY");
  expect(state.lastIndexedBlock).toBe(1n);
  expect(state.entries.size).toBe(0);
});

test("readiness is dependency-aware and coalesces repeated checks while liveness does no RPC", async () => {
  let calls = 0;
  const client = {
    getBlockNumber: async () => { calls++; return 123n; },
    getBytecode: async () => { calls++; return "0x1234"; },
    getChainId: async () => { calls++; return 1; },
  } as unknown as PublicClient;
  await withServer(createApp({ middleware: (_req, res) => { res.status(402).end(); } }, { client, market: { ...loadConfig(), contract: "0x0000000000000000000000000000000000000001" } }), async (url) => {
    expect((await fetch(url + "/live")).status).toBe(200);
    expect(calls).toBe(0);
    const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(url + "/ready")));
    expect(responses.every((r) => r.status === 503)).toBe(true);
    expect(calls).toBe(3);
    expect((await fetch(url + "/health")).status).toBe(503);
    expect(calls).toBeLessThanOrEqual(3);
  });
});

test("request IDs are server-owned and public errors omit internal text and stack", async () => {
  await withServer(createApp({ middleware: (_req, _res, next) => next(new Error("credential-marker")) }), async (url) => {
    const response = await post(url, { "x-request-id": "attacker-secret-marker" });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const text = await response.text();
    expect(text).not.toContain("credential-marker");
    expect(text).not.toContain("stack");
  });
});

test("payment errors retain their public status, code, and safe message through the HTTP handler", async () => {
  const identityError = new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  identityError.stack = "payment-stack-marker";
  const reconciliationError = new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409);
  reconciliationError.stack = "reconciliation-stack-marker";
  for (const [error, status, message] of [
    [identityError, 400, "Payment authorization is invalid or unsupported"],
    [reconciliationError, 409, "Payment operation unavailable; do not submit a new payment"],
    [new PaymentError("PAYMENT_STORAGE_UNAVAILABLE"), 503, "Service temporarily unavailable"],
    [Object.assign(new Error("ordinary-private-marker"), { cause: new Error("ordinary-cause-marker") }), 503, "Service temporarily unavailable"],
  ] as const) {
    await withServer(createApp({ middleware: (_req, _res, next) => next(error) }), async (url) => {
      const response = await post(url);
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).not.toContain("payment-stack-marker");
      expect(text).not.toContain("reconciliation-stack-marker");
      expect(text).not.toContain("ordinary-private-marker");
      expect(text).not.toContain("ordinary-cause-marker");
      expect(text).not.toContain("stack");
      expect(JSON.parse(text)).toEqual({ error: { code: error instanceof PaymentError ? error.code : "CHAIN_RPC_UNAVAILABLE", message } });
    });
  }
});

test("minimum RPC capacity still completes a rebuild when a larger demand batch was requested", async () => {
  const state = createDemandIndexState();
  const hash = "0x" + "b".repeat(64) as `0x${string}`;
  let active = 0;
  let peak = 0;
  const client = {
    getBlock: async () => ({ number: 7n, hash }),
    readContract: async ({ functionName }: { functionName: string }) => {
      active++;
      peak = Math.max(peak, active);
      try {
        if (active > 4) throw new Error("UPSTREAM_CAPACITY");
        await Bun.sleep(1);
        if (functionName === "nextDemandId") return 7n;
        if (functionName !== "getDemand") return [0n, 0n, false];
        return {
          creator: "0x0000000000000000000000000000000000000001", builder: "0x0000000000000000000000000000000000000000",
          maxUnitPrice: 1n, committed: 1n, reviewCommitted: 0n, approvalRequired: 0n, expectedCalls: 1n,
          deadline: 2n, reviewEndsAt: 0n, supporterCount: 1, status: 0, capability: "test",
          specification: "test", serviceUrl: "", evidenceHash: hash,
        };
      } finally { active--; }
    },
  } as unknown as PublicClient;
  await refreshIndex(client, "0x0000000000000000000000000000000000000001" as Address, state,
    loadOperationalConfig({ RPC_MAX_IN_FLIGHT: "4", INDEX_BATCH_SIZE: "32" }));
  expect(state.ready).toBe(true);
  expect(state.entries.size).toBe(6);
  expect(peak).toBeLessThanOrEqual(4);
  expect(active).toBe(0);
});

test("an exhausted rebuild budget starts no additional RPC operation", async () => {
  let reads = 0;
  const client = {
    getBlock: async () => { await Bun.sleep(120); return { number: 1n, hash: "0x" + "a".repeat(64) }; },
    readContract: async () => { reads++; return 1n; },
  } as unknown as PublicClient;
  await expect(refreshIndex(client, "0x0000000000000000000000000000000000000001" as Address,
    createDemandIndexState(), loadOperationalConfig({ INDEX_BUDGET_MS: "100" }))).rejects.toThrow("INDEX_BUDGET_EXCEEDED");
  expect(reads).toBe(0);
});

test("official SDK diagnostic scope never prints raw payment/provider data", async () => {
  const child = Bun.spawn(["bun", "-e", [
    'const {createBoundedFetch,withBoundedFetch}=await import("./backend/upstream.ts");',
    'const transport=createBoundedFetch({maxInFlight:1,timeoutMs:100,maxBytes:1024});',
    'withBoundedFetch(transport,()=>{console.warn("payment-private-marker"); console.error(new Error("provider-private-marker"));});',
    'console.warn("outside-scope-marker");',
  ].join("")], { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(output).not.toContain("payment-private-marker");
  expect(output).not.toContain("provider-private-marker");
  expect(output).toContain("PAYMENT_SDK_DIAGNOSTIC");
  expect(output).toContain("outside-scope-marker");
});

test("trusted proxy IPs receive distinct IPv4 and IPv6 quotas", async () => {
  let calls = 0;
  await withServer(createApp({ middleware: (_req, res) => { calls++; res.status(402).end(); } }, {
    config: loadOperationalConfig({ TRUSTED_PROXIES: "127.0.0.1/32", RATE_OPPORTUNITIES: "1", RATE_DEMANDS: "1" }),
    client: { getBlock: async () => { throw new Error("offline fixture"); } } as unknown as PublicClient,
  }), async (url) => {
    const request = (ip: string) => post(url, { "x-forwarded-for": ip });
    expect((await request("192.0.2.1")).status).toBe(402);
    expect((await request("192.0.2.2")).status).toBe(402);
    expect((await request("192.0.2.1")).status).toBe(429);
    expect((await request("2001:db8::1")).status).toBe(402);
    expect((await request("2001:db8::1")).status).toBe(429);

    const demands = (ip: string) => fetch(url + "/v1/demands", { headers: { "x-forwarded-for": ip } });
    expect((await demands("192.0.2.1")).status).toBe(503);
    expect((await demands("192.0.2.2")).status).toBe(503);
    expect((await demands("192.0.2.1")).status).toBe(429);
    expect(calls).toBe(3);
  });
});

test("malformed trusted-proxy identity fails closed", async () => {
  let calls = 0;
  await withServer(createApp({ middleware: (_req, res) => { calls++; res.status(402).end(); } }, {
    config: loadOperationalConfig({ TRUSTED_PROXIES: "127.0.0.1/32", RATE_OPPORTUNITIES: "1" }),
  }), async (url) => {
    const response = await post(url, { "x-forwarded-for": "invalid" });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CLIENT_IP_UNAVAILABLE");
    expect(calls).toBe(0);
  });
});

test("untrusted forwarded headers cannot change client quota identity", async () => {
  await withServer(createApp({ middleware: (_req, res) => { res.status(402).end(); } }, {
    config: loadOperationalConfig({ RATE_OPPORTUNITIES: "1" }),
  }), async (url) => {
    expect((await post(url, { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "198.51.100.1" })).status).toBe(402);
    expect((await post(url, { "x-vercel-forwarded-for": "192.0.2.2", "x-forwarded-for": "198.51.100.2" })).status).toBe(429);
  });
});

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, resolve: () => release() };
}

for (const outcome of ["resolve", "reject"] as const) {
  test("disconnect during asynchronous verification holds admission until work " + outcome + "s", async () => {
    const started = deferred();
    const disconnected = deferred();
    const unblock = deferred();
    const done = deferred();
    let active = 0;
    let peak = 0;
    let calls = 0;
    const app = createApp({ middleware: async (req, res, next) => {
      calls++;
      if (!req.get("test-hold")) { res.status(402).end(); return; }
      active++;
      peak = Math.max(peak, active);
      res.once("close", disconnected.resolve);
      started.resolve();
      try {
        await unblock.promise;
        if (outcome === "reject") throw new Error("verification-fixture-failed");
        res.status(402).end();
      } catch (error) { next(error); }
      finally { active--; done.resolve(); }
    } }, { config: loadOperationalConfig({ MAX_IN_FLIGHT: "1", RATE_OPPORTUNITIES: "100" }) });
    await withServer(app, async (url) => {
      const controller = new AbortController();
      const pending = fetch(url + "/v1/opportunities", {
        method: "POST", headers: { "content-type": "application/json", "test-hold": "1" }, body: "{}", signal: controller.signal,
      }).catch(() => undefined);
      try {
        await started.promise;
        controller.abort();
        await pending;
        await disconnected.promise;
        expect((await post(url)).status).toBe(503);
        expect(calls).toBe(1);
        expect(active).toBe(1);
      } finally { unblock.resolve(); await done.promise; }
      expect((await post(url)).status).toBe(402);
      expect(active).toBe(0);
      expect(peak).toBe(1);
    });
  });
}

test("response completion cannot release a slot while asynchronous settlement is pending", async () => {
  const unblock = deferred();
  const done = deferred();
  await withServer(createApp({ middleware: async (req, res) => {
    res.status(402).end();
    if (req.get("test-hold")) {
      await unblock.promise;
      done.resolve();
    }
  } }, { config: loadOperationalConfig({ MAX_IN_FLIGHT: "1", RATE_OPPORTUNITIES: "100" }) }), async (url) => {
    try {
      expect((await post(url, { "test-hold": "1" })).status).toBe(402);
      expect((await post(url)).status).toBe(503);
    } finally { unblock.resolve(); await done.promise; }
    expect((await post(url)).status).toBe(402);
  });
});

import { paymentMiddlewareFromHTTPServer } from "@okxweb3/x402-express";

for (const phase of ["execution failure", "verification", "settlement"] as const) {
  test("official x402 middleware remains admitted after disconnect during " + phase, async () => {
    const started = deferred();
    const disconnected = deferred();
    const unblock = deferred();
    const done = deferred();
    let settlements = 0;
    // Test-only HTTP adapter seam: the real SDK still buffers/flushes the response.
    // No signed payload, network verification or settlement is submitted.
    const httpServer = {
      requiresPayment: () => true,
      processHTTPRequest: async () => {
        if (phase === "verification") { started.resolve(); await unblock.promise; }
        return { type: "payment-verified", paymentPayload: {}, paymentRequirements: {} };
      },
      processSettlement: async () => {
        settlements++;
        if (phase === "settlement") { started.resolve(); await unblock.promise; }
        return { success: true, headers: {} };
      },
    } as unknown as Parameters<typeof paymentMiddlewareFromHTTPServer>[0];
    const middleware = paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false);
    const hash = "0x" + "d".repeat(64) as `0x${string}`;
    let failIndex = phase === "execution failure";
    const client = {
      getBlock: async () => {
        if (failIndex) {
          failIndex = false;
          started.resolve();
          await unblock.promise;
          throw new Error("index-fixture-failed");
        }
        return { number: 1n, hash };
      },
      readContract: async () => 1n,
    } as unknown as PublicClient;
    await withServer(createApp({ middleware: (req, res, next) => {
      res.once("close", disconnected.resolve);
      return Promise.resolve(middleware(req, res, next)).finally(done.resolve);
    } }, {
      config: loadOperationalConfig({ MAX_IN_FLIGHT: "1", RATE_OPPORTUNITIES: "100" }),
      market: { ...loadConfig(), contract: "0x0000000000000000000000000000000000000001" }, client,
    }), async (url) => {
      const controller = new AbortController();
      const pending = fetch(url + "/v1/opportunities", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal,
      }).catch(() => undefined);
      try {
        await started.promise;
        controller.abort();
        await pending;
        await disconnected.promise;
        expect((await post(url)).status).toBe(503);
      } finally { unblock.resolve(); await done.promise; }
      expect(settlements).toBe(phase === "settlement" ? 1 : 0);
      expect((await fetch(url + "/live")).status).toBe(200);
      // Another request must reach the SDK rather than a permanently leaked slot.
      const recovered = await post(url);
      expect(recovered.status).toBe(200);
    });
  });
}
