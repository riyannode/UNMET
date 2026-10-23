import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@okxweb3/x402-core/types";
import type { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { PaymentStore } from "./payment-store.ts";
import { durablePayment, reconcilePayments } from "./durable-payment.ts";
import { paymentIdentity } from "./payment-identity.ts";
import { createApp } from "./server.ts";
import { loadOperationalConfig } from "./config.ts";
import { loadConfig } from "./contract.ts";
import type { PublicClient } from "viem";

const payer = "0x" + "2".repeat(40), recipient = "0x" + "1".repeat(40), asset = "0x" + "3".repeat(40);
const hash = "0x" + "a".repeat(64);
const requirements: PaymentRequirements = {
  scheme: "exact", network: "eip155:196", asset, amount: "10000", payTo: recipient,
  maxTimeoutSeconds: 300, extra: { name: "Fixture", version: "1" },
};
function payload(nonce = "a"): PaymentPayload {
  return {
    x402Version: 2, accepted: requirements,
    payload: { signature: "0xfixture", authorization: { from: payer, to: recipient, value: "10000",
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
} = {}) {
  const dir = mkdtempSync(tmpdir() + "/unmet-durable-");
  const path = dir + "/payments.sqlite", store = new PaymentStore(path);
  const calls = { verify: 0, settle: 0 };
  const official: Official = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} }),
    verify: async () => { calls.verify++; return options.verify ? options.verify() : { isValid: true, payer }; },
    settle: async () => { calls.settle++; return options.settle ? options.settle() :
      { success: true, status: "success", transaction: hash, network: "eip155:196" }; },
    getSettleStatus: async () => ({ success: true, status: "success", transaction: hash, network: "eip155:196", payer }),
  };
  const durable = durablePayment(store, official);
  const resource = new x402ResourceServer(durable.client).register("eip155:196", new ExactEvmScheme());
  await resource.initialize();
  const paid = paymentMiddleware({
    "POST /v1/opportunities": { accepts: [{ scheme: "exact", network: "eip155:196", payTo: recipient,
      price: { asset, amount: "10000", extra: { name: "Fixture", version: "1" } } }] },
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
  const first = paymentIdentity(original, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 10 } });
  const auth = original.payload.authorization as Record<string, unknown>;
  const variant = { ...original, payload: { signature: "different", authorization: { ...auth, from: payer.toUpperCase().replace("0X", "0x"), value: "010000" } } };
  expect(paymentIdentity(variant, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 10 } }).payment).toBe(first.payment);
  const changed = paymentIdentity(original, requirements, payer, { method: "POST", route: "/v1/opportunities", input: { limit: 20 } });
  expect(changed.payment).toBe(first.payment);
  expect(changed.binding).not.toBe(first.binding);
  expect(() => paymentIdentity(original, requirements, recipient, { method: "POST", route: "/", input: {} })).toThrow();
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
    success: true, status: "success", transaction: hash, network: "eip155:196",
  }; } });
});

test("same key conflicts with changed payload or fresh authorization; independent payments work", async () => {
  await fixture(async ({ post, calls }) => {
    const p = payload();
    expect((await post(p, "{}", "logical")).status).toBe(200);
    expect((await post(p, '{"limit":1}', "logical")).status).toBe(409);
    expect((await post(payload("b"), "{}", "logical")).status).toBe(409);
    expect((await post(payload("c"))).status).toBe(200);
    expect(calls.settle).toBe(2);
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
          { getSettleStatus: async () => ({ success: false, status: "failed" }) } : official);
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

test("status query failure, pending and inconsistent result preserve ambiguity", async () => {
  await fixture(async ({ store }) => {
    const row = store.reserve(paymentIdentity(payload(), requirements, payer, { method: "POST", route: "/", input: {} }));
    store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", hash);
    for (const result of [
      { success: false }, { success: true, status: "pending" as const },
      { success: true, status: "success" as const, network: "eip155:1952" as const },
    ]) {
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
    expect((await reconcilePayments(store, { getSettleStatus: async () => ({ success: true, status: "success" }) })).settled).toBe(1);
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
    expect((await reconcilePayments(store, official)).settled).toBe(1);
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
      return { success: true, status: "success" as const };
    } };
    expect((await reconcilePayments(store, client)).unresolved).toBe(20);
    expect((await reconcilePayments(store, client)).settled).toBe(1);
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
