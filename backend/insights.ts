import type { DiscoveryView } from "../shared/discovery-types.ts";
import type { ActivityEvent, ActivityReason, ActivityState } from "./activity-store.ts";
import type { IndexEntry } from "./server.ts";

const usageEvidence = {
  status: "unsupported",
  coverage: { status: "unavailable", reason: "NO_SUPPORTED_USAGE_PRODUCER" },
  levels: {
    declared: { status: "unsupported", reason: "NO_DECLARED_USAGE_PRODUCER" },
    paymentObserved: { status: "unsupported", reason: "NO_DETERMINISTIC_SERVICE_PAYMENT_PRODUCER" },
    executionAttested: { status: "unsupported", reason: "NO_EXECUTION_ATTESTATION_PRODUCER" },
    independentlyVerified: { status: "unsupported", reason: "NO_INDEPENDENT_VERIFICATION_PRODUCER" },
  },
} as const;

function snapshot(entries: IndexEntry[], discovery: Map<string, DiscoveryView> | null) {
  const statuses = ["OPEN", "SUBMITTED", "FULFILLED", "CLOSED", "CANCELLED"] as const;
  const rawStatusCounts = { OPEN: 0n, SUBMITTED: 0n, FULFILLED: 0n, CLOSED: 0n, CANCELLED: 0n };
  const metadata = { missing: 0n, valid: 0n, invalid: 0n };
  const observations = { pending: 0n, metadata_invalid: 0n, compatible: 0n, incompatible: 0n, unavailable: 0n, stale: 0n };
  let funded = 0n, escrow = 0n, calls = 0n, supporters = 0n;
  for (const entry of entries) {
    const status = statuses[entry.data.status];
    if (!status) throw new Error("INSIGHTS_INVALID_STATUS");
    rawStatusCounts[status]++;
    if (entry.data.committed > 0n) funded++;
    escrow += entry.data.committed;
    calls += entry.data.expectedCalls;
    supporters += BigInt(entry.data.supporterCount);
    if (status === "FULFILLED" && discovery) {
      const view = discovery.get(entry.demandId.toString());
      if (!view || !(view.metadataState in metadata) || !(view.state in observations)) throw new Error("DISCOVERY_UNAVAILABLE");
      metadata[view.metadataState]++;
      observations[view.state]++;
    }
  }
  const stringify = <T extends Record<string, bigint>>(record: T) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.toString()])) as { [K in keyof T]: string };
  const count = String(entries.length), fulfilled = rawStatusCounts.FULFILLED.toString();
  return {
    demandCount: count, fundedDemandCount: funded.toString(), rawStatusCounts: stringify(rawStatusCounts),
    currentEscrowAtomic: escrow.toString(), expectedCallsHistorical: calls.toString(), supporterParticipationsHistorical: supporters.toString(),
    canonicalServiceCount: fulfilled,
    discovery: discovery ? { status: "available" as const, reason: null, validMetadataServiceCount: metadata.valid.toString(),
      metadataStates: stringify(metadata), observationStates: stringify(observations) }
      : { status: "unavailable" as const, reason: "DISCOVERY_UNAVAILABLE" as const, validMetadataServiceCount: null, metadataStates: null, observationStates: null },
    conversion: { fulfilledDemandCount: fulfilled, totalDemandCount: count },
  };
}

function unavailableHistory(reason: ActivityReason, cutoff: ActivityState["cutoff"]) {
  const to = cutoff ? BigInt(cutoff.timestamp) : null;
  return {
    wholeHistory: { status: "unavailable" as const, reason, createdDemandCount: null, grossSupportInflowAtomic: null,
      submissionCount: null, reopenCount: null, repeatDemandCreations: null, fulfillmentCount: null, fulfillmentDuration: null },
    trailing24h: { status: "unavailable" as const, reason, windowSeconds: 86400 as const,
      fromExclusiveTimestamp: to !== null && to >= 86400n ? (to - 86400n).toString() : null,
      toInclusiveTimestamp: to?.toString() ?? null, grossSupportInflowAtomic: null, newDemandSupporterPairs: null },
  };
}

