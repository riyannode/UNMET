export type ReownStatus = "initializing" | "ready" | "unavailable";

export function resolveReownStatus(
  configured: boolean,
  moduleLoaded: boolean,
  appKitAvailable: boolean,
): ReownStatus {
  if (!configured) return "unavailable";
  if (!moduleLoaded) return "initializing";
  return appKitAvailable ? "ready" : "unavailable";
}

export function reownButtonLabel(status: ReownStatus, accountLabel?: string): string {
  if (status === "initializing") return "Initializing Reown…";
  if (status === "unavailable") return "Reown Unavailable";
  return accountLabel ?? "Connect wallet";
}
