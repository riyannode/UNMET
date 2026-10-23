import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { PaymentRecord, PaymentStore } from "./payment-store.ts";
import { PaymentError } from "./payment-error.ts";
import { authorizationFingerprint, paymentIdentity } from "./payment-identity.ts";

type Facilitator = Pick<OKXFacilitatorClient, "getSupported" | "verify" | "settle" | "getSettleStatus">;
type Context = {
  method: string; route: string; input: unknown; key?: string;
  record?: PaymentRecord; failure?: PaymentError;
};
const scope = new AsyncLocalStorage<Context>();
function context() {
  const ctx = scope.getStore();
  if (!ctx) throw new PaymentError("PAYMENT_CONTEXT_UNAVAILABLE");
  return ctx;
}
function failure(ctx: Context, error: unknown) {
  return ctx.failure = error instanceof PaymentError ? error : new PaymentError("PAYMENT_STORAGE_UNAVAILABLE");
}

export function durablePayment(store: PaymentStore, official: Facilitator) {
  const client: Facilitator = {
    getSupported: () => official.getSupported(),
    getSettleStatus: (hash) => official.getSettleStatus(hash),
    verify: async (payload, requirements) => {
      const result = await official.verify(payload, requirements);
      const ctx = context();
      if (!result.isValid) {
        // A consumed nonce may fail official verification on retry. Reject a known
        // operation without issuing a misleading new-payment challenge or any content.
        let identity: string | undefined;
        try { identity = authorizationFingerprint(payload, requirements); } catch { /* Unsupported invalid payload. */ }
        try {
          if (identity && store.findPayment(identity)) {
            throw new PaymentError("PAYMENT_ALREADY_RESERVED", 409);
          }
        } catch (error) { throw failure(ctx, error); }
        return result;
      }
      try {
        ctx.record = store.reserve(paymentIdentity(payload, requirements, result.payer, ctx));
      } catch (error) { throw failure(ctx, error); }
      return result;
    },
    settle: async (payload, requirements) => {
      const ctx = context();
      const record = ctx.record;
      if (!record) throw failure(ctx, new PaymentError("PAYMENT_CONTEXT_UNAVAILABLE"));
      // This commit must finish before the official facilitator can submit anything.
      try { store.transition(record.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT"); }
      catch (error) { throw failure(ctx, error); }
      let observedHash: string | null = null;
      try {
        const result = await official.settle(payload, requirements);
        const hash = observedHash = /^0x[0-9a-fA-F]{64}$/.test(result.transaction) ? result.transaction : null;
        if (result.success && result.status === "success" && hash && result.network === record.network) {
          store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "SETTLED", hash);
          return result;
        }
        store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", hash, "SETTLEMENT_UNCONFIRMED");
        // The SDK releases content for "pending". Durable mode requires confirmed success.
        throw new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409);
      } catch (error) {
        try {
          if (store.get(record.id)?.state === "SETTLEMENT_IN_FLIGHT") {
            store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", observedHash, "SETTLEMENT_AMBIGUOUS");
          }
        } catch { /* The durable in-flight marker remains blocked if storage fails. */ }
        throw failure(ctx, error instanceof PaymentError ? error : new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409));
      }
    },
  };
  const wrap = (middleware: RequestHandler): RequestHandler => (req, res, next) => {
    const key = req.get("idempotency-key");
    if (key !== undefined && !/^[\x21-\x7e]{1,128}$/.test(key)) {
      res.status(400).json({ error: { code: "IDEMPOTENCY_KEY_INVALID", message: "Invalid Idempotency-Key" } });
      return;
    }
    const ctx: Context = { method: req.method, route: req.path, input: res.locals.opportunityInput, key };
    const json = res.json.bind(res);
    res.json = (body) => {
      if (ctx.failure) {
        res.removeHeader("payment-required");
        res.removeHeader("payment-response");
        res.status(ctx.failure.status);
        res.setHeader("retry-after", "1");
        return json({ error: { code: ctx.failure.code, message: "Payment operation unavailable; do not submit a new payment" } });
      }
      return json(body);
    };
    return scope.run(ctx, async () => {
      try { await middleware(req, res, next); }
      finally {
        if (ctx.record) {
          try {
            if (store.get(ctx.record.id)?.state === "VERIFIED") {
              store.transition(ctx.record.id, "VERIFIED", "CANCELLED", null, "EXECUTION_INCOMPLETE");
            }
          } catch { /* A failed cleanup leaves a reserved identity, never reusable. */ }
        }
        res.json = json;
      }
    });
  };
  return { client, wrap };
}

export async function reconcilePayments(store: PaymentStore, client: Pick<Facilitator, "getSettleStatus">,
  limit = 20, budgetMs = 30_000) {
  const counts = { checked: 0, settled: 0, failed: 0, unresolved: 0 };
  const deadline = Date.now() + budgetMs;
  for (const record of store.pending(100, true)) {
    if (!record.txHash) continue;
    if (counts.checked >= limit || Date.now() >= deadline) break;
    counts.checked++;
    try {
      const result = await client.getSettleStatus(record.txHash);
      const matches = (!result.transaction || result.transaction.toLowerCase() === record.txHash.toLowerCase()) &&
        (!result.network || result.network === record.network) &&
        (!result.payer || result.payer.toLowerCase() === record.payer);
      if (matches && result.status === "success" && result.success) {
        store.transition(record.id, "UNKNOWN", "SETTLED");
        counts.settled++;
      } else if (matches && result.status === "failed" && !result.success) {
        store.transition(record.id, "UNKNOWN", "FAILED", null, "SETTLEMENT_FAILED");
        counts.failed++;
      } else {
        store.transition(record.id, "UNKNOWN", "UNKNOWN", null, "RECONCILIATION_PENDING");
        counts.unresolved++;
      }
    } catch {
      counts.unresolved++;
      try { store.transition(record.id, "UNKNOWN", "UNKNOWN", null, "RECONCILIATION_UNAVAILABLE"); }
      catch { /* Storage failures leave the existing durable marker untouched. */ }
    }
  }
  return counts;
}
