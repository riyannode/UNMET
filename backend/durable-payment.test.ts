import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SettleStatusResponse } from "@okxweb3/x402-core/types";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { PaymentStore } from "./payment-store.ts";
import { durablePayment, reconcilePayments } from "./durable-payment.ts";
import { PaymentConfirmationUnavailable } from "./payment-confirmation.ts";
import { paymentIdentity } from "./payment-identity.ts";
import { createApp } from "./server.ts";
import { loadOperationalConfig } from "./config.ts";
import { loadConfig } from "./contract.ts";
import { withBoundedFetch } from "./upstream.ts";
import { MAINNET_ASSETS } from "./payment-identity.ts";
import express from "express";
import type { PublicClient } from "viem";
import type { PaymentRecord } from "./payment-store.ts";

const payer = "0x" + "2".repeat(40), recipient = "0x" + "1".repeat(40), asset = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const hash = "0x" + "a".repeat(64);
const requirements: PaymentRequirements = {
  scheme: "exact", network: "eip155:196", asset, amount: "10000", payTo: recipient,
  maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" },
};
const paymentOptions = MAINNET_ASSETS.map(({ asset, name, version }) => ({ ...requirements, asset,
  extra: { name, version } }));
function payload(nonce = "a", accepted: PaymentRequirements = requirements): PaymentPayload {
  return {
    x402Version: 2, accepted,
    payload: { signature: "0xfixture", authorization: { from: payer, to: accepted.payTo, value: accepted.amount,
      validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: "0x" + nonce.repeat(64) } },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

type Official = Pick<OKXFacilitatorClient, "getSupported" | "verify" | "settle" | "getSettleStatus">;
async function fixture(run: (ctx: {
  store: PaymentStore; path: string; post: (p?: PaymentPayload, body?: string, key?: string, signal?: AbortSignal) => Promise<Response>;
  calls: { verify: number; settle: number }; official: Official; url: string;
}) => Promise<void>, options: {
  failExecution?: () => boolean;
  settle?: () => Promise<SettleResponse>; verify?: () => Promise<{ isValid: boolean; payer: string }>;
  confirm?: (record: PaymentRecord) => Promise<boolean>;
  confirmationBudgetMs?: number; onDiagnostic?: (event: Record<string, unknown>) => void;
} = {}) {
  const dir = mkdtempSync(tmpdir() + "/unmet-durable-");
  const path = dir + "/payments.sqlite", store = new PaymentStore(path);
  const calls = { verify: 0, settle: 0 };
  const official: Official = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} }),
    verify: async () => { calls.verify++; return options.verify ? options.verify() : { isValid: true, payer }; },
    settle: async () => { calls.settle++; return options.settle ? options.settle() :
      { success: true, status: "success", transaction: hash, network: "eip155:196", payer }; },
    getSettleStatus: async () => ({ success: true, status: "success", transaction: hash, network: "eip155:196", payer }),
  };
  const durable = durablePayment(store, official, options.confirm || (async () => true), {
    confirmationBudgetMs: options.confirmationBudgetMs, onDiagnostic: options.onDiagnostic,
  });
  const resource = new x402ResourceServer(durable.client).register("eip155:196", new ExactEvmScheme());
  await resource.initialize();
  const paid = paymentMiddleware({
    "POST /v1/opportunities": { accepts: paymentOptions.map(({ scheme, network, payTo, asset, amount, extra }) => ({
      scheme, network, payTo, price: { asset, amount, extra },
    })) },
  }, resource, undefined, undefined, false);
  const middleware = durable.wrap((req, res, next) => paid(req, res, (error) => {
    if (!error && options.failExecution?.()) {
      res.status(503).json({ error: { code: "EXECUTION_FIXTURE_FAILED" } });
      return;
    }
    next(error);
  }));
  const client = { getBlock: async () => ({ number: 1n, hash }),
    readContract: async () => 1n } as unknown as PublicClient;
  const app = createApp({ middleware }, {
    config: loadOperationalConfig({ RATE_OPPORTUNITIES: "1000" }), client,
    market: { ...loadConfig(), contract: "0x0000000000000000000000000000000000000001" },
  });
  const server = app.listen(0, "127.0.0.1"), address = server.address();
  if (!address || typeof address === "string") throw new Error();
  const url = "http://127.0.0.1:" + address.port;
  const post = (p?: PaymentPayload, body = "{}", key?: string, signal?: AbortSignal) => fetch(url + "/v1/opportunities", {
    method: "POST", body, signal, headers: { "content-type": "application/json",
      ...(p ? { "payment-signature": Buffer.from(JSON.stringify(p)).toString("base64") } : {}),
      ...(key ? { "idempotency-key": key } : {}) },
  });
  try { await run({ store, path, post, calls, official, url }); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); rmSync(dir, { recursive: true });
  }
}

