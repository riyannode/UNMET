import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { decodeEventLog, type Address, type PublicClient } from "viem";
import { AGENT_DEMAND_ABI } from "./contract.ts";
import { ActivityStore, type ActivityAnchor, type ActivityEvent, type ActivityReason } from "./activity-store.ts";

type Limits = { indexMaxLogWindows: number; indexBudgetMs: number; indexMaxDemands: number };
type Client = Pick<PublicClient, "getBlock" | "getLogs" | "readContract" | "getChainId">;

function normalized(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("ACTIVITY_INVALID_LOG");
    return String(value);
  }
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  return value;
}

function anchor(block: Awaited<ReturnType<Client["getBlock"]>>): ActivityAnchor {
  if (block.number === null || !block.hash || block.timestamp < 0n) throw new Error("ACTIVITY_INVALID_LOG");
  return { blockNumber: block.number.toString(), blockHash: block.hash.toLowerCase(), timestamp: block.timestamp.toString() };
}

function sameAnchor(a: ActivityAnchor, b: ActivityAnchor) {
  return a.blockNumber === b.blockNumber && a.blockHash === b.blockHash && a.timestamp === b.timestamp;
}

async function pinned(client: Client, expected: ActivityAnchor) {
  const block = await client.getBlock({ blockNumber: BigInt(expected.blockNumber) });
  return sameAnchor(anchor(block), expected);
}

function setFailure(store: ActivityStore, reason: ActivityReason) {
  const state = store.state();
  store.updateState(state.nextBlock, (current) => ({ ...current, coverageStatus: current.cutoff ? "partial" : "unavailable",
    coverageReason: reason, lastValidatedAt: null }));
}

// This guard is shared by paid analysis and restart validation; a mismatch is
// recorded immediately so no subsequent reader can treat the old prefix as trusted.
export async function validateActivityCheckpoint(store: ActivityStore, client: Client): Promise<boolean> {
  const state = store.state();
  if (!state.cutoff || state.coverageStatus !== "complete" || state.reorgState !== "clear") return false;
  try {
    if (String(await client.getChainId()) !== state.chainId) throw new Error("ACTIVITY_CHAIN_MISMATCH");
    const canonical = await pinned(client, state.cutoff);
    const current = store.state();
    if (current.nextBlock !== state.nextBlock || !current.cutoff || !sameAnchor(current.cutoff, state.cutoff) ||
        current.coverageStatus !== "complete" || current.reorgState !== "clear") return false;
    if (canonical) return true;
    store.updateState(state.nextBlock, (current) => ({ ...current, coverageStatus: "unavailable",
      coverageReason: "REORG_REBUILD", lastValidatedAt: null, reorgState: "detected", lastDetectedAt: new Date().toISOString() }));
  } catch {
    setFailure(store, "RPC_UNAVAILABLE");
  }
  return false;
}

