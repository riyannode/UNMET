export class ValidationResponseError extends Error {
  constructor(readonly status: "FAIL" | "UNAVAILABLE", readonly code = "") {
    super("VALIDATION_FAILED");
  }
}

export function validationResponseError(result: unknown, httpStatus: number): ValidationResponseError {
  const body = typeof result === "object" && result !== null ? result : null;
  const status = body && "status" in body && (body.status === "FAIL" || body.status === "UNAVAILABLE")
    ? body.status : httpStatus >= 500 ? "UNAVAILABLE" : "FAIL";
  const code = body && "code" in body && typeof body.code === "string" ? body.code : "";
  return new ValidationResponseError(status, code);
}

export function isWalletRejection(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);
    if (("code" in error && (error.code === 4001 || error.code === "4001"))
      || ("name" in error && error.name === "UserRejectedRequestError")) return true;
    error = "cause" in error ? error.cause : null;
  }
  return error === "WALLET_REJECTED";
}

export function errorCode(error: unknown): string | undefined {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message.match(/(WALLET_[A-Z_]+|CHAIN_[A-Z_]+|DEMAND_[A-Z_]+|SUPPORT_[A-Z_]+|SUBMISSION_[A-Z_]+|VALIDATION_[A-Z_]+|DEPLOYMENT_[A-Z_]+|TRANSACTION_[A-Z_]+)/)?.[1];
}

export function errorMessage(error: unknown): string {
  if (isWalletRejection(error)) return "WALLET_REJECTED";
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
  const known = errorCode(message);
  if (known === "DEMAND_INVALID_CAPABILITY") return "Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max)";
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
