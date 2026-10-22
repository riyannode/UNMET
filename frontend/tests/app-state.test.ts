import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash, type PublicClient } from "viem";
import { afterConfirmedTransaction, deriveMarketRequests, nextMarketStatusChangeAt, readSupportForIdentity, settleBoardRead, settleSupportRead } from "../app-state";
import { DEMAND_ABI, demandIdsFromLogs, effectiveStatus, parseMarketSyncInterval, synchronizeMarketBoard, type DemandView, type MarketSyncCursor } from "../contract";

const SYNC_CONTRACT = "0x00000000000000000000000000000000000000aa" as Address;
const SYNC_HASH = (block: bigint) => `0x${block.toString(16).padStart(64, "0")}` as Hash;

function syncDemand(demandId: bigint, committed: bigint): DemandView {
  return {
    demandId,
    creator: "0x0000000000000000000000000000000000000001",
    builder: "0x0000000000000000000000000000000000000002",
    maxUnitPrice: 2_000_000n,
    committed,
    reviewCommitted: 0n,
    approvalRequired: 0n,
    expectedCalls: 1000n,
    deadline: 2_000n,
    reviewEndsAt: 3_000n,
    supporterCount: 2,
    status: 0,
    capability: `Capability ${demandId}`,
    specification: "",
    serviceUrl: "",
    evidenceHash: `0x${"0".repeat(64)}`,
    approvalWeight: 0n,
    quorumReached: false,
    rejectionWeight: 0n,
    rejectionThreshold: 0n,
    candidateRejected: false,
  };
}

function encodedDemandEvent(eventName: "DemandCreated" | "DemandSupported", demandId: bigint, data: `0x${string}`) {
  const topics = encodeEventTopics({ abi: DEMAND_ABI, eventName, args: { demandId } });
  return { data, topics };
}

function supportEventData() {
  return encodeAbiParameters(
    [{ type: "uint96" }, { type: "uint64" }, { type: "uint128" }, { type: "uint32" }],
    [1_000_000n, 1_000n, 2_000_000n, 3],
  );
}

function createdEventData() {
  return encodeAbiParameters(
    [{ type: "string" }, { type: "uint96" }, { type: "uint64" }, { type: "uint64" }, { type: "uint96" }],
    ["New capability", 2_000_000n, 1_000n, 2_000n, 1_000_000n],
  );
}

