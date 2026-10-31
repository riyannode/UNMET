import { effectiveStatus, type DemandView } from "./contract";

const STATUS_ORDER = ["OPEN", "SUBMITTED", "READY", "EXPIRED", "REJECTED", "FULFILLED", "CLOSED", "CANCELLED", "UNKNOWN"];

type AnalyticsStatusCount = { status: string; count: number };

type GlobalAnalytics = {
  totalRequests: number;
  fulfilledRequests: number;
  escrowLocked: bigint;
  statusCounts: AnalyticsStatusCount[];
  escrowByRequest: DemandView[];
  recentlyFulfilled: DemandView[];
};

export function deriveGlobalAnalytics(board: readonly DemandView[], now: bigint): GlobalAnalytics {
  const distinctRequests = new Map<string, DemandView>();
  for (const demand of board) distinctRequests.set(demand.demandId.toString(), demand);
  const demands = [...distinctRequests.values()];
  const counts = new Map<string, number>();

  for (const demand of demands) {
    const status = effectiveStatus(demand, now);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const byNewestId = (a: DemandView, b: DemandView) =>
    a.demandId > b.demandId ? -1 : a.demandId < b.demandId ? 1 : 0;

  return {
    totalRequests: demands.length,
    fulfilledRequests: counts.get("FULFILLED") ?? 0,
    escrowLocked: demands.reduce((total, demand) => total + demand.committed, 0n),
    statusCounts: STATUS_ORDER.flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [{ status, count }] : [];
    }),
    escrowByRequest: demands
      .filter((demand) => demand.committed > 0n)
      .sort((a, b) => a.committed > b.committed ? -1 : a.committed < b.committed ? 1 : byNewestId(a, b))
      .slice(0, 6),
    recentlyFulfilled: demands
      .filter((demand) => effectiveStatus(demand, now) === "FULFILLED")
      .sort(byNewestId)
      .slice(0, 5),
  };
}