test("semantic nonce identity ignores serialization/signature variants but binds request", () => {
  const original = payload();
  (original.payload.authorization as Record<string, unknown>).validBefore = "4102444800";
  const first = paymentIdentity(original, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 10 } });
  expect(first.payment).toBe("e07195d9540db6b08ac46df215bc97959b6c00f27875f16317209c91b2941707");
  expect(first.binding).toBe("a54595158e63c3b07cf7c7dacb105544fae9473c49c026af4eb85d4ea87a0388");
  expect(first.validBefore).toBe(4_102_444_800_000);
  const auth = original.payload.authorization as Record<string, unknown>;
  const variant = { ...original, payload: { signature: "different", authorization: { ...auth, from: payer.toUpperCase().replace("0X", "0x"), value: "010000" } } };
  expect(paymentIdentity(variant, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 10 } }).payment).toBe(first.payment);
  const changed = paymentIdentity(original, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 20 } });
  expect(changed.payment).toBe(first.payment);
  expect(changed.binding).not.toBe(first.binding);
  expect(() => paymentIdentity(original, requirements, recipient, { method: "POST", route: "/", input: {} })).toThrow();
});

test("nonce identity is token-scoped while logical request keys remain payer/network-scoped", () => {
  const usdc: PaymentRequirements = { ...requirements, asset: "0xb6ceceab302e2e4948951ee7843fc24e92933061",
    extra: { name: "USDC", version: "2" } };
  const first = paymentIdentity(payload("d"), requirements, payer, { method: "POST", route: "/v1/opportunities", input: {}, key: "same" });
  const secondPayload = { ...payload("d"), accepted: usdc };
  const second = paymentIdentity(secondPayload, usdc, payer, { method: "POST", route: "/v1/opportunities", input: {}, key: "same" });
  expect(second.payment).not.toBe(first.payment);
  expect(second.logicalKey).toBe(first.logicalKey);
});

test("official unpaid challenge remains; arbitrary keys never reveal paid response", async () => {
  await fixture(async ({ post, calls }) => {
    const response = await post(undefined, "{}", "arbitrary");
    expect(response.status).toBe(402);
    expect(response.headers.has("payment-required")).toBe(true);
    expect(calls.settle).toBe(0);
    expect((await response.text()).includes("opportunities")).toBe(false);
  });
});

test("installed official facilitator settle makes one HTTP attempt on success, HTTP error and transport loss", async () => {
  for (const mode of ["success", "http-error", "transport-error"] as const) {
    let calls = 0;
    const fakeFetch = Object.assign(async () => {
      calls++;
      if (mode === "transport-error") throw new Error("fixture transport loss");
      return new Response(JSON.stringify({ success: true, status: "success", transaction: hash, network: requirements.network, payer }),
        { status: mode === "http-error" ? 503 : 200, headers: { "content-type": "application/json" } });
    }, fetch);
    const sdk = new (await import("@okxweb3/x402-core")).OKXFacilitatorClient({ apiKey: "fixture", secretKey: "fixture", passphrase: "fixture", baseUrl: "https://facilitator.invalid" });
    const task = withBoundedFetch(fakeFetch, () => sdk.settle(payload(), requirements));
    if (mode === "success") await task;
    else await expect(task).rejects.toThrow();
    expect(calls).toBe(1);
  }
});

