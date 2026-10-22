export type SupportReadResult<T> =
  | { kind: "ready"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export type MarketSort = "most-funded" | "least-funded" | "latest-id" | "earliest-id";

type MarketRequest = {
  demandId: bigint;
  committed: bigint;
  capability: string;
};

export function deriveMarketRequests<T extends MarketRequest>(
  board: readonly T[],
  filters: { search: string; status: string; sort: MarketSort },
  getStatus: (demand: T) => string,
): { requests: T[]; statusCounts: ReadonlyMap<string, number> } {
  const statusById = new Map<string, string>();
  const statusCounts = new Map<string, number>();

  for (const demand of board) {
    const id = demand.demandId.toString();
    const status = getStatus(demand);
    statusById.set(id, status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const normalizedSearch = filters.search.trim().toLowerCase();
  const requestedId = normalizedSearch.startsWith("#")
    ? normalizedSearch.slice(1)
    : normalizedSearch;
  const requests = board.filter((demand) => {
    const matchesStatus = filters.status === "ALL"
      || statusById.get(demand.demandId.toString()) === filters.status;
    const matchesSearch = normalizedSearch === ""
      || demand.capability.toLowerCase().includes(normalizedSearch)
      || demand.demandId.toString() === requestedId;
    return matchesStatus && matchesSearch;
  });

  requests.sort((a, b) => {
    const fundingOrder = a.committed > b.committed ? -1 : a.committed < b.committed ? 1 : 0;
    const idOrder = a.demandId > b.demandId ? -1 : a.demandId < b.demandId ? 1 : 0;

    if (filters.sort === "most-funded") return fundingOrder || idOrder;
    if (filters.sort === "least-funded") return -fundingOrder || idOrder;
    return filters.sort === "latest-id" ? idOrder : -idOrder;
  });

  return { requests, statusCounts };
}

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