export async function refreshActivity(store: ActivityStore, client: Client, contract: Address, limits: Limits, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + limits.indexBudgetMs;
  const check = () => {
    if (signal?.aborted || Date.now() >= deadline) throw new Error("ACTIVITY_BUDGET");
  };
  try {
    let state = store.state();
    if (state.contract !== contract.toLowerCase()) throw new Error("ACTIVITY_DEPLOYMENT_MISMATCH");
    if (String(await client.getChainId()) !== state.chainId) throw new Error("ACTIVITY_CHAIN_MISMATCH");
    if (state.reorgState === "detected") {
      store.resetForReorg(state.lastDetectedAt || new Date().toISOString());
      state = store.state();
    }
    check();
    const head = anchor(await client.getBlock());
    check();
    if (BigInt(head.blockNumber) < BigInt(state.deployBlock)) throw new Error("ACTIVITY_RPC");
    if (!state.startAnchor) {
      const start = anchor(await client.getBlock({ blockNumber: BigInt(state.deployBlock) }));
      if (start.blockNumber !== state.deployBlock) throw new Error("ACTIVITY_RPC");
      state = store.updateState(state.nextBlock, (current) => ({ ...current, startAnchor: start }));
    } else if (!await pinned(client, state.startAnchor)) {
      store.resetForReorg(new Date().toISOString());
      return;
    }
    if ((state.cutoff && (BigInt(head.blockNumber) < BigInt(state.cutoff.blockNumber) || !await pinned(client, state.cutoff))) ||
        (state.target && (BigInt(head.blockNumber) < BigInt(state.target.blockNumber) || !await pinned(client, state.target)))) {
      store.resetForReorg(new Date().toISOString());
      return;
    }
    if (state.coverageStatus === "complete" && state.target && BigInt(head.blockNumber) > BigInt(state.target.blockNumber)) {
      state = store.updateState(state.nextBlock, (current) => ({ ...current, target: head,
        coverageStatus: "partial", coverageReason: "BACKFILL_INCOMPLETE", lastValidatedAt: null }));
    }
    if (!state.target) {
      if (BigInt(head.blockNumber) < BigInt(state.deployBlock)) throw new Error("ACTIVITY_RPC");
      state = store.updateState(state.nextBlock, (current) => ({ ...current, target: head,
        coverageStatus: current.cutoff ? "partial" : "unavailable",
        coverageReason: current.reorgState === "rebuilding" ? "REORG_REBUILD" : "BACKFILL_INCOMPLETE" }));
    }
    const target = state.target!;
    let windows = 0;
    while (BigInt(state.nextBlock) <= BigInt(target.blockNumber) && windows < limits.indexMaxLogWindows) {
      check();
      if (state.cutoff && !await pinned(client, state.cutoff)) throw new Error("ACTIVITY_REORG");
      const start = BigInt(state.nextBlock);
      const end = start + 99n < BigInt(target.blockNumber) ? start + 99n : BigInt(target.blockNumber);
      const before = anchor(await client.getBlock({ blockNumber: end }));
      if (BigInt(before.blockNumber) !== end) throw new Error("ACTIVITY_RPC");
      check();
      const logs = await client.getLogs({ address: contract, fromBlock: start, toBlock: end });
      if (logs.length > limits.indexMaxDemands * 10) throw new Error("ACTIVITY_CAPACITY");
      const headers = new Map<string, Awaited<ReturnType<Client["getBlock"]>>>();
      const events: ActivityEvent[] = [];
      for (const log of logs) {
        check();
        if (log.removed || log.address.toLowerCase() !== state.contract || log.blockNumber === null || log.blockHash === null ||
            log.transactionHash === null || log.logIndex === null || log.transactionIndex === null ||
            log.blockNumber < start || log.blockNumber > end || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 ||
            !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0) throw new Error("ACTIVITY_INVALID_LOG");
        const key = log.blockNumber.toString();
        let block = headers.get(key);
        if (!block) {
          block = await client.getBlock({ blockNumber: log.blockNumber });
          headers.set(key, block);
        }
        const transaction = block.transactions[log.transactionIndex];
        if (block.number !== log.blockNumber || block.timestamp < 0n || !block.hash || block.hash.toLowerCase() !== log.blockHash.toLowerCase() ||
            typeof transaction !== "string" || transaction.toLowerCase() !== log.transactionHash.toLowerCase()) throw new Error("ACTIVITY_REORG");
        let decoded;
        try { decoded = decodeEventLog({ abi: AGENT_DEMAND_ABI, topics: log.topics, data: log.data, strict: true }); }
        catch { throw new Error("ACTIVITY_INVALID_LOG"); }
        const args = normalized(decoded.args ?? {});
        const payload = canonicalize(args);
        if (!payload || Buffer.byteLength(payload, "utf8") > 8192) throw new Error("ACTIVITY_CAPACITY");
        const demandId = typeof args === "object" && args !== null && "demandId" in args ? args.demandId : null;
        if (demandId !== null && typeof demandId !== "string") throw new Error("ACTIVITY_INVALID_LOG");
        events.push({ chainId: state.chainId, contract: state.contract, transactionHash: log.transactionHash.toLowerCase(),
          logIndex: String(log.logIndex), blockNumber: key, blockHash: log.blockHash.toLowerCase(),
          transactionIndex: String(log.transactionIndex), blockTimestamp: block.timestamp.toString(), eventName: decoded.eventName,
          demandId, payload, payloadHash: createHash("sha256").update(payload).digest("hex") });
      }
      check();
      const after = anchor(await client.getBlock({ blockNumber: end }));
      if (!sameAnchor(before, after) || (state.cutoff && !await pinned(client, state.cutoff)) ||
          (end === BigInt(target.blockNumber) && !sameAnchor(after, target))) throw new Error("ACTIVITY_REORG");
      check();
      state = store.commitPage(state.nextBlock, after, events);
      windows++;
    }
    if (BigInt(state.nextBlock) <= BigInt(target.blockNumber)) return;
    check();
    const nextDemandId = await client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "nextDemandId", blockNumber: BigInt(target.blockNumber) });
    const created = store.events().filter((event) => event.eventName === "DemandCreated").map((event) => event.demandId);
    if (nextDemandId < 1n || nextDemandId - 1n > BigInt(limits.indexMaxDemands) ||
        BigInt(created.length) !== nextDemandId - 1n || new Set(created).size !== created.length ||
        created.some((id) => id === null || BigInt(id) < 1n || BigInt(id) >= nextDemandId)) {
      setFailure(store, "COVERAGE_MISMATCH");
      return;
    }
    if (!state.startAnchor || !await pinned(client, state.startAnchor) || !await pinned(client, target)) throw new Error("ACTIVITY_REORG");
    check();
    store.updateState(state.nextBlock, (current) => {
      if (current.reorgState === "detected" || !current.target || !sameAnchor(current.target, target)) throw new Error("ACTIVITY_REORG");
      return { ...current, coverageStatus: "complete", coverageReason: null, lastValidatedAt: new Date().toISOString(), reorgState: "clear" };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ACTIVITY_DEPLOYMENT_MISMATCH") throw error;
    if (code === "ACTIVITY_REORG" || code === "ACTIVITY_EVENT_CONFLICT") {
      store.resetForReorg(new Date().toISOString());
      return;
    }
    const reason: ActivityReason = code === "ACTIVITY_CAPACITY" ? "CAPACITY"
      : code === "ACTIVITY_INVALID_LOG" ? "INVALID_LOG"
      : code === "ACTIVITY_BUDGET" ? "BACKFILL_INCOMPLETE" : "RPC_UNAVAILABLE";
    setFailure(store, reason);
  }
}

export function startActivityScheduler(store: ActivityStore, client: (signal: AbortSignal) => Client, contract: Address, limits: Limits, pollMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let failure: unknown;
  const schedule = () => {
    if (controller.signal.aborted) return;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.indexBudgetMs)]);
    running = Promise.resolve().then(() => refreshActivity(store, client(signal), contract, limits, signal)).catch((error: unknown) => {
      failure = error;
      console.error(JSON.stringify({ level: "error", event: "activity_worker_failed", code: "ACTIVITY_STORAGE_UNAVAILABLE" }));
    }).finally(() => {
      if (!controller.signal.aborted && !failure) timer = setTimeout(schedule, pollMs);
    });
  };
  schedule();
  return async () => { controller.abort(); if (timer) clearTimeout(timer); await running; if (failure) throw failure; };
}
