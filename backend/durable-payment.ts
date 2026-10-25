import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { PaymentRecord, PaymentStore } from "./payment-store.ts";
import { PaymentError } from "./payment-error.ts";
import { authorizationFingerprint, paymentIdentity } from "./payment-identity.ts";
import {
  confirmPayment,
  confirmPaymentWithRetry,
  createMainnetPaymentClient,
  PaymentConfirmationRetryExceeded,
  PaymentConfirmationUnavailable,
} from "./payment-confirmation.ts";
import { loadOperationalConfig } from "./config.ts";

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
function noProviderError(value: unknown) {
  return value === undefined || value === null || value === "";
}

const mainnetClient = createMainnetPaymentClient();
const confirmationBudgetMs = loadOperationalConfig().rpcTimeoutMs;

type Diagnostic = Record<string, unknown>;
type DurablePaymentOptions = {
  confirmationBudgetMs?: number;
  onDiagnostic?: (event: Diagnostic) => void;
};

function errorFields(error: unknown) {
  const knownNames = new Set(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError"]);
  const errorName = error instanceof Error && knownNames.has(error.name) ? error.name : error instanceof Error ? "Error" : "UnknownError";
  const code = error instanceof PaymentError ? error.code
    : error instanceof PaymentConfirmationRetryExceeded ? error.code
    : error instanceof PaymentConfirmationUnavailable ? "CONFIRMATION_RPC_UNAVAILABLE" : undefined;
  return {
    errorName,
    ...(code ? { errorCode: code } : {}),
    ...(error instanceof PaymentConfirmationUnavailable ? { confirmationReadStage: error.stage } : {}),
    ...(error instanceof PaymentConfirmationRetryExceeded ? { attempts: error.attempts, confirmationReadStage: error.stage } : {}),
  };
}

export function durablePayment(store: PaymentStore, official: Facilitator,
  confirm: (record: PaymentRecord) => Promise<boolean> = (record) => confirmPayment(record, mainnetClient),
  options: DurablePaymentOptions = {}) {
  const retryBudgetMs = options.confirmationBudgetMs ?? confirmationBudgetMs;
  const diagnose = (event: Diagnostic) => {
    try {
      const entry = { time: new Date().toISOString(), level: "error", ...event };
      if (options.onDiagnostic) options.onDiagnostic(entry);
      else console.log(JSON.stringify(entry));
    } catch { /* Diagnostics must not change payment outcomes. */ }
  };
  const client: Facilitator = {
    getSupported: () => official.getSupported(),
    getSettleStatus: (hash) => official.getSettleStatus(hash),
    verify: async (payload, requirements) => {
      const result = await official.verify(payload, requirements);
      const ctx = context();
      if (result.isValid !== true || !noProviderError(result.invalidReason) || !noProviderError(result.invalidMessage)) {
        // A consumed nonce may fail official verification on retry. Reject a known
        // operation without issuing a misleading new-payment challenge or any content.
        let identity: string | undefined;
        try { identity = authorizationFingerprint(payload, requirements); } catch { /* Unsupported invalid payload. */ }
        try {
          if (identity && store.findPayment(identity)) {
            throw new PaymentError("PAYMENT_ALREADY_RESERVED", 409);
          }
        } catch (error) { throw failure(ctx, error); }
        return { ...result, isValid: false };
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
      try {
        const current = paymentIdentity(payload, requirements, record.payer, ctx);
        if (current.payment !== record.payment || current.binding !== record.binding || current.logicalKey !== record.logicalKey ||
          current.network !== record.network || current.recipient !== record.recipient || current.amount !== record.amount ||
          current.payer !== record.payer || current.validBefore !== record.validBefore) throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
      } catch (error) { throw failure(ctx, error); }
      // This commit must finish before the official facilitator can submit anything.
      try { store.transition(record.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT"); }
      catch (error) {
        diagnose({ event: "payment_settlement_failed", stage: "sqlite_in_flight_transition", paymentId: record.id, ...errorFields(error) });
        throw failure(ctx, error);
      }
      let observedHash: string | null = null;
      let stage = "official.settle";
      try {
        const result = await official.settle(payload, requirements);
        stage = "facilitator_validation";
        const transaction = typeof result?.transaction === "string" ? result.transaction : "";
        const hash = observedHash = /^0x[0-9a-fA-F]{64}$/.test(transaction) ? transaction : null;
        if (hash) {
          stage = "checkpointHash";
          store.checkpointHash(record.id, record.payment, hash);
        }
        stage = "facilitator_validation";
        const checks = {
          success: result?.success === true,
          status: result?.status === "success",
          transaction: hash !== null,
          network: result?.network === record.network,
          payer: typeof result?.payer === "string" && result.payer.toLowerCase() === record.payer,
          errorReason: noProviderError(result?.errorReason),
          errorMessage: noProviderError(result?.errorMessage),
        };
        if (Object.values(checks).some((passed) => !passed)) {
          diagnose({ event: "payment_facilitator_validation_failed", stage, paymentId: record.id, checks });
          stage = "sqlite_unconfirmed_transition";
          store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", null, "SETTLEMENT_UNCONFIRMED");
          throw new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409);
        }
        stage = "sqlite_confirmation_record_read";
        const persisted = store.get(record.id);
        if (!persisted?.txHash || persisted.txHash.toLowerCase() !== hash!.toLowerCase()) {
          throw new PaymentError("PAYMENT_STATE_CONFLICT");
        }
        stage = "confirmPayment";
        const confirmation = await confirmPaymentWithRetry(persisted, confirm, retryBudgetMs);
        if (!confirmation.confirmed) {
          diagnose({ event: "payment_confirmation_rejected", stage, paymentId: record.id, attempts: confirmation.attempts });
          stage = "sqlite_unconfirmed_transition";
          store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", null, "SETTLEMENT_UNCONFIRMED");
          throw new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409);
        }
        if (confirmation.attempts > 1) {
          diagnose({ event: "payment_confirmation_recovered", stage, paymentId: record.id,
            level: "info", attempts: confirmation.attempts, confirmationReadStage: confirmation.lastStage });
        }
        stage = "sqlite_settled_transition";
        store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "SETTLED");
        return result;
      } catch (error) {
        if (!(error instanceof PaymentError && error.code === "PAYMENT_RECONCILIATION_REQUIRED")) {
          diagnose({ event: "payment_settlement_failed", stage, paymentId: record.id,
            transactionHashObserved: observedHash !== null, ...errorFields(error) });
        }
        let state: PaymentRecord | null | undefined;
        try { state = store.get(record.id); }
        catch (storageError) {
          diagnose({ event: "payment_settlement_failed", stage: "sqlite_ambiguous_state_read", paymentId: record.id,
            transactionHashObserved: observedHash !== null, ...errorFields(storageError) });
        }
        if (state?.state === "SETTLEMENT_IN_FLIGHT") {
          try { store.transition(record.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", observedHash, "SETTLEMENT_AMBIGUOUS"); }
          catch (storageError) {
            diagnose({ event: "payment_settlement_failed", stage: "sqlite_ambiguous_transition", paymentId: record.id,
              transactionHashObserved: observedHash !== null, ...errorFields(storageError) });
          }
        }
        throw failure(ctx, new PaymentError("PAYMENT_RECONCILIATION_REQUIRED", 409));
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
  limit = 20, budgetMs = 30_000, confirm: (record: PaymentRecord) => Promise<boolean> =
    (record) => confirmPayment(record, mainnetClient)) {
  const counts = { checked: 0, settled: 0, failed: 0, unresolved: 0 };
  const deadline = Date.now() + budgetMs;
  for (const record of store.pending(100, true)) {
    if (!record.txHash) continue;
    if (counts.checked >= limit || Date.now() >= deadline) break;
    counts.checked++;
    try {
      const result = await client.getSettleStatus(record.txHash);
      const matches = result.transaction?.toLowerCase() === record.txHash.toLowerCase() &&
        result.network === record.network && result.payer?.toLowerCase() === record.payer;
      if (matches && result.status === "success" && result.success === true && noProviderError(result.errorReason) && noProviderError(result.errorMessage) && await confirm(record)) {
        store.transition(record.id, "UNKNOWN", "SETTLED");
        counts.settled++;
      } else if (matches && result.status === "failed" && result.success === false) {
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