test("durable Express adapter blocks SDK pending/timeout/transport outcomes without status polling or resettle", async () => {
  for (const mode of ["pending", "timeout", "http-error", "transport-error"] as const) {
    const dir = mkdtempSync(tmpdir() + "/unmet-sdk-durable-");
    const store = new PaymentStore(dir + "/payments.sqlite");
    const calls = { verify: 0, settle: 0, status: 0 };
    const fakeFetch = Object.assign(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/supported")) return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} });
      if (path.endsWith("/verify")) { calls.verify++; return Response.json({ isValid: true, payer }); }
      if (path.endsWith("/settle/status")) { calls.status++; return Response.json({ success: true, status: "success", transaction: hash, network: "eip155:196", payer }); }
      if (path.endsWith("/settle")) {
        calls.settle++;
        if (mode === "transport-error") throw new Error("fixture transport lost");
        if (mode === "http-error") return new Response("{}", { status: 503 });
        return Response.json({ success: true, status: mode, transaction: hash, network: "eip155:196", payer });
      }
      throw new Error("unexpected fixture URL");
    }, fetch);
    const sdk = new OKXFacilitatorClient({ apiKey: "fixture", secretKey: "fixture", passphrase: "fixture", baseUrl: "https://fixture.invalid", syncSettle: true });
    try {
      const durable = durablePayment(store, sdk);
      const resource = new x402ResourceServer(durable.client).register("eip155:196", new ExactEvmScheme());
      await withBoundedFetch(fakeFetch, () => resource.initialize());
      const paid = paymentMiddleware({ "POST /v1/opportunities": { accepts: [{ scheme: "exact", network: "eip155:196", payTo: recipient,
        price: { asset, amount: "10000", extra: { name: "USD₮0", version: "1" } } }] } }, resource, undefined, undefined, false);
      const app = express();
      app.use(express.json());
      const protectedRoute = durable.wrap(paid);
      app.post("/v1/opportunities", (req, res, next) => {
        res.locals.opportunityInput = {};
        return withBoundedFetch(fakeFetch, () => protectedRoute(req, res, (error) => {
          if (error) next(error);
          else res.json({ opportunities: ["fixture"] });
        }));
      });
      const server = app.listen(0, "127.0.0.1"), address = server.address();
      if (!address || typeof address === "string") throw new Error("test listener unavailable");
      const post = () => fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, { method: "POST",
        headers: { "content-type": "application/json", "payment-signature": Buffer.from(JSON.stringify(payload())).toString("base64") }, body: "{}" });
      try {
        const first = await post();
        expect(first.status).toBe(409);
        expect((await first.json()).error.code).toBe("PAYMENT_RECONCILIATION_REQUIRED");
        const replay = await post();
        expect(replay.status).toBe(409);
        expect(calls.settle).toBe(1);
        expect(calls.status).toBe(0);
        expect(calls.verify).toBe(2);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  }
});

test("concurrent identical requests cause exactly one fixture settlement and no duplicate content", async () => {
  const entered = deferred(), unblock = deferred();
  await fixture(async ({ post, calls, store }) => {
    const p = payload();
    const first = post(p, "{}", "same");
    await entered.promise;
    const duplicate = await post(p, "{}", "same");
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("PAYMENT_ALREADY_RESERVED");
    expect(calls.settle).toBe(1);
    unblock.resolve();
    expect((await first).status).toBe(200);
    expect((await post(p, "{}", "same")).status).toBe(409);
    store.integrity();
  }, { settle: async () => { entered.resolve(); await unblock.promise; return {
    success: true, status: "success", transaction: hash, network: "eip155:196", payer,
  }; } });
});

test("same key conflicts with changed payload or fresh authorization; independent payments work", async () => {
  await fixture(async ({ post, calls }) => {
    const p = payload();
    const initial = await post(p, "{}", "logical");
    expect(initial.status).toBe(200);
    expect((await post(p, '{"limit":1}', "logical")).status).toBe(409);
    expect((await post(payload("b"), "{}", "logical")).status).toBe(409);
    expect((await post(payload("c"))).status).toBe(200);
    expect(calls.settle).toBe(2);
  });
});

test("USDt0 to USDC and USDC to USDG requests cannot reuse a logical key", async () => {
  await fixture(async ({ post, calls }) => {
    expect((await post(payload("a", paymentOptions[0]), "{}", "u0-usdc")).status).toBe(200);
    expect((await post(payload("b", paymentOptions[1]), "{}", "u0-usdc")).status).toBe(409);
    expect((await post(payload("c", paymentOptions[1]), "{}", "usdc-usdg")).status).toBe(200);
    expect((await post(payload("d", paymentOptions[2]), "{}", "usdc-usdg")).status).toBe(409);
    expect(calls.settle).toBe(2);
  });
});

test("concurrent cross-token requests with the same logical key admit one settlement", async () => {
  await fixture(async ({ post, calls, store }) => {
    const [usdT0, usdc] = await Promise.all([
      post(payload("e", paymentOptions[0]), "{}", "cross-token"),
      post(payload("e", paymentOptions[1]), "{}", "cross-token"),
    ]);
    expect([usdT0.status, usdc.status].sort()).toEqual([200, 409]);
    expect(calls.settle).toBe(1);
    store.integrity();
  });
});

