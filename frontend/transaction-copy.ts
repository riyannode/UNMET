import { errorCode, errorMessage, ValidationResponseError } from "./errors";
import type { TransactionState } from "./transaction-lifecycle";

export type TransactionNotice = {
  title: string;
  description: string;
  tone: "neutral" | "success" | "error";
  pending?: true;
};

type NoticeState = TransactionState | "preparing" | "checking" | "refresh-unavailable" | "approval-confirmed";

export function transactionNotice(state: NoticeState, actionId?: string): TransactionNotice {
  switch (state) {
    case "preparing": return { title: "Preparing your request", description: "Check your wallet for prompts.", tone: "neutral" };
    case "broadcast": return { title: "Transaction submitted", description: "Waiting for X Layer confirmation. Do not submit again.", tone: "neutral", pending: true };
    case "unknown": return { title: "Transaction not verified yet", description: "Do not submit again. Verify the existing transaction first.", tone: "neutral", pending: true };
    case "checking": return { title: "Checking existing transaction", description: "No new transaction is being sent.", tone: "neutral", pending: true };
    case "confirmed": return { title: "Transaction confirmed", description: "Refreshing demand data.", tone: "neutral" };
    case "refresh-unavailable": return { title: "Transaction confirmed", description: "Latest demand data is unavailable. Refresh before continuing.", tone: "neutral" };
    case "approval-confirmed": return { title: "Token approval completed", description: actionId ? "The " + ((actionId === "create" || actionId === "create-demand") ? "demand" : "funding") + " transaction was not sent. Continue when you are ready." : "Check your wallet for the next step.", tone: "neutral" };
    case "reverted": return { title: "Transaction failed on X Layer", description: "This action was not applied.", tone: "error" };
    case "cancelled": return { title: "Transaction cancelled", description: "Your wallet replaced it with a cancellation.", tone: "neutral" };
  }
}

const validationReasons: Record<string, string> = {
  INVALID_REQUEST: "Check the service URL and request details.",
  INVALID_JSON: "Check the service URL and request details.",
  INVALID_RESOURCE: "Check the service URL and request details.",
  INVALID_CHALLENGE: "The service did not return a valid x402 payment challenge.",
  INVALID_RESPONSE: "The service did not return a valid x402 payment challenge.",
  NO_ELIGIBLE_OFFER: "No payment offer meets this demand's requirements.",
  UNSUPPORTED_PRICE_COMPARISON: "The service payment asset does not match this demand's pricing.",
  UNSUPPORTED_POLICY: "This payment network is not supported for this demand.",
  INVALID_TARGET: "Use a public HTTPS service URL.",
  UNSAFE_ADDRESS: "Use a public HTTPS service URL.",
  INVALID_BUILDER_AUTHORIZATION: "Builder authorization could not be verified.",
  DEMAND_INELIGIBLE: "This demand changed or is not accepting proposals. Refresh it.",
  ENDPOINT_UNAVAILABLE: "The service endpoint could not be reached.",
  DNS_UNAVAILABLE: "The service endpoint could not be reached.",
  TRANSPORT_UNAVAILABLE: "The service endpoint could not be reached.",
  TRANSPORT_TIMEOUT: "The service endpoint could not be reached.",
};

export function transactionErrorNotice(error: unknown, context: { actionId?: string; approvalCompleted?: boolean } = {}): TransactionNotice {
  const code = errorCode(error) ?? errorMessage(error);
  if (code === "SUBMISSION_READBACK_FAILED") return {
    title: "Transaction confirmed", description: "Proposal details are not verified yet. Do not submit again.", tone: "neutral", pending: true,
  };
  if (error instanceof ValidationResponseError || code.startsWith("VALIDATION_") || code === "INVALID_JSON") {
    if (error instanceof ValidationResponseError ? error.status === "UNAVAILABLE" : code === "VALIDATION_UNAVAILABLE") {
      return { title: "Validation unavailable", description: "Try again later. No transaction was sent.", tone: "neutral" };
    }
    const reason = error instanceof ValidationResponseError ? Object.hasOwn(validationReasons, error.code) ? validationReasons[error.code] : undefined
      : code === "VALIDATION_INVALID_PAYTO" ? "Check the authorized payment receiver."
      : code === "VALIDATION_INVALID_REQUEST" || code === "INVALID_JSON" ? validationReasons.INVALID_REQUEST
      : code === "VALIDATION_EXPIRED" || code === "VALIDATION_NONCE_STALE" ? "The authorization expired or the proposal changed. Validate again."
      : undefined;
    return { title: "Service validation failed", description: (reason ?? "Review the service request and try validation again.") + " No transaction was sent.", tone: "error" };
  }
  const notSent = context.approvalCompleted
    ? "Token approval completed. The " + ((context.actionId === "create" || context.actionId === "create-demand") ? "demand" : "funding") + " transaction was not sent."
    : "No transaction was sent.";
  if (code === "WALLET_REJECTED") return { title: "Cancelled in wallet", description: notSent, tone: "neutral" };
  const requestErrors: Record<string, string> = {
    WALLET_NOT_CONNECTED: "Connect your wallet before continuing.",
    WALLET_NOT_FOUND: "Connect your wallet before continuing.",
    WALLET_CHANGED: "Your wallet changed. Reconnect the original wallet.",
    CHAIN_WRONG_NETWORK: "Switch to the configured X Layer network.",
    DEMAND_INVALID_CAPABILITY: "Use letters and numbers separated by spaces or hyphens (64 characters max).",
    DEMAND_INVALID_SPEC: "Check the service description.",
    DEMAND_INVALID_AMOUNT: "Check the price and commitment amount.",
    DEMAND_INVALID_CALLS: "Enter a valid number of expected calls.",
    DEMAND_DEADLINE_TOO_SHORT: "Choose a deadline of at least one hour.",
    DEMAND_INVALID_DEADLINE: "Choose a valid future deadline.",
    SUPPORT_TOO_SMALL: "Check the minimum commitment amount.",
    SUBMISSION_INVALID_URL: "Use a public HTTPS service URL without a query or fragment.",
    SUBMISSION_INVALID_EVIDENCE: "Enter a non-empty evidence description.",
  };
  if (Object.hasOwn(requestErrors, code)) return { title: "Check your request", description: requestErrors[code] + " " + notSent, tone: "error" };
  return { title: "Transaction result unavailable", description: "Check your wallet activity before trying again.", tone: "neutral" };
}

export function transactionSuccess(actionId: string, demandLocated = true): TransactionNotice {
  if ((actionId === "create" || actionId === "create-demand") && !demandLocated) return {
    title: "Transaction confirmed", description: "Your demand has not been located yet. Refresh the market.", tone: "neutral",
  };
  const copy: Record<string, [string, string]> = {
    create: ["Demand created", "Your funded demand is ready."],
    support: ["Funding added", "Your commitment was added."],
    submit: ["Service submitted", "Your proposal was submitted successfully."],
    approve: ["Approval recorded", "Your approval vote was recorded."],
    reject: ["Rejection recorded", "Your rejection vote was recorded."],
    finalize: ["Settlement complete", "Approved funds were paid out."],
    cancel: ["Settlement cancelled", "Eligible funds can now be refunded."],
    reopen: ["Demand reopened", "Ready for a new proposal."],
    refund: ["Refund complete", "Your eligible funds were returned."],
  };
  const action = actionId === "create-demand" ? "create" : actionId.split(":")[0];
  const [title, description] = copy[action] ?? ["Transaction confirmed", "The action completed."];
  return { title, description, tone: "success" };
}