describe("incremental Market synchronization", () => {
  test("decodes supported contract events and deduplicates demand IDs", () => {
    const logs = [
      encodedDemandEvent("DemandSupported", 1n, supportEventData()),
      encodedDemandEvent("DemandSupported", 1n, supportEventData()),
      encodedDemandEvent("DemandCreated", 2n, createdEventData()),
    ];
    expect(demandIdsFromLogs(logs)).toEqual(new Set([1n, 2n]));
    expect(DEMAND_ABI.filter((item) => item.type === "event").map((item) => item.name)).toEqual([
      "DemandCreated",
      "DemandSupported",
      "ServiceSubmitted",
      "ServiceApproved",
      "ServiceRejected",
      "SubmissionRejected",
      "DemandFulfilled",
      "Refunded",
      "DemandClosed",
    ]);
  });

  test("reads each changed demand once at a pinned block and merges new and existing demands", async () => {
    const logs = [
      encodedDemandEvent("DemandSupported", 1n, supportEventData()),
      encodedDemandEvent("DemandSupported", 1n, supportEventData()),
      encodedDemandEvent("DemandCreated", 2n, createdEventData()),
    ];
    const getDemandReads: { id: bigint; blockNumber?: bigint }[] = [];
    let contractReadCount = 0;
    const logRanges: { fromBlock: bigint; toBlock: bigint }[] = [];
    const client = {
      getBlockNumber: async () => 15n,
      getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({
        number: blockNumber ?? 15n,
        hash: SYNC_HASH(blockNumber ?? 15n),
      }),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        logRanges.push({ fromBlock, toBlock });
        return logs;
      },
      readContract: async ({ functionName, args, blockNumber }: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
        contractReadCount += 1;
        if (functionName === "getDemand") {
          const id = args?.[0] as bigint;
          getDemandReads.push({ id, blockNumber });
          return syncDemand(id, id === 1n ? 9_000_000n : 2_000_000n);
        }
        if (functionName === "approvalProgress") return [0n, 0n, false] as const;
        if (functionName === "rejectionProgress") return [0n, 0n, false] as const;
        throw new Error(`Unexpected contract read ${functionName}`);
      },
    } as unknown as PublicClient;
    const cursor: MarketSyncCursor = { blockNumber: 10n, blockHash: SYNC_HASH(10n) };
    const result = await synchronizeMarketBoard(client, SYNC_CONTRACT, [syncDemand(1n, 1_000_000n)], cursor);

    expect(logRanges).toEqual([{ fromBlock: 11n, toBlock: 15n }]);
    expect(getDemandReads).toEqual([{ id: 1n, blockNumber: 15n }, { id: 2n, blockNumber: 15n }]);
    expect(contractReadCount).toBe(6);
    expect(result.demands.map(({ demandId, committed }) => [demandId, committed])).toEqual([
      [1n, 9_000_000n],
      [2n, 2_000_000n],
    ]);
    expect(result).toMatchObject({ changed: true, reorgRecovered: false, cursor: { blockNumber: 15n, blockHash: SYNC_HASH(15n) } });
  });

  test("keeps the previous board and cursor unchanged when event reads fail", async () => {
    const previous = [syncDemand(1n, 3_000_000n)];
    const cursor: MarketSyncCursor = { blockNumber: 10n, blockHash: SYNC_HASH(10n) };
    const client = {
      getBlockNumber: async () => 11n,
      getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber, hash: SYNC_HASH(blockNumber ?? 10n) }),
      getLogs: async () => { throw new Error("RPC offline"); },
    } as unknown as PublicClient;

    await expect(synchronizeMarketBoard(client, SYNC_CONTRACT, previous, cursor)).rejects.toThrow("RPC offline");
    expect(previous[0]?.committed).toBe(3_000_000n);
    expect(cursor).toEqual({ blockNumber: 10n, blockHash: SYNC_HASH(10n) });
  });

  test("advances an empty event range without contract state reads", async () => {
    let contractReadCount = 0;
    const client = {
      getBlockNumber: async () => 11n,
      getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber, hash: SYNC_HASH(blockNumber ?? 10n) }),
      getLogs: async () => [],
      readContract: async () => { contractReadCount += 1; throw new Error("No state read expected"); },
    } as unknown as PublicClient;
    const cursor: MarketSyncCursor = { blockNumber: 10n, blockHash: SYNC_HASH(10n) };
    const result = await synchronizeMarketBoard(client, SYNC_CONTRACT, [syncDemand(1n, 2_000_000n)], cursor);

    expect(result).toMatchObject({ changed: false, cursor: { blockNumber: 11n, blockHash: SYNC_HASH(11n) } });
    expect(result.demands).toEqual([syncDemand(1n, 2_000_000n)]);
    expect(contractReadCount).toBe(0);
  });

  test("rebuilds a pinned snapshot when the saved checkpoint was reorganized", async () => {
    let logReads = 0;
    const client = {
      getBlockNumber: async () => 15n,
      getBlock: async ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string }) => {
        const number = blockTag === "latest" ? 15n : blockNumber ?? 15n;
        return { number, hash: SYNC_HASH(number + (number === 10n ? 1n : 0n)) };
      },
      getLogs: async () => { logReads += 1; return []; },
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === "nextDemandId") return 2n;
        const id = args?.[0] as bigint;
        if (functionName === "getDemand") return syncDemand(id, 4_000_000n);
        if (functionName === "approvalProgress") return [0n, 0n, false] as const;
        if (functionName === "rejectionProgress") return [0n, 0n, false] as const;
        throw new Error(`Unexpected contract read ${functionName}`);
      },
    } as unknown as PublicClient;
    const cursor: MarketSyncCursor = { blockNumber: 10n, blockHash: SYNC_HASH(10n) };
    const result = await synchronizeMarketBoard(client, SYNC_CONTRACT, [], cursor);

    expect(logReads).toBe(0);
    expect(result).toMatchObject({ changed: true, reorgRecovered: true, cursor: { blockNumber: 15n, blockHash: SYNC_HASH(15n) } });
    expect(result.demands.map(({ demandId }) => demandId)).toEqual([1n]);
  });
});

describe("Market sync configuration", () => {
  test("uses a 60 second default and rejects invalid intervals", () => {
    expect(parseMarketSyncInterval(undefined)).toBe(60_000);
    expect(parseMarketSyncInterval(" ")).toBe(60_000);
    expect(parseMarketSyncInterval("0")).toBe(60_000);
    expect(parseMarketSyncInterval("-1")).toBe(60_000);
    expect(parseMarketSyncInterval("not-a-number")).toBe(60_000);
    expect(parseMarketSyncInterval("15000")).toBe(15_000);
  });
});