test("failed official verification never reserves or settles", async () => {
  await fixture(async ({ post, store, calls }) => {
    expect((await post(payload())).status).toBe(402);
    expect(calls.settle).toBe(0);
    expect(store.pending()).toEqual([]);
    expect(store.reserve(paymentIdentity(payload(), requirements, payer,
      { method: "POST", route: "/v1/opportunities", input: {} })).state).toBe("VERIFIED");
  }, { verify: async () => ({ isValid: false, payer }) });
});

test("malformed or contradictory positive verification never reserves or settles", async () => {
  for (const result of [
    { isValid: "true" as unknown as boolean, payer },
    { isValid: true, payer, invalidReason: "INVALID" },
    { isValid: true, payer, invalidReason: false },
    { isValid: true, payer, invalidMessage: 0 },
  ]) {
    await fixture(async ({ post, store, calls }) => {
      expect((await post(payload())).status).toBe(402);
      expect(store.pending()).toEqual([]);
      expect(calls.settle).toBe(0);
    }, { verify: async () => result });
  }
});

for (const outcome of ["no hash", "timeout hash", "pending", "failed"] as const) {
  test("ambiguous " + outcome + " blocks paid content and retries until authoritative reconciliation", async () => {
    await fixture(async ({ post, store, official, path, calls }) => {
      const p = payload();
      const response = await post(p);
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("PAYMENT_RECONCILIATION_REQUIRED");
      const row = store.pending()[0];
      expect(row.state).toBe("UNKNOWN");
      expect((await post(p)).status).toBe(409);
      expect(calls.settle).toBe(1);
      const reopened = new PaymentStore(path);
      try {
        reopened.recoverInterrupted();
        expect(reopened.get(row.id)?.state).toBe("UNKNOWN");
        const counts = await reconcilePayments(reopened, outcome === "failed" ?
          { getSettleStatus: async () => ({ success: false, status: "failed", transaction: row.txHash!, network: row.network as `eip155:${number}`, payer: row.payer }) } : official,
          20, 30_000, async () => true);
        expect(counts.checked).toBe(outcome === "no hash" ? 0 : 1);
        expect(reopened.get(row.id)?.state).toBe(outcome === "no hash" ? "UNKNOWN" :
          outcome === "failed" ? "FAILED" : "SETTLED");
      } finally { reopened.close(); }
    }, { settle: async () => {
      if (outcome === "no hash") throw new Error("private fixture error");
      return { success: outcome !== "failed", status: outcome === "pending" ? "pending" : "timeout",
        transaction: hash, network: "eip155:196" };
    } });
  });
}

test("false or unavailable receipt proof persists hash and recovery uses only stored terms", async () => {
  for (const proofFailure of ["false", "throw"] as const) {
    const diagnostics: Record<string, unknown>[] = [];
    await fixture(async ({ post, store, path, official, calls }) => {
      const response = await post(payload());
      expect(response.status).toBe(409);
      expect((await response.text()).includes('"opportunities":')).toBe(false);
      const row = store.pending(100, true)[0];
      expect(row.state).toBe("UNKNOWN");
      expect(row.txHash).toBe(hash);
      expect(row.recipient).toBe(recipient);
      expect(row.amount).toBe("10000");
      expect(row.error).toBe(proofFailure === "false" ? "SETTLEMENT_UNCONFIRMED" : "SETTLEMENT_AMBIGUOUS");
      expect(diagnostics).toContainEqual(expect.objectContaining(proofFailure === "false" ?
        { event: "payment_confirmation_rejected", stage: "confirmPayment" } :
        { event: "payment_settlement_failed", stage: "confirmPayment", errorName: "Error" }));
      expect(JSON.stringify(diagnostics)).not.toContain("fixture proof unavailable");
      const reopened = new PaymentStore(path);
      try {
        const counts = await reconcilePayments(reopened, official, 20, 30_000, async (saved) => {
          expect(saved.id).toBe(row.id);
          expect(saved.recipient).toBe(recipient);
          expect(saved.amount).toBe("10000");
          expect(saved.txHash).toBe(hash);
          return true;
        });
        expect(counts.settled).toBe(1);
        expect(reopened.get(row.id)?.state).toBe("SETTLED");
        expect(calls.settle).toBe(1);
      } finally { reopened.close(); }
    }, { onDiagnostic: (event) => diagnostics.push(event), confirm: async (record) => {
      expect(record.txHash).toBe(hash);
      expect(record.state).toBe("SETTLEMENT_IN_FLIGHT");
      if (proofFailure === "throw") throw new Error("fixture proof unavailable");
      return false;
    } });
  }
});

