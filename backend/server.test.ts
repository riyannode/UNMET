import { describe, expect, test } from "bun:test";
import { encodeEventTopics, type Address, type PublicClient } from "viem";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { paymentMiddleware } from "@okxweb3/x402-express";
import express from "express";
import { getPublicClient, isoFromUnix, loadConfig, AGENT_DEMAND_ABI } from "./contract.ts";
import { app, changedDemandIds, createApp, createDemandIndexState, opportunityPaymentOptions, paymentStorageGuard, refreshIndex, resolveX402PaymentConfig, scoreOpportunity, validateOpportunitiesInput } from "./server.ts";

const testContract = "0x0000000000000000000000000000000000000001" as Address;
const demandContract = "0x7c51457235cFFBae862493D788137BFf1EF07e2E" as Address;
const hashA = `0x${"a".repeat(64)}` as `0x${string}`;
const hashB = `0x${"b".repeat(64)}` as `0x${string}`;

function withEnv(values: Record<string, string>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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
        : { number: blockNumber, hash: blockNumber === 100n ? hashA : hashB },
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

describe("independent market and x402 networks", () => {
  test("allows testnet demand state with mainnet x402 priced at $0.01", () => {
    withEnv({
      CHAIN_ID: "1952",
      XLAYER_RPC_URL: "https://testrpc.xlayer.tech/terigon",
      DEMAND_CONTRACT: demandContract,
      PAYMENT_TOKEN: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
      X402_CHAIN_ID: "196",
      OPPORTUNITY_PRICE: "0.01",
      NODE_ENV: "test",
    }, () => {
      const market = loadConfig();
      const payment = resolveX402PaymentConfig(process.env, market.chainId);
      expect(market.chainId).toBe(1952);
      expect(market.contract).toBe(demandContract);
      expect(payment.network).toBe("eip155:196");
      expect(payment.price).toBe("$0.01");
    });
  });

  test("changing X402_CHAIN_ID does not change the demand public client", () => {
    withEnv({
      CHAIN_ID: "1952",
      XLAYER_RPC_URL: "https://testrpc.xlayer.tech/terigon",
      DEMAND_CONTRACT: demandContract,
      PAYMENT_TOKEN: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
      X402_CHAIN_ID: "1952",
      NODE_ENV: "test",
    }, () => {
      for (const x402ChainId of ["1952", "196"]) {
        process.env.X402_CHAIN_ID = x402ChainId;
        const market = loadConfig();
        const client = getPublicClient();
        expect(market.chainId).toBe(1952);
        expect(market.contract).toBe(demandContract);
        expect(client.chain?.id).toBe(1952);
        expect(client.chain?.rpcUrls.default.http[0]).toBe("https://testrpc.xlayer.tech/terigon");
      }
    });
  });

  test("fails closed for unsupported x402 chains and non-mainnet production config", () => {
    expect(resolveX402PaymentConfig({ NODE_ENV: "test" }, 1952).network).toBe("eip155:1952");
    expect(resolveX402PaymentConfig({ NODE_ENV: "production", VERCEL_ENV: "preview" }, 1952).network).toBe("eip155:1952");
    expect(() => resolveX402PaymentConfig({ NODE_ENV: "test", X402_CHAIN_ID: "1" }, 1952)).toThrow("X402_CHAIN_ID must be 1952 or 196");
    expect(() => resolveX402PaymentConfig({ VERCEL_ENV: "production" }, 1952)).toThrow("X402_CHAIN_ID must be explicitly set to 196 in production");
    expect(() => resolveX402PaymentConfig({ NODE_ENV: "production" }, 1952)).toThrow("X402_CHAIN_ID must be explicitly set to 196 in production");
    expect(() => resolveX402PaymentConfig({ NODE_ENV: "production", X402_CHAIN_ID: "1952" }, 1952)).toThrow("X402_CHAIN_ID must be explicitly set to 196 in production");
    expect(resolveX402PaymentConfig({ NODE_ENV: "production", X402_CHAIN_ID: "196" }, 1952)).toMatchObject({
      network: "eip155:196", price: "$0.01", assets: [
        { asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", extra: { name: "USD₮0", version: "1" } },
        { asset: "0xb6ceceab302e2e4948951ee7843fc24e92933061", extra: { name: "USDC", version: "2" } },
        { asset: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8", extra: { name: "Global Dollar", version: "1" } },
      ],
    });
    expect(() => resolveX402PaymentConfig({ X402_CHAIN_ID: "196", OPPORTUNITY_PRICE: "1" }, 1952)).toThrow("CONFIG_INVALID: OPPORTUNITY_PRICE");
  });

  test("official x402 scheme resolves network-specific stablecoin and amount", async () => {
    const scheme = new ExactEvmScheme();
    const mainnet = await scheme.parsePrice("$0.01", "eip155:196");
    const testnet = await scheme.parsePrice("$0.01", "eip155:1952");
    expect(mainnet).toMatchObject({ amount: "10000", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736" });
    expect(testnet).toMatchObject({ amount: "10000", asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" });
  });

  test("Mainnet opportunity accepts are the exact ordered native token options", () => {
    const payTo = "0x1111111111111111111111111111111111111111" as const;
    expect(opportunityPaymentOptions(resolveX402PaymentConfig({ X402_CHAIN_ID: "196" }, 1952), payTo)).toEqual([
      { scheme: "exact", network: "eip155:196", payTo, price: { asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", amount: "10000", extra: { name: "USD₮0", version: "1" } } },
      { scheme: "exact", network: "eip155:196", payTo, price: { asset: "0xb6ceceab302e2e4948951ee7843fc24e92933061", amount: "10000", extra: { name: "USDC", version: "2" } } },
      { scheme: "exact", network: "eip155:196", payTo, price: { asset: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8", amount: "10000", extra: { name: "Global Dollar", version: "1" } } },
    ]);
  });

  test("official SDK 402 challenge carries all three Mainnet options in order", async () => {
    const payTo = "0x1111111111111111111111111111111111111111" as const;
    const accepts = opportunityPaymentOptions(resolveX402PaymentConfig({ X402_CHAIN_ID: "196" }, 1952), payTo);
    const resource = new x402ResourceServer({
      getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} }),
      verify: async () => ({ isValid: false }), settle: async () => { throw new Error("not called"); },
      getSettleStatus: async () => ({ success: false }),
    }).register("eip155:196", new ExactEvmScheme());
    await resource.initialize();
    const paid = paymentMiddleware({ "POST /v1/opportunities": { accepts } }, resource, undefined, undefined, false);
    const app = express();
    app.post("/v1/opportunities", paid, (_req, res) => res.json({}));
    const server = app.listen(0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test listener unavailable");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, { method: "POST" });
      expect(response.status).toBe(402);
      const challenge = JSON.parse(Buffer.from(response.headers.get("payment-required")!, "base64").toString());
      expect(challenge.accepts).toEqual(accepts.map((option) => ({
        scheme: option.scheme, network: option.network, asset: (option.price as { asset: string }).asset,
        amount: (option.price as { amount: string }).amount, payTo: option.payTo,
        maxTimeoutSeconds: 300, extra: (option.price as { extra: unknown }).extra,
      })));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("no-storage payment guard blocks both payment headers and leaves unpaid challenges reachable", () => {
    const guard = paymentStorageGuard(false);
    for (const header of ["payment-signature", "x-payment"]) {
      let status = 0, body: unknown, next = false;
      const req = { get: (name: string) => name === header ? "fixture" : undefined };
      const res = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } };
      guard(req as never, res as never, () => { next = true; });
      expect(status).toBe(503);
      expect(body).toEqual({ error: { code: "PAYMENT_STORAGE_UNAVAILABLE", message: "Payment service unavailable" } });
      expect(next).toBe(false);
    }
    let unpaidNext = false;
    guard({ get: () => undefined } as never, {} as never, () => { unpaidNext = true; });
    expect(unpaidNext).toBe(true);
  });

  test("default API rejects paid HTTP requests for missing storage before facilitator initialization", async () => {
    expect(process.env.PAYMENT_DB_PATH).toBeUndefined();
    const server = app.listen(0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test listener unavailable");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, {
        method: "POST", headers: { "content-type": "application/json", "x-payment": "fixture" }, body: "{}",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "PAYMENT_STORAGE_UNAVAILABLE", message: "Payment service unavailable" } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
