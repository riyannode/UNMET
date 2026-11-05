import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address, type Hex, type PublicClient } from "viem";
import { AGENT_DEMAND_ABI, withRpcAbort } from "./contract.ts";
import { ActivityStore } from "./activity-store.ts";
import { refreshActivity, startActivityScheduler, validateActivityCheckpoint } from "./activity-index.ts";

const contract = ("0x" + "1".repeat(40)) as Address;
const deployment = { chainId: "1952", contract, escrowToken: "0x" + "2".repeat(40), tokenDecimals: 6, deployBlock: "10" };
const tx = ("0x" + "b".repeat(64)) as Hex;
const hash = (number: bigint) => ("0x" + number.toString(16).padStart(64, "0")) as Hex;
const limits = { indexMaxLogWindows: 1, indexBudgetMs: 10_000, indexMaxDemands: 10 };
function created(id: bigint, block = 10n) {
  return { address: contract, blockNumber: block, blockHash: hash(block), transactionHash: tx, transactionIndex: 0, logIndex: Number(id),
    removed: false, topics: encodeEventTopics({ abi: AGENT_DEMAND_ABI, eventName: "DemandCreated", args: {
      demandId: id, demandKey: ("0x" + "3".repeat(64)) as Hex, creator: ("0x" + "4".repeat(40)) as Address } }),
    data: encodeAbiParameters(parseAbiParameters("string, uint96, uint64, uint64, uint96"), ["test", 1n, 2n, 3n, 4n]) };
}
function fixture(run: (store: ActivityStore, rpc: ReturnType<typeof mock>) => Promise<void>, max = 100) {
  return (async () => {
    const dir = mkdtempSync(tmpdir() + "/unmet-activity-index-"), store = new ActivityStore(dir + "/activity.sqlite", deployment, max);
    const rpc = mock();
    try { await run(store, rpc); } finally { store.close(); rmSync(dir, { recursive: true }); }
  })();
}
function mock() {
  let head = 10n, nextId = 1n, chainId = 1952, logs: ReturnType<typeof created>[] = [], changed = false, endReads = 0, fail = false;
  const calls: Array<[bigint, bigint]> = [];
  const client = {
    getChainId: async () => chainId,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
      if (fail) throw new Error("offline");
      const n = blockNumber ?? head;
      if (n === head) endReads++;
      return { number: n, hash: changed && n === head && endReads > 1 ? hash(n + 1000n) : hash(n), timestamp: 1000n + n, transactions: [tx] };
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push([fromBlock, toBlock]); return logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    },
    readContract: async () => nextId,
  } as unknown as PublicClient;
  return { client, calls, setHead: (v: bigint) => { head = v; endReads = 0; }, setLogs: (v: typeof logs) => { logs = v; },
    setNextId: (v: bigint) => { nextId = v; }, setChainId: (v: number) => { chainId = v; }, setChanged: (v: boolean) => { changed = v; endReads = 0; }, setOffline: (v: boolean) => { fail = v; } };
}

test("multi-page scan freezes target, resumes empty ranges and deduplicates exact ABI logs", async () => {
  await fixture(async (store, rpc) => {
    rpc.setHead(210n); rpc.setLogs([created(1n), created(1n)]); rpc.setNextId(2n);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "110", target: { blockNumber: "210" }, coverageStatus: "partial" });
    rpc.setHead(220n);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state().nextBlock).toBe("210");
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "211", coverageStatus: "complete", reorgState: "clear" });
    expect(store.events()).toHaveLength(1);
    expect(rpc.calls).toEqual([[10n, 109n], [110n, 209n], [210n, 210n]]);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "221", coverageStatus: "complete", target: { blockNumber: "220" } });
  });
});

test("unknown log or row capacity never advances the page", async () => {
  await fixture(async (store, rpc) => {
    const bad = { ...created(1n), topics: [hash(99n)] as ReturnType<typeof created>["topics"] };
    rpc.setLogs([bad]);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "10", coverageReason: "INVALID_LOG" });
    expect(store.events()).toEqual([]);
  });
  await fixture(async (store, rpc) => {
    rpc.setLogs([created(1n), created(2n)]); rpc.setNextId(3n);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "10", coverageReason: "CAPACITY" });
    expect(store.events()).toEqual([]);
  }, 1);
});

test("missing created identity prevents complete coverage", async () => {
  await fixture(async (store, rpc) => {
    rpc.setNextId(2n);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "11", coverageStatus: "partial", coverageReason: "COVERAGE_MISMATCH" });
  });
});