test("settlement diagnostics identify facilitator failures without logging response values", async () => {
  for (const outcome of ["throws", "invalid response"] as const) {
    const diagnostics: Record<string, unknown>[] = [];
    await fixture(async ({ post, calls }) => {
      expect((await post(payload())).status).toBe(409);
      expect(calls.settle).toBe(1);
      const event = diagnostics.find((entry) => entry.event === (outcome === "throws" ?
        "payment_settlement_failed" : "payment_facilitator_validation_failed"));
      expect(event?.stage).toBe(outcome === "throws" ? "official.settle" : "facilitator_validation");
      expect(JSON.stringify(diagnostics)).not.toContain("private facilitator detail");
      expect(JSON.stringify(diagnostics)).not.toContain("SECRET_API_KEY");
      expect(JSON.stringify(diagnostics)).not.toContain(payer);
      expect(JSON.stringify(diagnostics)).not.toContain(hash);
      if (outcome === "invalid response") {
        expect(event?.checks).toEqual(expect.objectContaining({ success: true, status: false, transaction: true }));
      }
    }, { onDiagnostic: (event) => diagnostics.push(event), settle: async () => {
      if (outcome === "throws") throw Object.assign(new Error("private facilitator detail"), { name: "SECRET_API_KEY" });
      return { success: true, status: "timeout", transaction: hash, network: "eip155:196", payer };
    } });
  }
});

test("retries a temporarily unavailable confirmation once, releases content only after proof, and never settles twice", async () => {
  const p = payload(), entered = deferred(), resume = deferred();
  let confirmCalls = 0, responseReady = false;
  const diagnostics: Record<string, unknown>[] = [];
  await fixture(async ({ post, store, calls }) => {
    const responsePromise = post(p).then((response) => { responseReady = true; return response; });
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(responseReady).toBe(false);
    resume.resolve();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect((await response.text()).includes('"opportunities":')).toBe(true);
    expect(confirmCalls).toBe(2);
    expect(calls.settle).toBe(1);
    const row = store.findPayment(paymentIdentity(p, requirements, payer,
      { method: "POST", route: "/v1/opportunities", input: {} }).payment)!;
    expect(row.state).toBe("SETTLED");
    expect(row.txHash).toBe(hash);
    expect(diagnostics).toContainEqual(expect.objectContaining({ event: "payment_confirmation_recovered", attempts: 2 }));
  }, { confirmationBudgetMs: 500, onDiagnostic: (event) => diagnostics.push(event), confirm: async () => {
    confirmCalls++;
    if (confirmCalls === 1) { entered.resolve(); await resume.promise; throw new PaymentConfirmationUnavailable("receipt"); }
    return true;
  } });
});

test("keeps content blocked when confirmation RPC stays unavailable through its deadline", async () => {
  const p = payload(), diagnostics: Record<string, unknown>[] = [];
  let confirmCalls = 0;
  await fixture(async ({ post, store, calls }) => {
    const response = await post(p);
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body.includes('"opportunities":')).toBe(false);
    expect(confirmCalls).toBeGreaterThan(1);
    expect(calls.settle).toBe(1);
    const row = store.pending(100, true)[0];
    expect(row.state).toBe("UNKNOWN");
    expect(row.error).toBe("SETTLEMENT_AMBIGUOUS");
    expect(row.txHash).toBe(hash);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: "payment_settlement_failed", stage: "confirmPayment", errorCode: "CONFIRMATION_RETRY_EXHAUSTED",
    }));
    expect((await post(p)).status).toBe(409);
    expect(calls.settle).toBe(1);
  }, { confirmationBudgetMs: 250, onDiagnostic: (event) => diagnostics.push(event), confirm: async () => {
    confirmCalls++;
    throw new PaymentConfirmationUnavailable("receipt");
  } });
});

test("checkpoint failure is diagnosed, preserves the hash in UNKNOWN, and does not retry confirmation", async () => {
  let confirmCalls = 0;
  const diagnostics: Record<string, unknown>[] = [];
  await fixture(async ({ post, store, calls }) => {
    const checkpoint = store.checkpointHash.bind(store);
    let failOnce = true;
    store.checkpointHash = (id, payment, transaction) => {
      if (failOnce) { failOnce = false; throw new Error("checkpoint unavailable"); }
      checkpoint(id, payment, transaction);
    };
    const response = await post(payload());
    expect(response.status).toBe(409);
    expect((await response.text()).includes('"opportunities":')).toBe(false);
    const row = store.pending(100, true)[0];
    expect(row.state).toBe("UNKNOWN");
    expect(row.error).toBe("SETTLEMENT_AMBIGUOUS");
    expect(row.txHash).toBe(hash);
    expect(confirmCalls).toBe(0);
    expect(calls.settle).toBe(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({ event: "payment_settlement_failed", stage: "checkpointHash" }));
  }, { onDiagnostic: (event) => diagnostics.push(event), confirm: async () => { confirmCalls++; return true; } });
});

