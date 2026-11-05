import { expect, test } from "bun:test";
import { buildInsights } from "./insights.ts";
import Ajv2020 from "ajv/dist/2020.js";
import openapi from "../frontend/public/openapi.json";
import type { IndexEntry } from "./server.ts";
import type { ActivityEvent, ActivityState } from "./activity-store.ts";

const address = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "a".repeat(64);
const anchor = (blockNumber: string, timestamp: string) => ({ blockNumber, blockHash: hash, timestamp });
const state: ActivityState = { chainId: "1952", contract: address, escrowToken: address, tokenDecimals: 6, deployBlock: "1", nextBlock: "11",
  startAnchor: anchor("1", "1000"), cutoff: anchor("10", "100000"), target: anchor("10", "100000"), coverageStatus: "complete", coverageReason: null,
  lastValidatedAt: "2026-01-01T00:00:00.000Z", reorgState: "clear", lastDetectedAt: null };
function entry(id: number, capability: string, status: number, committed: bigint): IndexEntry {
  return { demandId: BigInt(id), data: { creator: address, builder: address, maxUnitPrice: 1n, committed, reviewCommitted: 0n,
    approvalRequired: 0n, expectedCalls: 7n, deadline: 0n, reviewEndsAt: 0n, supporterCount: 2, status, capability,
    specification: "", serviceUrl: "", evidenceHash: "0x" }, approvalWeight: 0n, approvalRequired: 0n,
    quorumReached: false, rejectionWeight: 0n, rejectionThreshold: 0n, candidateRejected: false };
}
function event(name: string, id: string, time: string, args: Record<string, string>, index: number): ActivityEvent {
  return { chainId: "1952", contract: address, transactionHash: hash, logIndex: String(index), blockNumber: String(index + 1),
    blockHash: hash, transactionIndex: "0", blockTimestamp: time, eventName: name, demandId: id, payload: JSON.stringify(args), payloadHash: "" };
}
const events = [
  event("DemandCreated", "1", "2000", { demandKey: "same", initialCommitment: "100" }, 0),
  event("DemandSupported", "1", "2000", { supporter: address, amount: "100" }, 1),
  event("DemandCreated", "2", "20000", { demandKey: "same", initialCommitment: "50" }, 2),
  event("DemandSupported", "2", "20000", { supporter: address, amount: "50" }, 3),
  event("DemandSupported", "1", "30000", { supporter: address, amount: "25" }, 4),
  event("ServiceSubmitted", "1", "40000", { submissionNonce: "1" }, 5),
  event("SubmissionRejected", "1", "50000", { submissionNonce: "1" }, 6),
  event("DemandFulfilled", "1", "60000", {}, 7),
];

test("OpenAPI describes available and unavailable activity additions", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const market = ajv.compile({ ...openapi.components.schemas.MarketActivity, components: openapi.components });
  const usage = ajv.compile(openapi.components.schemas.UsageEvidence);
  for (const trusted of [true, false]) {
    const result = buildInsights([entry(1, "alpha", 0, 1n)], null, state, events, trusted);
    expect(market(result.marketActivity)).toBe(true);
    expect(usage(result.usageEvidence)).toBe(true);
  }
});

test("snapshot uses all raw statuses and exact capability populations", () => {
  const rows = [entry(1, "alpha", 0, 10n), entry(2, "beta", 2, 0n), entry(3, "alpha", 4, 5n)];
  const views = new Map([["2", { metadataState: "valid" as const, state: "compatible" as const, offers: [] }]]);
  const { marketActivity, usageEvidence } = buildInsights(rows, views, state, events, true);
  expect(marketActivity.snapshot).toMatchObject({ demandCount: "3", fundedDemandCount: "2", currentEscrowAtomic: "15",
    expectedCallsHistorical: "21", supporterParticipationsHistorical: "6", canonicalServiceCount: "1",
    rawStatusCounts: { OPEN: "1", SUBMITTED: "0", FULFILLED: "1", CLOSED: "0", CANCELLED: "1" },
    conversion: { fulfilledDemandCount: "1", totalDemandCount: "3" },
    discovery: { validMetadataServiceCount: "1", metadataStates: { valid: "1" }, observationStates: { compatible: "1" } } });
  expect(marketActivity.byCapability[0]).toMatchObject({ capability: "alpha", snapshot: { demandCount: "2", conversion: { totalDemandCount: "2" } } });
  expect(usageEvidence).toMatchObject({ status: "unsupported", coverage: { reason: "NO_SUPPORTED_USAGE_PRODUCER" },
    levels: { declared: { status: "unsupported" }, paymentObserved: { status: "unsupported" }, executionAttested: { status: "unsupported" }, independentlyVerified: { status: "unsupported" } } });
});