describe("deadline-derived Market status", () => {
  test("schedules the next local status transition without RPC", () => {
    const now = 100n;
    expect(nextMarketStatusChangeAt([
      { status: 0, deadline: 150n, reviewEndsAt: 200n, quorumReached: false, candidateRejected: false },
      { status: 1, deadline: 160n, reviewEndsAt: 140n, quorumReached: false, candidateRejected: false },
      { status: 2, deadline: 120n, reviewEndsAt: 130n, quorumReached: false, candidateRejected: false },
      { status: 1, deadline: 180n, reviewEndsAt: 190n, quorumReached: true, candidateRejected: false },
    ], now)).toBe(150n);
    expect(nextMarketStatusChangeAt([
      { status: 0, deadline: 99n, reviewEndsAt: 100n, quorumReached: false, candidateRejected: false },
      { status: 1, deadline: 180n, reviewEndsAt: 190n, quorumReached: false, candidateRejected: false },
    ], now)).toBe(190n);
    expect(nextMarketStatusChangeAt([
      { status: 0, deadline: 99n, reviewEndsAt: 100n, quorumReached: false, candidateRejected: false },
      { status: 1, deadline: 180n, reviewEndsAt: 190n, quorumReached: true, candidateRejected: false },
    ], now)).toBeNull();
  });
});

describe("board read status", () => {
  test("clears only the board error after a successful retry", () => {
    const failed = settleBoardRead(
      { actionStatus: "Support success", boardError: "RPC offline" },
      { kind: "error", message: "RPC offline" },
    );
    expect(settleBoardRead(failed, { kind: "success" })).toEqual({
      actionStatus: "Support success",
      boardError: "",
    });
  });
});

describe("support read identity", () => {
  test("clears only support errors after loading or a successful retry", () => {
    const failed = settleSupportRead(
      { actionStatus: "Support success", boardError: "Board RPC offline", supportError: "Position RPC offline" },
      { kind: "error", message: "Position RPC offline" },
    );
    expect(settleSupportRead(failed, { kind: "loading" })).toEqual({
      actionStatus: "Support success",
      boardError: "Board RPC offline",
      supportError: "",
    });
    const retryFailed = settleSupportRead(failed, { kind: "loading" });
    expect(settleSupportRead(retryFailed, { kind: "success" })).toEqual({
      actionStatus: "Support success",
      boardError: "Board RPC offline",
      supportError: "",
    });
  });

  test("returns current data and surfaces current read failures", async () => {
    await expect(readSupportForIdentity("alice:1", async () => "position", (key) => key === "alice:1"))
      .resolves.toEqual({ kind: "ready", value: "position" });
    await expect(readSupportForIdentity("alice:1", async () => { throw new Error("RPC offline"); }, (key) => key === "alice:1"))
      .resolves.toMatchObject({ kind: "error", error: new Error("RPC offline") });
  });

  test("discards success or failure from an old demand/account identity", async () => {
    let currentIdentity = "alice:1";
    let resolveRead!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveRead = resolve; });
    const staleSuccess = readSupportForIdentity("alice:1", () => pending, (key) => key === currentIdentity);
    currentIdentity = "bob:2";
    resolveRead("stale position");
    await expect(staleSuccess).resolves.toEqual({ kind: "stale" });

    currentIdentity = "alice:1";
    const staleFailure = readSupportForIdentity("alice:1", async () => { throw new Error("old RPC error"); }, (key) => key === currentIdentity);
    currentIdentity = "bob:2";
    await expect(staleFailure).resolves.toEqual({ kind: "stale" });
  });
});

describe("confirmed transaction readback", () => {
  test("refreshes board and support once after receipt, even when board readback fails", async () => {
    let receipt: string | null = null;
    let boardReads = 0;
    let supportReads = 0;
    const result = await afterConfirmedTransaction(
      async () => "0xconfirmed",
      (hash) => { receipt = hash; },
      async () => { boardReads += 1; return false; },
      async () => { supportReads += 1; return { kind: "ready" as const, value: "position" }; },
    );

    expect(receipt).toBe("0xconfirmed");
    expect(boardReads).toBe(1);
    expect(supportReads).toBe(1);
    expect(result).toEqual({ boardReadbackSucceeded: false, supportReadback: { kind: "ready", value: "position" } });
  });

  test("does not read state when the transaction fails before a successful receipt", async () => {
    let boardReads = 0;
    let supportReads = 0;
    await expect(afterConfirmedTransaction(
      async () => { throw new Error("CHAIN_RECEIPT_FAILED"); },
      () => undefined,
      async () => { boardReads += 1; return true; },
      async () => { supportReads += 1; return null; },
    )).rejects.toThrow("CHAIN_RECEIPT_FAILED");
    expect(boardReads).toBe(0);
    expect(supportReads).toBe(0);
  });
});

