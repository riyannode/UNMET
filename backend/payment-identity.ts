import { createHash } from "node:crypto";
import type { PaymentPayload, PaymentRequirements } from "@okxweb3/x402-core/types";
import type { Reservation } from "./payment-store.ts";
import { PaymentError } from "./payment-error.ts";

export function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
}
export const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  return value as Record<string, unknown>;
}
function address(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  return value.toLowerCase();
}
function integer(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  return BigInt(value).toString();
}

export function authorizationFingerprint(payload: PaymentPayload, requirements: PaymentRequirements) {
  const auth = object(object(payload.payload).authorization);
  if (typeof auth.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  }
  return fingerprint({ network: requirements.network, asset: address(requirements.asset),
    from: address(auth.from), nonce: auth.nonce.toLowerCase() });
}

export function paymentIdentity(payload: PaymentPayload, requirements: PaymentRequirements, payer: string | undefined,
  request: { method: string; route: string; input: unknown; key?: string }): Reservation {
  const auth = object(object(payload.payload).authorization);
  const from = address(auth.from), to = address(auth.to), asset = address(requirements.asset);
  const verifiedPayer = address(payer);
  if (from !== verifiedPayer || to !== address(requirements.payTo) ||
    integer(auth.value) !== integer(requirements.amount) || requirements.scheme !== "exact" ||
    typeof auth.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  }
  const validBefore = Number(integer(auth.validBefore)) * 1000;
  const validAfter = integer(auth.validAfter);
  if (!Number.isSafeInteger(validBefore) || validBefore <= Date.now() || BigInt(validAfter) * 1000n >= BigInt(validBefore)) {
    throw new PaymentError("PAYMENT_IDENTITY_UNSUPPORTED", 400);
  }
  const network = requirements.network;
  return {
    // Same chain/token/payer/nonce is one operation, even if signed terms or request change.
    payment: authorizationFingerprint(payload, requirements),
    binding: fingerprint({ method: request.method, route: request.route, input: request.input,
      network, asset, from, to, amount: integer(auth.value), validAfter, validBefore,
      nonce: auth.nonce.toLowerCase(), extra: requirements.extra ?? {} }),
    logicalKey: request.key ? fingerprint({ payer: from, network, key: request.key }) : null,
    network, recipient: to, amount: integer(auth.value), payer: from, validBefore,
  };
}