test("history counts support once, exact-key repeats, reopens and paired duration", () => {
  const history = buildInsights([], null, state, events, true).marketActivity.history;
  expect(history.wholeHistory).toEqual({ status: "available", reason: null, createdDemandCount: "2", grossSupportInflowAtomic: "175",
    submissionCount: "1", reopenCount: "1", repeatDemandCreations: "1", fulfillmentCount: "1",
    fulfillmentDuration: { count: "1", totalSeconds: "58000" } });
  expect(history.trailing24h).toEqual({ status: "available", reason: null, windowSeconds: 86400, fromExclusiveTimestamp: "13600",
    toInclusiveTimestamp: "100000", grossSupportInflowAtomic: "75", newDemandSupporterPairs: "1" });
});

test("partial, untrusted and reorg history are null; incomplete fulfillment pairs are unavailable", () => {
  const partial: ActivityState = { ...state, coverageStatus: "partial", coverageReason: "BACKFILL_INCOMPLETE" };
  for (const [value, trusted] of [[partial, true], [state, false], [{ ...state, reorgState: "detected" }, true]] as const) {
    const result = buildInsights([], null, value, events, trusted).marketActivity.history;
    expect(result.wholeHistory.status).toBe("unavailable");
    expect(result.wholeHistory.grossSupportInflowAtomic).toBeNull();
    expect(result.trailing24h.newDemandSupporterPairs).toBeNull();
  }
  expect(buildInsights([], null, state, [event("DemandFulfilled", "3", "50000", {}, 0)], true).marketActivity.history.wholeHistory.reason).toBe("COVERAGE_MISMATCH");
});

test("empty complete history gives zero only when deployment covers the full 24 hours", () => {
  const complete = buildInsights([], null, state, [], true).marketActivity.history;
  expect(complete.wholeHistory.createdDemandCount).toBe("0");
  expect(complete.trailing24h.grossSupportInflowAtomic).toBe("0");
  const recent = buildInsights([], null, { ...state, startAnchor: anchor("1", "20000") }, [], true).marketActivity.history;
  expect(recent.trailing24h).toMatchObject({ status: "unavailable", reason: "WINDOW_NOT_COVERED", grossSupportInflowAtomic: null });
});

test("capability groups are sorted by exact escrow and code-unit ties before truncation", () => {
  const entries = Array.from({ length: 51 }, (_, i) => entry(i + 1, String(i).padStart(2, "0"), 0, 1n));
  const result = buildInsights(entries.reverse(), null, state, [], true).marketActivity;
  expect(result.scope).toMatchObject({ totalCapabilityGroups: "51", truncated: true });
  expect(result.byCapability).toHaveLength(50);
  expect(result.byCapability[0]?.capability).toBe("00");
  expect(result.byCapability[49]?.capability).toBe("49");
  expect(result.snapshot.demandCount).toBe("51");
  expect(result.snapshot.discovery).toMatchObject({ status: "unavailable", metadataStates: null, observationStates: null });
});

test("large atomic amounts and the exclusive/inclusive 24-hour boundaries stay exact", () => {
  const huge = "900719925474099312345";
  const rows = [entry(1, "x", 0, BigInt(huge)), entry(2, "x", 0, 1n)];
  const boundary = [
    event("DemandSupported", "1", "13600", { supporter: address, amount: huge }, 0),
    event("DemandSupported", "2", "100000", { supporter: address, amount: huge }, 1),
  ];
  const activity = buildInsights(rows, null, state, boundary, true).marketActivity;
  expect(activity.snapshot.currentEscrowAtomic).toBe("900719925474099312346");
  expect(activity.history.wholeHistory.grossSupportInflowAtomic).toBe("1801439850948198624690");
  expect(activity.history.trailing24h).toMatchObject({ grossSupportInflowAtomic: huge, newDemandSupporterPairs: "1" });
});

test("malformed historical payload makes metrics unavailable", () => {
  const bad = { ...event("DemandSupported", "1", "2000", {}, 0), payload: "{" };
  const history = buildInsights([], null, state, [bad], true).marketActivity.history;
  expect(history.wholeHistory).toMatchObject({ status: "unavailable", reason: "COVERAGE_MISMATCH", grossSupportInflowAtomic: null });
});