test("failed final SQLite transition stays ambiguous without retrying settlement or releasing content", async () => {
  let confirmCalls = 0;
  const diagnostics: Record<string, unknown>[] = [];
  await fixture(async ({ post, store, calls }) => {
    const transition = store.transition.bind(store);
    store.transition = (id, from, to, transaction, error) => {
      if (to === "SETTLED") throw new Error("final transition unavailable");
      return transition(id, from, to, transaction, error);
    };
    const response = await post(payload());
    expect(response.status).toBe(409);
    expect((await response.text()).includes('"opportunities":')).toBe(false);
    const row = store.pending(100, true)[0];
    expect(row.state).toBe("UNKNOWN");
    expect(row.error).toBe("SETTLEMENT_AMBIGUOUS");
    expect(row.txHash).toBe(hash);
    expect(confirmCalls).toBe(1);
    expect(calls.settle).toBe(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: "payment_settlement_failed", stage: "sqlite_settled_transition",
    }));
  }, { onDiagnostic: (event) => diagnostics.push(event), confirm: async () => { confirmCalls++; return true; } });
});

test("success-shaped settlement with missing payer or contradictory errors stays UNKNOWN", async () => {
  for (const malformed of [
    { success: true, status: "success" as const, transaction: hash, network: requirements.network },
    { success: true, status: "success" as const, transaction: hash, network: requirements.network, payer, errorReason: "CONFLICT" },
    { success: true, status: "success" as const, transaction: hash, network: requirements.network, payer, errorReason: false },
    { success: true, status: "success" as const, transaction: hash, network: requirements.network, payer, errorMessage: 0 },
  ]) {
    await fixture(async ({ post, store, calls }) => {
      expect((await post(payload())).status).toBe(409);
      expect(store.pending(100, true)[0].txHash).toBe(hash);
      expect(store.pending(100, true)[0].state).toBe("UNKNOWN");
      expect(calls.settle).toBe(1);
    }, { settle: async () => malformed as unknown as SettleResponse });
  }
});

test("hash checkpoint failure plus failed UNKNOWN write leaves in-flight marker and withholds content", async () => {
  await fixture(async ({ post, store, calls }) => {
    const transition = store.transition.bind(store);
    store.checkpointHash = () => { throw new Error("disk checkpoint failure fixture"); };
    store.transition = (id, from, to, hash, error) => {
      if (from === "SETTLEMENT_IN_FLIGHT" && to === "UNKNOWN") throw new Error("disk state failure fixture");
      return transition(id, from, to, hash, error);
    };
    const response = await post(payload());
    expect(response.status).toBe(409);
    expect((await response.text()).includes('"opportunities":')).toBe(false);
    const row = store.findPayment(paymentIdentity(payload(), requirements, payer, { method: "POST", route: "/v1/opportunities", input: {} }).payment)!;
    expect(row.state).toBe("SETTLEMENT_IN_FLIGHT");
    expect(row.txHash).toBeNull();
    expect(calls.settle).toBe(1);
    expect((await post(payload())).status).toBe(409);
    expect(calls.settle).toBe(1);
  });
});

test("status query failure, pending and inconsistent result preserve ambiguity", async () => {
  await fixture(async ({ store }) => {
    const row = store.reserve(paymentIdentity(payload(), requirements, payer, { method: "POST", route: "/", input: {} }));
    store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", hash);
    const valid = { success: true, status: "success" as const, transaction: hash, network: "eip155:196" as const, payer };
    for (const result of [
      { success: false }, { success: true, status: "pending" as const },
      { ...valid, transaction: undefined }, { ...valid, payer: undefined }, { ...valid, network: "eip155:1952" },
      { ...valid, success: "true" }, { ...valid, status: "failed" }, { ...valid, errorReason: false }, { ...valid, errorMessage: 0 },
    ] as unknown as SettleStatusResponse[]) {
      expect((await reconcilePayments(store, { getSettleStatus: async () => result })).unresolved).toBe(1);
      expect(store.get(row.id)?.state).toBe("UNKNOWN");
    }
  });
});

