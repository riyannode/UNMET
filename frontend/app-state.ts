export type SupportReadResult<T> =
  | { kind: "ready"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export async function readSupportForIdentity<T>(
  identity: string,
  read: () => Promise<T>,
  isCurrent: (identity: string) => boolean,
): Promise<SupportReadResult<T>> {
  try {
    const value = await read();
    return isCurrent(identity) ? { kind: "ready", value } : { kind: "stale" };
  } catch (error) {
    return isCurrent(identity) ? { kind: "error", error } : { kind: "stale" };
  }
}

export function settleBoardRead<T extends { boardError: string }>(
  state: T,
  outcome: { kind: "success" } | { kind: "error"; message: string },
): T {
  return { ...state, boardError: outcome.kind === "success" ? "" : outcome.message };
}

export function settleSupportRead<T extends { supportError: string }>(
  state: T,
  outcome: { kind: "loading" | "success" } | { kind: "error"; message: string },
): T {
  return { ...state, supportError: outcome.kind === "error" ? outcome.message : "" };
}

export async function afterConfirmedTransaction<T, S>(
  action: () => Promise<T>,
  onConfirmed: (result: T) => void,
  refreshBoard: () => Promise<boolean>,
  refreshSupport: () => Promise<S | null>,
): Promise<{ boardReadbackSucceeded: boolean; supportReadback: S | null }> {
  const receipt = await action();
  onConfirmed(receipt);
  const [boardReadbackSucceeded, supportReadback] = await Promise.all([refreshBoard(), refreshSupport()]);
  return { boardReadbackSucceeded, supportReadback };
}