describe("Market request derivation", () => {
  test("searches trimmed capability text case-insensitively and matches exact IDs with an optional hash", () => {
    const board = [
      { demandId: 12n, committed: 1n, capability: "Oracle Adapter", status: "READY" },
      { demandId: 123n, committed: 1n, capability: "Kernel Service", status: "OPEN" },
      { demandId: 5n, committed: 1n, capability: "Payment Router", status: "READY" },
    ];
    const derive = (search: string) => deriveMarketRequests(
      board,
      { search, status: "ALL", sort: "most-funded" },
      (demand) => demand.status,
    ).requests.map((demand) => demand.demandId);

    expect(derive("  oRaClE  ")).toEqual([12n]);
    expect(derive("#12")).toEqual([12n]);
    expect(derive("12")).toEqual([12n]);
    expect(derive(" ")).toEqual([123n, 12n, 5n]);
    expect(derive("#1")).toEqual([]);
  });

  test("combines effective status and search while counting the full board", () => {
    const makeDemand = (demandId: bigint, overrides: Partial<DemandView> = {}): DemandView => ({
      demandId,
      creator: "0x0000000000000000000000000000000000000001",
      builder: "0x0000000000000000000000000000000000000002",
      maxUnitPrice: 2_000_000n,
      committed: 5_000_000n,
      reviewCommitted: 0n,
      approvalRequired: 0n,
      expectedCalls: 1000n,
      deadline: 2_000n,
      reviewEndsAt: 3_000n,
      supporterCount: 2,
      status: 0,
      capability: "Oracle Adapter",
      specification: "",
      serviceUrl: "",
      evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      approvalWeight: 0n,
      quorumReached: false,
      rejectionWeight: 0n,
      rejectionThreshold: 0n,
      candidateRejected: false,
      ...overrides,
    });
    const board = [
      makeDemand(12n, { status: 1, capability: "Oracle Adapter", quorumReached: true }),
      makeDemand(13n, { status: 0, capability: "Oracle Runtime" }),
      makeDemand(14n, { status: 1, capability: "Oracle Rejected", candidateRejected: true }),
      makeDemand(15n, { status: 0, capability: "Expired Connector", deadline: 999n }),
    ];
    const now = 1_000n;
    const result = deriveMarketRequests(
      board,
      { search: "oracle", status: "READY", sort: "most-funded" },
      (demand) => effectiveStatus(demand, now),
    );

    expect(result.requests.map((demand) => demand.demandId)).toEqual([12n]);
    expect([...result.statusCounts]).toEqual([
      ["READY", 1],
      ["OPEN", 1],
      ["REJECTED", 1],
      ["EXPIRED", 1],
    ]);
    expect(effectiveStatus(makeDemand(16n), now)).toBe("OPEN");
  });

  test("sorts bigint escrow and IDs without mutating the board", () => {
    const board = [
      { demandId: 2n, committed: 10n, capability: "Second", status: "OPEN" },
      { demandId: 10n, committed: 10n, capability: "Tenth", status: "OPEN" },
      { demandId: 3n, committed: 9_007_199_254_740_993n, capability: "High", status: "OPEN" },
      { demandId: 1n, committed: 1n, capability: "Low", status: "OPEN" },
    ];
    const idsFor = (sort: "most-funded" | "least-funded" | "latest-id" | "earliest-id") => deriveMarketRequests(
      board,
      { search: "", status: "ALL", sort },
      (demand) => demand.status,
    ).requests.map((demand) => demand.demandId);

    expect(idsFor("most-funded")).toEqual([3n, 10n, 2n, 1n]);
    expect(idsFor("least-funded")).toEqual([1n, 10n, 2n, 3n]);
    expect(idsFor("latest-id")).toEqual([10n, 3n, 2n, 1n]);
    expect(idsFor("earliest-id")).toEqual([1n, 2n, 3n, 10n]);
    expect(board.map((demand) => demand.demandId)).toEqual([2n, 10n, 3n, 1n]);
  });
});