for (const phase of ["verification", "settlement"] as const) {
  test("disconnect during " + phase + " preserves bounded durable operation", async () => {
    const entered = deferred(), unblock = deferred(), finished = deferred();
    const pause = async () => { entered.resolve(); await unblock.promise; finished.resolve(); };
    await fixture(async ({ post, calls, store }) => {
      const controller = new AbortController(), p = payload();
      const first = post(p, "{}", undefined, controller.signal).catch(() => undefined);
      await entered.promise; controller.abort(); await first;
      unblock.resolve(); await finished.promise;
      // Wait for the SDK promise and its durable commit, not an arbitrary delay.
      for (let i = 0; i < 100; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const state = store.pending();
        if (state.length === 0) break;
      }
      const repeated = await post(p);
      expect(repeated.status).toBe(409);
      expect(calls.settle).toBe(phase === "settlement" ? 1 : 0);
    }, {
      verify: async () => { if (phase === "verification") await pause(); return { isValid: true, payer }; },
      settle: async () => { if (phase === "settlement") await pause(); return {
        success: true, status: "success", transaction: hash, network: "eip155:196",
      }; },
    });
  });
}

test("storage failure after verification prevents settlement and sanitizes errors", async () => {
  await fixture(async ({ post, store, calls }) => {
    store.close();
    const response = await post(payload());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("PAYMENT_STORAGE_UNAVAILABLE");
    expect(body).not.toContain("stack");
    expect(calls.settle).toBe(0);
  });
});

test("consumed nonce rejected by official verifier still returns duplicate conflict, not a new challenge", async () => {
  let verifies = 0;
  await fixture(async ({ post, calls }) => {
    const p = payload();
    expect((await post(p)).status).toBe(200);
    const retry = await post(p);
    expect(retry.status).toBe(409);
    expect(retry.headers.has("payment-required")).toBe(false);
    expect((await retry.json()).error.code).toBe("PAYMENT_ALREADY_RESERVED");
    expect(calls.settle).toBe(1);
  }, { verify: async () => ({ isValid: ++verifies === 1, payer }) });
});

test("confirmed fixture settlement is durable before paid response delivery", async () => {
  await fixture(async ({ post, store }) => {
    const p = payload();
    expect((await post(p)).status).toBe(200);
    const identity = paymentIdentity(p, requirements, payer, { method: "POST", route: "/v1/opportunities", input: {} });
    expect(store.findPayment(identity.payment)?.state).toBe("SETTLED");
    expect(store.findPayment(identity.payment)?.txHash).toBe(hash);
  });
});

test("settlement result persistence failure never discloses buffered paid content", async () => {
  await fixture(async ({ post, store, calls }) => {
    const transition = store.transition.bind(store);
    let writeFailed = false;
    store.transition = (id, from, to, txHash, error) => {
      if (to === "SETTLED" && !writeFailed) { writeFailed = true; throw new Error("disk-failure-fixture"); }
      return transition(id, from, to, txHash, error);
    };
    const response = await post(payload());
    expect(response.status).toBe(409);
    expect((await response.text()).includes('"opportunities":')).toBe(false);
    expect(calls.settle).toBe(1);
    expect(store.pending()[0].state).toBe("UNKNOWN");
    expect(store.pending()[0].txHash).toBe(hash);
    expect((await reconcilePayments(store, { getSettleStatus: async () => ({ success: true, status: "success", transaction: hash, network: "eip155:196", payer }) }, 20, 30_000, async () => true)).settled).toBe(1);
  });
});

test("unsupported authorization and oversized logical key never settle", async () => {
  await fixture(async ({ post, calls }) => {
    const p = payload();
    p.payload = { permit2: {}, signature: "fixture" };
    expect((await post(p)).status).toBe(400);
    expect((await post(payload(), "{}", "a".repeat(129))).status).toBe(400);
    expect(calls.settle).toBe(0);
  });
});

test("buyer-added transfer metadata cannot change the authoritative EIP-3009 domain", () => {
  const p = payload();
  p.accepted = { ...requirements, extra: { name: "USD₮0", version: "1", assetTransferMethod: "permit2" } };
  expect(() => paymentIdentity(p, requirements, payer, { method: "POST", route: "/", input: {} })).toThrow("PAYMENT_IDENTITY_UNSUPPORTED");
  const nativeMethod = payload();
  nativeMethod.accepted = { ...requirements, extra: { name: "USD₮0", version: "1", assetTransferMethod: "eip3009" } };
  expect(paymentIdentity(nativeMethod, requirements, payer, { method: "POST", route: "/", input: {} }).payment)
    .toBe(paymentIdentity(payload(), requirements, payer, { method: "POST", route: "/", input: {} }).payment);
});

