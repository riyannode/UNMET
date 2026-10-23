export type ReownStatus = "initializing" | "ready" | "unavailable";

export const WALLET_REQUIRED_TOAST_ID = "create-demand-wallet-required";

export async function runDisconnectRequest(
  lock: { current: boolean },
  onStart: () => void,
  request: () => Promise<void>,
  onFinish: () => void,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    onStart();
    await request();
    return true;
  } finally {
    try {
      onFinish();
    } finally {
      lock.current = false;
    }
  }
}

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