test("known deployment-level ABI events retain null demand identity", async () => {
  await fixture(async (store, rpc) => {
    const domain = { ...created(1n), topics: encodeEventTopics({ abi: AGENT_DEMAND_ABI, eventName: "EIP712DomainChanged" }), data: "0x" as Hex };
    const rotated = { ...created(2n), topics: encodeEventTopics({ abi: AGENT_DEMAND_ABI, eventName: "VerifierRotated",
      args: { previousVerifier: ("0x" + "5".repeat(40)) as Address, newVerifier: ("0x" + "6".repeat(40)) as Address } }), data: "0x" as Hex };
    rpc.setLogs([domain, rotated]);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state().coverageStatus).toBe("complete");
    expect(store.events().map((row) => [row.eventName, row.demandId])).toEqual([["EIP712DomainChanged", null], ["VerifierRotated", null]]);
  });
});

test("restart revalidates and resumes the persisted frozen target", async () => {
  await fixture(async (store, rpc) => {
    rpc.setHead(210n);
    await refreshActivity(store, rpc.client, contract, limits);
    const reopened = new ActivityStore(store.path, deployment);
    try {
      expect(reopened.state()).toMatchObject({ nextBlock: "110", reorgState: "unchecked", coverageReason: "UNVERIFIED_CHECKPOINT" });
      rpc.setHead(220n);
      await refreshActivity(reopened, rpc.client, contract, limits);
      await refreshActivity(reopened, rpc.client, contract, limits);
      expect(reopened.state()).toMatchObject({ nextBlock: "211", target: { blockNumber: "210" }, coverageStatus: "complete" });
    } finally { reopened.close(); }
  });
});

test("page reorg resets without publishing events; checkpoint guard suppresses mismatch and RPC failure", async () => {
  await fixture(async (store, rpc) => {
    rpc.setChanged(true);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "10", reorgState: "rebuilding", coverageReason: "REORG_REBUILD" });
    expect(store.events()).toEqual([]);
  });
  await fixture(async (store, rpc) => {
    await refreshActivity(store, rpc.client, contract, limits);
    expect(await validateActivityCheckpoint(store, rpc.client)).toBe(true);
    rpc.setChanged(true);
    await rpc.client.getBlock();
    expect(await validateActivityCheckpoint(store, rpc.client)).toBe(false);
    expect(store.state()).toMatchObject({ coverageStatus: "unavailable", reorgState: "detected" });
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ reorgState: "clear", coverageStatus: "complete", cutoff: { blockHash: hash(1010n) } });
  });
  await fixture(async (store, rpc) => {
    await refreshActivity(store, rpc.client, contract, limits);
    rpc.setOffline(true);
    expect(await validateActivityCheckpoint(store, rpc.client)).toBe(false);
    expect(store.state().coverageReason).toBe("RPC_UNAVAILABLE");
  });
});

test("checkpoint guard cannot trust a snapshot changed while its RPC is pending", async () => {
  await fixture(async (store, rpc) => {
    await refreshActivity(store, rpc.client, contract, limits);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const delayed = { ...rpc.client, getBlock: async () => {
      await wait;
      return { number: 10n, hash: hash(10n), timestamp: 1010n, transactions: [tx] };
    } } as unknown as PublicClient;
    const pending = validateActivityCheckpoint(store, delayed);
    store.updateState("11", (state) => ({ ...state, coverageStatus: "partial", coverageReason: "BACKFILL_INCOMPLETE" }));
    release();
    expect(await pending).toBe(false);
    expect(store.state().coverageStatus).toBe("partial");
  });
});

test("wrong chain cannot index or validate a stored checkpoint", async () => {
  await fixture(async (store, rpc) => {
    rpc.setChainId(1);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state()).toMatchObject({ nextBlock: "10", coverageReason: "RPC_UNAVAILABLE" });
    expect(rpc.calls).toEqual([]);
    rpc.setChainId(1952);
    await refreshActivity(store, rpc.client, contract, limits);
    expect(store.state().coverageStatus).toBe("complete");
    rpc.setChainId(1);
    expect(await validateActivityCheckpoint(store, rpc.client)).toBe(false);
    expect(store.state().coverageStatus).not.toBe("complete");
  });
});

test("scheduler stop aborts the in-flight bounded fetch and waits for it", async () => {
  await fixture(async (store, rpc) => {
    let entered!: () => void, aborted = false;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetch: typeof globalThis.fetch = Object.assign((_input: RequestInfo | URL, init?: RequestInit) => {
      entered();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      });
    }, globalThis.fetch);
    const stop = startActivityScheduler(store, (signal) => ({
      ...rpc.client, getChainId: async () => { await withRpcAbort(fetch, signal)("https://rpc.invalid"); return 1952; },
    }), contract, limits, 1000);
    await started;
    await stop();
    expect(aborted).toBe(true);
    expect(store.state().coverageStatus).toBe("unavailable");
  });
});