test("Vercel rejects a configured local durable path rather than advertising false persistence", () => {
  expect(() => loadOperationalConfig({ VERCEL: "1", PAYMENT_DB_PATH: "/tmp/payments.sqlite" })).toThrow("CONFIG_INVALID: PAYMENT_DB_PATH");
  expect(loadOperationalConfig({ VERCEL: "1" }).paymentDbPath).toBeUndefined();
});

test("reconciliation selects hash-bearing records beyond permanent hashless ambiguity", async () => {
  await fixture(async ({ store, official }) => {
    for (let i = 0; i < 101; i++) {
      const row = store.reserve({
        payment: i.toString(16).padStart(64, "0"), binding: "b".repeat(64), logicalKey: null,
        network: "eip155:196", payer, recipient, amount: "10000", validBefore: Date.now() + 60_000,
      });
      store.transition(row.id, "VERIFIED", "UNKNOWN");
    }
    const row = store.reserve(paymentIdentity(payload("f"), requirements, payer, { method: "POST", route: "/", input: {} }));
    store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", hash);
    expect((await reconcilePayments(store, official, 20, 30_000, async () => true)).settled).toBe(1);
    expect(store.get(row.id)?.state).toBe("SETTLED");
  });
});

test("failed status queries rotate so later recoverable records are not starved", async () => {
  await fixture(async ({ store }) => {
    for (let i = 0; i < 21; i++) {
      const row = store.reserve({
        payment: i.toString(16).padStart(64, "0"), binding: "b".repeat(64), logicalKey: null,
        network: "eip155:196", payer, recipient, amount: "10000", validBefore: Date.now() + 60_000,
      });
      store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
      store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", "0x" + i.toString(16).padStart(64, "0"));
    }
    const successfulHash = "0x" + (20).toString(16).padStart(64, "0");
    const client = { getSettleStatus: async (txHash: string) => {
      if (txHash !== successfulHash) throw new Error("temporary transport fixture failure");
      return { success: true, status: "success" as const, transaction: txHash, network: "eip155:196" as const, payer };
    } };
    expect((await reconcilePayments(store, client, 20, 30_000, async () => true)).unresolved).toBe(20);
    expect((await reconcilePayments(store, client, 20, 30_000, async () => true)).settled).toBe(1);
  });
});

test("confirmed cancellation permits one concurrent new authorization with the same key, never the old payment", async () => {
  let fail = true;
  await fixture(async ({ post, store, calls }) => {
    const p = payload(), key = "cancelled-logical-request";
    const failed = await post(p, "{}", key);
    expect(failed.status).toBe(503);
    expect((await failed.text()).includes('"opportunities":')).toBe(false);
    const identity = paymentIdentity(p, requirements, payer, { method: "POST", route: "/v1/opportunities", input: {} });
    const original = store.findPayment(identity.payment)!;
    expect(original.state).toBe("CANCELLED");
    expect(original.txHash).toBeNull();
    expect(calls.settle).toBe(0);
    fail = false;
    const retries = await Promise.all([post(payload("b"), "{}", key), post(payload("c"), "{}", key)]);
    expect(retries.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(calls.settle).toBe(1);
    expect(store.get(original.id)?.state).toBe("CANCELLED");
    expect(store.get(original.id)?.logicalKey).toBeNull();
    const replay = await post(p, "{}", key);
    expect(replay.status).toBe(409);
    expect((await replay.text()).includes('"opportunities":')).toBe(false);
    expect(calls.settle).toBe(1);
  }, { failExecution: () => fail });
});

test("settlement transport ambiguity retains the logical key against a newly signed retry", async () => {
  await fixture(async ({ post, store, calls }) => {
    const key = "ambiguous-logical-request";
    const response = await post(payload(), "{}", key);
    expect(response.status).toBe(409);
    expect((await response.text()).includes('"opportunities":')).toBe(false);
    expect(store.pending()[0].state).toBe("UNKNOWN");
    expect(store.pending()[0].logicalKey).not.toBeNull();
    expect((await post(payload("b"), "{}", key)).status).toBe(409);
    expect(calls.settle).toBe(1);
  }, { settle: async () => { throw new Error("transport-fixture-failed"); } });
});
