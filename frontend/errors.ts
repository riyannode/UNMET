export function errorMessage(error: unknown): string {
  const message = typeof error === "string"
    ? error.trim()
    : typeof error === "object" && error !== null
      ? errorField(error, "shortMessage") ?? errorField(error, "message") ?? errorField(error, "details") ?? ""
      : "";
  if (!message) {
    const code = typeof error === "object" && error !== null && "code" in error
      && (typeof error.code === "number" || typeof error.code === "string")
      ? String(error.code)
      : "";
    return code ? "INTERNAL_ERROR (" + code + ")" : "INTERNAL_ERROR";
  }
  const known = message.match(/(WALLET_[A-Z_]+|CHAIN_[A-Z_]+|DEMAND_[A-Z_]+|SUPPORT_[A-Z_]+|SUBMISSION_[A-Z_]+|VALIDATION_[A-Z_]+|DEPLOYMENT_[A-Z_]+|TRANSACTION_[A-Z_]+)/)?.[1];
  if (known === "DEMAND_INVALID_CAPABILITY") return "Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max)";
  if (known === "VALIDATION_UNAVAILABLE") return "Service validation is not configured or unavailable";
  if (known === "VALIDATION_FAILED" || known === "VALIDATION_INVALID_PASS" || known === "VALIDATION_INVALID_SIGNATURE") return "Service validation failed. Review the request and try again";
  if (known === "VALIDATION_INVALID_REQUEST" || known === "VALIDATION_INVALID_PAYTO") return "Check the validation request and payment receiver";
  if (known === "VALIDATION_EXPIRED" || known === "VALIDATION_NONCE_STALE") return "Validation expired or the proposal changed. Validate again before submitting";
  if (known === "SUBMISSION_READBACK_FAILED") return "The transaction was confirmed but the proposal could not be verified. Check the pending transaction before retrying";
  return known ?? message.slice(0, 180);
}

function errorField(error: object, field: "shortMessage" | "message" | "details"): string | undefined {
  const value = field === "shortMessage"
    ? "shortMessage" in error ? error.shortMessage : undefined
    : field === "message"
      ? "message" in error ? error.message : undefined
      : "details" in error ? error.details : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