function history(state: ActivityState, events: ActivityEvent[], trusted: boolean) {
  const coverage = { status: state.coverageStatus, reason: state.coverageReason, fromBlock: state.deployBlock,
    nextBlock: state.nextBlock, cutoff: state.cutoff, target: state.target, lastValidatedAt: state.lastValidatedAt };
  const reorg = { state: state.reorgState, lastDetectedAt: state.lastDetectedAt };
  if (!trusted || state.coverageStatus !== "complete" || state.reorgState !== "clear" || !state.cutoff || !state.startAnchor) {
    return { coverage, reorg, ...unavailableHistory(state.coverageReason ?? "UNVERIFIED_CHECKPOINT", state.cutoff) };
  }
  const created = new Map<string, bigint>(), keys = new Set<string>(), submissions = new Set<string>(), reopens = new Set<string>(), fulfilled = new Set<string>(), pairs = new Set<string>();
  let repeats = 0n, gross = 0n, windowGross = 0n, newPairs = 0n, duration = 0n;
  const to = BigInt(state.cutoff.timestamp), from = to - 86400n;
  let invalid = false;
  for (const event of events) {
    let parsed: unknown;
    try { parsed = JSON.parse(event.payload); } catch { invalid = true; break; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { invalid = true; break; }
    const args = new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const id = event.demandId, time = BigInt(event.blockTimestamp);
    if (time > to) { invalid = true; break; }
    if (event.eventName === "DemandCreated") {
      const key = args.get("demandKey");
      if (!id || !key || created.has(id)) { invalid = true; break; }
      created.set(id, time);
      if (keys.has(key)) repeats++; else keys.add(key);
    } else if (event.eventName === "DemandSupported") {
      const supporter = args.get("supporter"), amountText = args.get("amount");
      if (!id || !supporter || !amountText || !/^(0|[1-9][0-9]*)$/.test(amountText)) { invalid = true; break; }
      const amount = BigInt(amountText);
      gross += amount;
      if (time > from) windowGross += amount;
      const pair = id + ":" + supporter;
      if (!pairs.has(pair) && time > from) newPairs++;
      pairs.add(pair);
    } else if (event.eventName === "ServiceSubmitted" || event.eventName === "SubmissionRejected") {
      const nonce = args.get("submissionNonce");
      if (!id || !nonce || !/^(0|[1-9][0-9]*)$/.test(nonce)) { invalid = true; break; }
      const key = id + ":" + nonce;
      const set = event.eventName === "ServiceSubmitted" ? submissions : reopens;
      if (set.has(key)) { invalid = true; break; }
      set.add(key);
    } else if (event.eventName === "DemandFulfilled") {
      const first = id ? created.get(id) : undefined;
      if (!id || first === undefined || fulfilled.has(id) || time < first) { invalid = true; break; }
      fulfilled.add(id);
      duration += time - first;
    }
  }
  if (invalid) return { coverage, reorg, ...unavailableHistory("COVERAGE_MISMATCH", state.cutoff) };
  const wholeHistory = { status: "available" as const, reason: null, createdDemandCount: String(created.size),
    grossSupportInflowAtomic: gross.toString(), submissionCount: String(submissions.size), reopenCount: String(reopens.size),
    repeatDemandCreations: repeats.toString(), fulfillmentCount: String(fulfilled.size),
    fulfillmentDuration: { count: String(fulfilled.size), totalSeconds: duration.toString() } };
  const windowCovered = from >= 0n && BigInt(state.startAnchor.timestamp) <= from;
  const trailing24h = windowCovered ? { status: "available" as const, reason: null, windowSeconds: 86400 as const,
    fromExclusiveTimestamp: from.toString(), toInclusiveTimestamp: to.toString(),
    grossSupportInflowAtomic: windowGross.toString(), newDemandSupporterPairs: newPairs.toString() }
    : { status: "unavailable" as const, reason: "WINDOW_NOT_COVERED" as const, windowSeconds: 86400 as const,
      fromExclusiveTimestamp: from >= 0n ? from.toString() : null, toInclusiveTimestamp: to.toString(),
      grossSupportInflowAtomic: null, newDemandSupporterPairs: null };
  return { coverage, reorg, wholeHistory, trailing24h };
}

export function buildInsights(entries: IndexEntry[], discovery: Map<string, DiscoveryView> | null, state: ActivityState, events: ActivityEvent[], trusted: boolean) {
  const groups = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.data.capability) ?? [];
    group.push(entry);
    groups.set(entry.data.capability, group);
  }
  const rows = [...groups].map(([capability, values]) => ({ capability, snapshot: snapshot(values, discovery) }));
  rows.sort((a, b) => {
    const left = BigInt(a.snapshot.currentEscrowAtomic), right = BigInt(b.snapshot.currentEscrowAtomic);
    return left === right ? (a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0) : left > right ? -1 : 1;
  });
  return { marketActivity: { schemaVersion: "unmet-g4-market-v1" as const,
    scope: { population: "all_indexed_demands" as const, capabilityGrouping: "exact_onchain_string" as const,
      capabilityGroupLimit: 50 as const, totalCapabilityGroups: String(rows.length), truncated: rows.length > 50 },
    snapshot: snapshot(entries, discovery), byCapability: rows.slice(0, 50), history: history(state, events, trusted) }, usageEvidence };
}
