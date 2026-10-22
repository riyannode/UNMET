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
  const known = message.match(/(WALLET_[A-Z_]+|CHAIN_[A-Z_]+|DEMAND_[A-Z_]+|SUPPORT_[A-Z_]+|SUBMISSION_[A-Z_]+)/)?.[1];
  if (known === "DEMAND_INVALID_CAPABILITY") return "Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max).";
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
