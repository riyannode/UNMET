import { describe, expect, test } from "bun:test";
import { encodeEventTopics, type Address, type PublicClient } from "viem";
import { isoFromUnix } from "./contract.ts";
import { AGENT_DEMAND_ABI } from "./contract.ts";
import { app, changedDemandIds, createApp, createDemandIndexState, refreshIndex, scoreOpportunity, validateOpportunitiesInput } from "./server.ts";

const testContract = "0x0000000000000000000000000000000000000001" as Address;
const hashA = `0x${"a".repeat(64)}` as `0x${string}`;
const hashB = `0x${"b".repeat(64)}` as `0x${string}`;

function closedLog(demandId: bigint) {
  return {
    address: testContract,
    blockHash: hashA,
    blockNumber: 1n,
    data: "0x",
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: AGENT_DEMAND_ABI,
      eventName: "DemandClosed",
      args: { demandId, demandKey: `0x${"0".repeat(64)}` },
    }),
    transactionHash: hashB,
    transactionIndex: 0,
  };
}

function fakeClient(overrides: {
  getLogs?: (fromBlock: bigint, toBlock: bigint) => unknown[] | Promise<unknown[]>;
  getBlock?: (blockNumber?: bigint) => { number: bigint; hash: `0x${string}` } | Promise<{ number: bigint; hash: `0x${string}` }>;
  readContract?: (functionName: string) => unknown | Promise<unknown>;
} = {}): PublicClient {
  return {
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => await overrides.getLogs?.(fromBlock, toBlock) ?? [],
    getBlock: async (args?: { blockNumber?: bigint }) => await overrides.getBlock?.(args?.blockNumber) ?? { number: 0n, hash: hashA },
    readContract: async ({ functionName }: { functionName: string }) => await overrides.readContract?.(functionName),
  } as unknown as PublicClient;
}

describe("bounded demand log indexing", () => {
  test("uses one valid inclusive request for a range of exactly 100 blocks", async () => {
    const requests: Array<[bigint, bigint]> = [];
    const ids = await changedDemandIds(fakeClient({
      getLogs: (fromBlock, toBlock) => { requests.push([fromBlock, toBlock]); return []; },
    }), testContract, 10n, 109n);

    expect(requests).toEqual([[10n, 109n]]);
    expect(ids.size).toBe(0);
  });

  test("splits ranges larger than 100 blocks into inclusive windows", async () => {
    const requests: Array<[bigint, bigint]> = [];
    await changedDemandIds(fakeClient({
      getLogs: (fromBlock, toBlock) => { requests.push([fromBlock, toBlock]); return []; },
    }), testContract, 10n, 259n);

    expect(requests).toEqual([[10n, 109n], [110n, 209n], [210n, 259n]]);
  });

  test("never sends an eth_getLogs range wider than 100 blocks", async () => {
    const requests: Array<[bigint, bigint]> = [];
    await changedDemandIds(fakeClient({
      getLogs: (fromBlock, toBlock) => { requests.push([fromBlock, toBlock]); return []; },
    }), testContract, 1_000n, 1_550n);

    expect(requests.length).toBe(6);
    expect(requests.every(([fromBlock, toBlock]) => toBlock - fromBlock + 1n <= 100n)).toBe(true);
    expect(requests[0]).toEqual([1_000n, 1_099n]);
    expect(requests.at(-1)).toEqual([1_500n, 1_550n]);
  });

  test("merges and deduplicates demand IDs decoded from multiple chunks", async () => {
    const ids = await changedDemandIds(fakeClient({
      getLogs: (fromBlock) => fromBlock === 1n
        ? [closedLog(7n), closedLog(9n)]
        : fromBlock === 101n ? [closedLog(9n), closedLog(11n)] : [closedLog(7n), closedLog(13n)],
    }), testContract, 1n, 250n);

    expect([...ids].sort((a, b) => a < b ? -1 : 1)).toEqual([7n, 9n, 11n, 13n]);
  });

  test("returns an empty set without RPC calls for an empty range", async () => {
    let calls = 0;
    const ids = await changedDemandIds(fakeClient({ getLogs: () => { calls += 1; return []; } }), testContract, 5n, 4n);

    expect(ids.size).toBe(0);
    expect(calls).toBe(0);
  });

  test("refreshes an index more than 100 blocks behind the current X Layer head", async () => {
    const state = createDemandIndexState();
    state.ready = true;
    state.lastIndexedBlock = 100n;
    state.lastIndexedBlockHash = hashA;
    const requests: Array<[bigint, bigint]> = [];
    const client = fakeClient({
      getBlock: (blockNumber) => blockNumber === undefined
        ? { number: 251n, hash: hashB }
        : { number: blockNumber, hash: hashA },
      getLogs: (fromBlock, toBlock) => { requests.push([fromBlock, toBlock]); return []; },
      readContract: (functionName) => functionName === "nextDemandId" ? 1n : undefined,
    });

    await refreshIndex(client, testContract, state);

    expect(requests).toEqual([[101n, 200n], [201n, 251n]]);
    expect(state.lastIndexedBlock).toBe(251n);
    expect(state.lastIndexedBlockHash).toBe(hashB);
  });

  test("rebuilds from current chain state when the indexed block hash changes", async () => {
    const state = createDemandIndexState();
    state.ready = true;
    state.lastIndexedBlock = 100n;
    state.lastIndexedBlockHash = hashA;
    state.entries.set("99", {} as never);
    let logCalls = 0;
    const client = fakeClient({
      getBlock: (blockNumber) => blockNumber === undefined
        ? { number: 110n, hash: hashB }
        : { number: blockNumber, hash: hashB },
      getLogs: () => { logCalls += 1; return []; },
      readContract: (functionName) => {
        if (functionName === "nextDemandId") return 2n;
        if (functionName === "getDemand") return {
          creator: testContract,
          builder: testContract,
          maxUnitPrice: 1n,
          committed: 1n,
          reviewCommitted: 0n,
          approvalRequired: 0n,
          expectedCalls: 1n,
          deadline: 2n,
          reviewEndsAt: 0n,
          supporterCount: 1,
          status: 0,
          capability: "test",
          specification: "test",
          serviceUrl: "",
          evidenceHash: `0x${"0".repeat(64)}`,
        };
        if (functionName === "approvalProgress" || functionName === "rejectionProgress") return [0n, 0n, false];
        return undefined;
      },
    });

    await refreshIndex(client, testContract, state);

    expect(logCalls).toBe(0);
    expect(state.entries.has("99")).toBe(false);
    expect(state.entries.has("1")).toBe(true);
    expect(state.lastIndexedBlock).toBe(110n);
    expect(state.lastIndexedBlockHash).toBe(hashB);
  });
});

describe("Vercel Express entrypoint", () => {
  test("exports an Express app and mounts payment middleware only on the paid route", async () => {
    expect(typeof app).toBe("function");
    let middlewareCalls = 0;
    const server = createApp({
      middleware: (_req, res) => {
        middlewareCalls += 1;
        res.status(402).end();
      },
    }).listen(0, "127.0.0.1");

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(402);
      expect(middlewareCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

describe("opportunity score", () => {
  test("is deterministic and bounded", () => {
    const now = 1_700_000_000n;
    const pool = [
      { committed: 100n, expectedCalls: 10n, supporters: 1, deadlineUnix: now + 86_400n },
      { committed: 360n, expectedCalls: 25_000n, supporters: 37, deadlineUnix: now + 86_400n * 20n },
      { committed: 50n, expectedCalls: 5n, supporters: 2, deadlineUnix: now + 86_400n * 2n },
    ];
    const first = scoreOpportunity(pool[1]!, pool, now);
    const second = scoreOpportunity(pool[1]!, pool, now);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  test("keeps bigint precision above Number.MAX_SAFE_INTEGER", () => {
    const now = 1_700_000_000n;
    const pool = [
      { committed: 9_007_199_254_740_993n, expectedCalls: 9_007_199_254_740_993n, supporters: 2, deadlineUnix: now + 86_400n },
      { committed: 9_007_199_254_740_994n, expectedCalls: 9_007_199_254_740_994n, supporters: 2, deadlineUnix: now + 86_400n },
    ];
    expect(scoreOpportunity(pool[1]!, pool, now)).toBeGreaterThan(scoreOpportunity(pool[0]!, pool, now));
  });
});

describe("Unix deadline serialization", () => {
  test("formats representable timestamps without a lossy seconds conversion", () => {
    expect(isoFromUnix(1_700_000_000n)).toBe("2023-11-14T22:13:20.000Z");
  });

  test("returns null for uint64 deadlines outside JavaScript Date range", () => {
    expect(isoFromUnix((1n << 64n) - 1n)).toBeNull();
  });
});

describe("opportunity request validation", () => {
  test("accepts the documented default request", () => {
    const result = validateOpportunitiesInput({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(10);
      expect(result.value.sort).toBe("bounty");
      expect(result.value.minBounty).toBe(0n);
    }
  });

  test("rejects out-of-range limit", () => {
    const result = validateOpportunitiesInput({ limit: 51 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LIMIT");
  });

  test("rejects unknown status and sort", () => {
    const status = validateOpportunitiesInput({ status: "pending" });
    const sort = validateOpportunitiesInput({ sort: "random" });
    expect(status.ok).toBe(false);
    expect(sort.ok).toBe(false);
  });

  test("parses six-decimal bounty exactly", () => {
    const result = validateOpportunitiesInput({ minBounty: "123.456789" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minBounty).toBe(123_456_789n);
  });
});
