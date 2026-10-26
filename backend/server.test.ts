import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { encodeEventTopics, type Address, type PublicClient } from "viem";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { paymentMiddleware } from "@okxweb3/x402-express";
import express from "express";
import { getPublicClient, isoFromUnix, loadConfig, AGENT_DEMAND_ABI, formatUnits6, type DemandTuple } from "./contract.ts";
import { app, changedDemandIds, createApp, createDemandIndexState, filterAndSort, opportunityPaymentOptions, paymentStorageGuard, refreshIndex, resolveX402PaymentConfig, scoreOpportunity, validateOpportunitiesInput, type IndexEntry } from "./server.ts";
import { loadOperationalConfig } from "./config.ts";

const testContract = "0x0000000000000000000000000000000000000001" as Address;
const demandContract = "0x7c51457235cFFBae862493D788137BFf1EF07e2E" as Address;
const hashA = `0x${"a".repeat(64)}` as `0x${string}`;
const hashB = `0x${"b".repeat(64)}` as `0x${string}`;
const marketToken: Address = "0x4444444444444444444444444444444444444444";
const fixedNow = 1_700_000_000_000;

function syntheticEntry(id: bigint, overrides: Partial<DemandTuple> & Partial<Pick<IndexEntry, "approvalWeight" | "approvalRequired" | "quorumReached" | "rejectionWeight" | "rejectionThreshold" | "candidateRejected">> = {}): IndexEntry {
  const { approvalWeight, approvalRequired, quorumReached, rejectionWeight, rejectionThreshold, candidateRejected, ...dataOverrides } = overrides;
  return {
    demandId: id,
    data: { creator: testContract, builder: "0x0000000000000000000000000000000000000000", maxUnitPrice: 1_000_000n,
      committed: id * 1_000_000n, reviewCommitted: 0n, approvalRequired: approvalRequired ?? 0n, expectedCalls: id,
      deadline: BigInt(Math.floor(fixedNow / 1000) + 86_400), reviewEndsAt: 0n, supporterCount: Number(id),
      status: 0, capability: `fixture-${id}`, specification: "fixture", serviceUrl: "", evidenceHash: hashA,
      ...dataOverrides },
    approvalWeight: approvalWeight ?? 0n, approvalRequired: approvalRequired ?? 0n, quorumReached: quorumReached ?? false,
    rejectionWeight: rejectionWeight ?? 0n, rejectionThreshold: rejectionThreshold ?? 0n, candidateRejected: candidateRejected ?? false,
  };
}

async function routeFixture(entries: IndexEntry[], run: (url: string, marketCalls: () => number) => Promise<void>) {
  const state = createDemandIndexState();
  state.ready = true;
  state.lastIndexedBlock = 42n;
  for (const entry of entries) state.entries.set(entry.demandId.toString(), entry);
  let marketCalls = 0;
  const client = fakeClient({ getBlock: () => { marketCalls++; return { number: 42n, hash: hashA }; }, readContract: () => { marketCalls++; return 0n; } });
  const server = createApp({ middleware: (_req, _res, next) => next() }, {
    config: loadOperationalConfig({ RATE_DEMANDS: "1000", RATE_OPPORTUNITIES: "1000" }),
    market: { ...loadConfig(), contract: demandContract, paymentToken: marketToken }, client,
    indexState: state, now: () => fixedNow,
  }).listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test listener unavailable");
  try { await run(`http://127.0.0.1:${address.port}`, () => marketCalls); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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

describe("free and paid discovery responses", () => {
  test("API discovery links preserve synthetic x402 challenge and settlement headers", async () => {
    const indexState = createDemandIndexState();
    indexState.ready = true;
    indexState.entries.set("1", syntheticEntry(1n));
    indexState.lastIndexedBlock = 42n;
    const app = createApp({ middleware: (req, res, next) => {
      if (!req.get("payment-signature")) {
        res.setHeader("PAYMENT-REQUIRED", "e30=");
        res.status(402).end();
        return;
      }
      res.setHeader("PAYMENT-RESPONSE", "e30=");
      next();
    } }, {
      config: loadOperationalConfig({ RATE_DEMANDS: "1000", RATE_OPPORTUNITIES: "1000" }),
      market: { ...loadConfig(), contract: demandContract, paymentToken: marketToken },
      client: fakeClient(), indexState, now: () => fixedNow,
    });
    const server = app.listen(0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test listener unavailable");
    try {
      const base = `http://127.0.0.1:${address.port}`;
      const get = await fetch(base + "/v1/demands");
      expect(get.status).toBe(200);
      expect(get.headers.get("link")).toContain("rel=\"api-catalog\"");
      const head = await fetch(base + "/v1/demands", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("link")).toContain("rel=\"service-desc\"");
      const paid = await fetch(base + "/v1/opportunities", {
        method: "POST", headers: { "content-type": "application/json", accept: "text/markdown", origin: "http://localhost:5173" }, body: "{}",
      });
      expect(paid.status).toBe(402);
      expect(paid.headers.get("content-type")).toBeNull();
      expect(paid.headers.get("cache-control")).toBe("no-store");
      expect(paid.headers.get("link")).toContain("rel=\"api-catalog\"");
      expect(paid.headers.get("payment-required")).toBe("e30=");
      expect(paid.headers.get("access-control-expose-headers")).toContain("link");
      expect(await paid.text()).toBe("");
      const settled = await fetch(base + "/v1/opportunities", {
        method: "POST", headers: { "content-type": "application/json", "payment-signature": "synthetic", accept: "text/markdown" }, body: "{}",
      });
      expect(settled.status).toBe(200);
      expect(settled.headers.get("content-type")).toContain("application/json");
      expect(settled.headers.get("cache-control")).toBe("no-store");
      expect(settled.headers.get("link")).toContain("rel=\"service-desc\"");
      expect(settled.headers.get("payment-response")).toBe("e30=");
      const result = await settled.json();
      expect(result.opportunities).toHaveLength(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("published linkset and OpenAPI describe only the implemented public endpoints", () => {
    const catalog = JSON.parse(readFileSync(new URL("../frontend/public/.well-known/api-catalog", import.meta.url), "utf8"));
    expect(catalog.linkset[0].anchor).toBe("https://unmetxyz.my.id/.well-known/api-catalog");
    expect(catalog.linkset[0].item.map((link: { href: string }) => link.href)).toEqual([
      "https://unmetxyz.my.id/v1/demands", "https://unmetxyz.my.id/v1/opportunities",
    ]);
    expect(catalog.linkset.every((entry: { anchor: string }) => new URL(entry.anchor).protocol === "https:")).toBe(true);
    expect(catalog.linkset.slice(1).every((entry: Record<string, Array<{ href: string }>>) =>
      Object.values(entry).filter(Array.isArray).flat().every((link) => new URL(link.href).protocol === "https:"))).toBe(true);
    expect(catalog.linkset[2]["service-doc"].some((link: { href: string }) => link.href === "https://unmetxyz.my.id/payment.md")).toBe(true);
    const spec = JSON.parse(readFileSync(new URL("../frontend/public/openapi.json", import.meta.url), "utf8"));
    expect(spec.info.description).toContain("Mozilla browser user agent");
    expect(Object.keys(spec.paths)).toEqual(["/.well-known/api-catalog", "/live", "/health", "/ready", "/v1/demands", "/v1/opportunities"]);
    expect(spec.paths["/.well-known/api-catalog"].get.responses["200"].content).toHaveProperty("application/linkset+json");
    expect(spec.paths["/v1/opportunities"].post.responses).toHaveProperty("402");
    expect(spec.paths["/v1/opportunities"].post.responses["402"].headers).toHaveProperty("PAYMENT-REQUIRED");
    expect(Object.keys(spec.paths["/v1/opportunities"].post.responses["402"].content)).toEqual(["application/json", "text/html"]);
    expect(spec.paths["/v1/opportunities"].post.responses["200"].headers).toHaveProperty("PAYMENT-RESPONSE");
    expect(spec.paths["/v1/opportunities"].post.parameters).toContainEqual(expect.objectContaining({ name: "PAYMENT-SIGNATURE", required: false }));
    expect(spec.paths["/v1/opportunities"].post.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
    const query = spec.components.schemas.OpportunityQuery;
    expect(query.additionalProperties).toBe(false);
    expect(query.properties.status.description).toContain("case-insensitive");
    expect(query.properties.status.description).toContain("Omit the property");
    expect(spec.paths["/v1/opportunities"].post.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/OpportunitiesResponse");
    expect(Object.keys(spec.components.schemas.Demand.properties)).toEqual([
      "demandId", "capability", "currentEscrow", "fundedBounty", "reviewCommitted", "supporters", "expectedCalls", "maxUnitPrice", "deadline", "status", "creator", "builder", "approvalWeight", "approvalRequired", "rejectionWeight", "rejectionThreshold", "candidateRejected", "score",
    ]);
    const robots = readFileSync(new URL("../frontend/public/robots.txt", import.meta.url), "utf8");
    const sitemap = readFileSync(new URL("../frontend/public/sitemap.xml", import.meta.url), "utf8");
    const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
    expect(robots).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
    expect(robots).toContain("Sitemap: https://unmetxyz.my.id/sitemap.xml");
    expect(sitemap).toContain("https://unmetxyz.my.id/");
    expect(sitemap).toContain("https://unmetxyz.my.id/docs");
    expect(html).toContain('rel="service-desc"');
    expect(html).not.toContain('rel="canonical"');
    const staticDocs = readFileSync(new URL("../frontend/public/docs/index.html", import.meta.url), "utf8");
    const paymentGuide = readFileSync(new URL("../frontend/public/payment.md", import.meta.url), "utf8");
    expect(staticDocs).toContain('<link rel="canonical" href="https://unmetxyz.my.id/docs"');
    expect(staticDocs).toContain("GET /v1/demands");
    expect(paymentGuide).toContain("PAYMENT-RESPONSE");
    expect(paymentGuide).toContain("USDG");
    expect(paymentGuide).toContain("Idempotency-Key");
    expect(paymentGuide).toContain("Ethereum L1 finality");
  });

  test("free keeps exactly the legacy 18 row fields and caps results at 50", async () => {
    await routeFixture(Array.from({ length: 55 }, (_, index) => syntheticEntry(BigInt(index + 1))), async (url, marketCalls) => {
      const response = await fetch(url + "/v1/demands");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.demands).toHaveLength(50);
      expect(Object.keys(body.demands[0])).toEqual([
        "demandId", "capability", "currentEscrow", "fundedBounty", "reviewCommitted", "supporters", "expectedCalls",
        "maxUnitPrice", "deadline", "status", "creator", "builder", "approvalWeight", "approvalRequired",
        "rejectionWeight", "rejectionThreshold", "candidateRejected", "score",
      ]);
      expect(JSON.stringify(body)).not.toMatch(/"(analysis|rank|scoreBreakdown|economicSignals|reasoning)"/);
      expect(marketCalls()).toBe(0);
    });
  });

  test("paid ranking uses numeric IDs for ties and stays stable across every response sort and limit", async () => {
    const first = 9_007_199_254_740_993n;
    const entries = [first, first + 1n, first + 2n].map((id) => syntheticEntry(id, {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: BigInt(fixedNow / 1000) + 50_000n,
    }));
    await routeFixture(entries, async (url) => {
      for (const sort of ["bounty", "supporters", "calls", "deadline", "score"]) {
        const response = await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sort, limit: 2 }) });
        const body = await response.json();
        expect(body.analysis).toMatchObject({ poolSize: 3, rankingScope: "matching_filters_before_limit", marketToken, tokenDecimals: 6 });
        expect(body.opportunities.map((row: { demandId: string; rank: number }) => [row.demandId, row.rank])).toEqual([
          [(first + 2n).toString(), 1], [(first + 1n).toString(), 2],
        ]);
      }
      const filtered = await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: '{"minBounty":"5.000000","limit":1,"sort":"deadline"}' });
      const filteredBody = await filtered.json();
      expect(filteredBody.analysis.poolSize).toBe(3);
      expect(filteredBody.opportunities[0]).toMatchObject({ demandId: (first + 2n).toString(), rank: 1 });
      const emptied = await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: '{"minBounty":"5.000001"}' });
      expect(await emptied.json()).toMatchObject({ analysis: { poolSize: 0 }, opportunities: [] });
    });
  });

  test("paid reasoning qualifies quartiles by pool variation and explains rounded score ties", async () => {
    const now = BigInt(fixedNow / 1000);
    type ReasoningRow = {
      demandId: string;
      score: number;
      rank: number;
      scoreBreakdown: {
        funding: { percentile: number; contribution: number };
        expectedCalls: { percentile: number; contribution: number };
        supporters: { percentile: number; contribution: number };
        deadlineFreshness: { factor: number; contribution: number };
      };
      reasoning: { positive: string[]; cautions: string[] };
    };
    const getRows = async (entries: IndexEntry[], limit = 20) => {
      let rows: ReasoningRow[] = [];
      await routeFixture(entries, async (base) => {
        const response = await fetch(base + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minSupporters: 0, limit }) });
        const body: { opportunities: ReasoningRow[] } = await response.json();
        rows = body.opportunities;
      });
      return rows;
    };
    const tiedEconomics = [1n, 2n, 3n].map((id) => syntheticEntry(id, { committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: now + 50_000n }));
    const tiedRows = await getRows(tiedEconomics, 1);
    expect(tiedRows[0].score).toBe(0.001929);
    expect(tiedRows[0].rank).toBe(1);
    expect(tiedRows[0].reasoning.positive.join(" ")).not.toContain("upper quartile");
    expect(tiedRows[0].reasoning.cautions.join(" ")).not.toContain("lower quartile");
    expect(tiedRows[0].reasoning.cautions.join(" ")).toContain("economic factors are tied");
    expect(tiedRows[0].reasoning.cautions.join(" ")).toContain("Rounded scores are tied");
    expect(tiedRows[0].scoreBreakdown).toEqual({
      funding: { percentile: 0, contribution: 0 },
      expectedCalls: { percentile: 0, contribution: 0 },
      supporters: { percentile: 0, contribution: 0 },
      deadlineFreshness: { factor: 0.019290123456790122, contribution: 0.0019290123456790122 },
    });

    const deadlines = [now + 86_400n, now + 30n * 86_400n].map((deadline, index) => syntheticEntry(BigInt(index + 1), {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline,
    }));
    const deadlineRows = await getRows(deadlines);
    expect(deadlineRows.map((row) => [row.demandId, row.score, row.rank])).toEqual([["2", 0.1, 1], ["1", 0.003333, 2]]);
    expect(deadlineRows[0].reasoning.cautions.join(" ")).toContain("Deadline freshness distinguishes rounded scores");
    expect(deadlineRows[0].reasoning.cautions.join(" ")).toContain("economic factors are tied");
    expect(deadlineRows[0].reasoning.cautions.join(" ")).not.toContain("Rounded scores are tied");

    const cappedDeadlines = [31n, 60n].map((days, index) => syntheticEntry(BigInt(index + 1), {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: now + days * 86_400n,
    }));
    const cappedRows = await getRows(cappedDeadlines);
    expect(cappedRows.map((row) => [row.demandId, row.score, row.rank])).toEqual([["2", 0.1, 1], ["1", 0.1, 2]]);
    expect(cappedRows[0].reasoning.cautions.join(" ")).toContain("Rounded scores are tied");
    expect(cappedRows[0].reasoning.cautions.join(" ")).not.toContain("Deadline freshness distinguishes");

    const tinyDeadlineChange = [50_000n, 50_001n].map((seconds, index) => syntheticEntry(BigInt(index + 1), {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: now + seconds,
    }));
    const tinyRows = await getRows(tinyDeadlineChange);
    expect(tinyRows.map((row) => [row.demandId, row.score, row.rank])).toEqual([["2", 0.001929, 1], ["1", 0.001929, 2]]);
    expect(tinyRows[0].reasoning.cautions.join(" ")).toContain("Rounded scores are tied");
    expect(tinyRows[0].reasoning.cautions.join(" ")).not.toContain("Deadline freshness distinguishes");

    for (const variableFactor of ["funding", "expectedCalls", "supporters"] as const) {
      const entries = [1n, 2n, 3n].map((id) => syntheticEntry(id, {
        committed: variableFactor === "funding" ? id * 1_000_000n : 5_000_000n,
        expectedCalls: variableFactor === "expectedCalls" ? id : 10n,
        supporterCount: variableFactor === "supporters" ? Number(id) : 2,
        deadline: now + 50_000n,
      }));
      const rows = await getRows(entries, 1);
      const top = rows[0];
      const positive = top.reasoning.positive.join(" ");
      const cautions = top.reasoning.cautions.join(" ");
      const claims: Record<typeof variableFactor, [string, string]> = {
        funding: ["Current escrow ranks in the upper quartile", "Current escrow is at or below the lower quartile"],
        expectedCalls: ["Historical expected calls rank in the upper quartile", "Historical expected calls are at or below the lower quartile"],
        supporters: ["Historical supporter count ranks in the upper quartile", "Historical supporter count is at or below the lower quartile"],
      };
      expect(positive).toContain(claims[variableFactor][0]);
      const low = (await getRows(entries)).find((row) => row.demandId === "1")!;
      expect(low.reasoning.cautions.join(" ")).toContain(claims[variableFactor][1]);
      for (const factor of ["funding", "expectedCalls", "supporters"] as const) {
        if (factor === variableFactor) continue;
        const [upper, lower] = claims[factor];
        expect(`${positive} ${cautions}`).not.toContain(upper);
        expect(`${positive} ${cautions}`).not.toContain(lower);
      }
    }

    const largeIds = [9_007_199_254_740_993n, 9_007_199_254_740_994n].map((id) => syntheticEntry(id, {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: now + 31n * 86_400n,
    }));
    const largeIdRows = await getRows(largeIds);
    expect(largeIdRows.map((row) => [row.demandId, row.score, row.rank])).toEqual([
      ["9007199254740994", 0.1, 1], ["9007199254740993", 0.1, 2],
    ]);

    const singleton = await getRows([syntheticEntry(9_007_199_254_740_993n, {
      committed: 5_000_000n, expectedCalls: 10n, supporterCount: 2, deadline: now + 50_000n,
    })]);
    const singletonMessages = `${singleton[0].reasoning.positive.join(" ")} ${singleton[0].reasoning.cautions.join(" ")}`;
    expect(singleton[0].rank).toBe(1);
    expect(singletonMessages).toContain("Only one demand matches");
    expect(singletonMessages).not.toContain("economic factors are tied");
    expect(singletonMessages).not.toContain("Rounded scores are tied");
    expect(singletonMessages).not.toContain("Deadline freshness distinguishes");
  });

  test("singleton zeros and exact large bigint signals remain explicit", async () => {
    const id = 9_007_199_254_740_993n;
    const zeroEntry = syntheticEntry(id, { committed: 0n, expectedCalls: 0n, supporterCount: 0, deadline: BigInt(fixedNow / 1000) + 500n });
    await routeFixture([zeroEntry], async (url) => {
      const zeroResponse = await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: '{"minSupporters":0}' });
      const zeroBody = await zeroResponse.json();
      const zero = zeroBody.opportunities[0];
      expect(zeroBody.analysis.poolSize).toBe(1);
      expect(zero.rank).toBe(1);
      expect(zero.economicSignals).toMatchObject({ escrowPerExpectedCall: null, timeRemainingSeconds: "500", review: null });
      expect(zero.reasoning.positive).toContain("Open demand can receive builder proposals before its deadline.");
      expect(zero.reasoning.cautions.join(" ")).toContain("Only one demand matches");
      expect(zero.reasoning.cautions.join(" ")).toContain("No current escrow");
      expect(zero.reasoning.cautions.join(" ")).toContain("No supporters");
      expect(zero.reasoning.cautions.join(" ")).toContain("No expected calls");
    });

    const hugeEscrow = (1n << 128n) - 1n, hugeCalls = (1n << 64n) - 1n, hugeDeadline = (1n << 64n) - 1n;
    await routeFixture([syntheticEntry(id, { committed: hugeEscrow, expectedCalls: hugeCalls, supporterCount: 0xffff_ffff, deadline: hugeDeadline })], async (url) => {
      const response = await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: '{"minSupporters":0}' });
      const body = await response.json();
      const row = body.opportunities[0];
      expect(row.currentEscrow).toBe(formatUnits6(hugeEscrow));
      expect(row.economicSignals.escrowPerExpectedCall).toBe(formatUnits6(hugeEscrow / hugeCalls));
      expect(row.economicSignals.timeRemainingSeconds).toBe((hugeDeadline - BigInt(fixedNow / 1000)).toString());
      expect(row.deadline).toBeNull();
    });
  });

  test("submitted review signals, fractional contributions, and fulfillment cautions are accurate", async () => {
    const now = BigInt(fixedNow / 1000);
    const entries = [
      syntheticEntry(1n, { committed: 1n, expectedCalls: 1n, supporterCount: 1, deadline: now + 10n }),
      syntheticEntry(2n, { committed: 2n, expectedCalls: 2n, supporterCount: 2, deadline: now + 20n }),
      syntheticEntry(3n, { committed: 3n, expectedCalls: 3n, supporterCount: 3, deadline: now + 30n,
        status: 1, approvalRequired: 2_000_001n, approvalWeight: 2_000_001n, rejectionThreshold: 4_000_000n,
        rejectionWeight: 500_000n, reviewEndsAt: now + 100n, quorumReached: true }),
      syntheticEntry(4n, { committed: 4n, expectedCalls: 4n, supporterCount: 4, deadline: now + 40n }),
      syntheticEntry(5n, { committed: 5n, expectedCalls: 5n, supporterCount: 5, status: 2, reviewCommitted: 3_000_000n }),
      syntheticEntry(6n, { committed: 3n, expectedCalls: 3n, supporterCount: 3, deadline: now + 25n }),
      syntheticEntry(7n, { committed: 6n, expectedCalls: 6n, supporterCount: 6, status: 1, deadline: now + 70n,
        reviewEndsAt: now + 80n, approvalRequired: 2_000_000n, approvalWeight: 500_000n,
        rejectionThreshold: 4_000_000n, rejectionWeight: 4_000_000n, candidateRejected: true }),
      syntheticEntry(8n, { committed: 7n, expectedCalls: 7n, supporterCount: 7, status: 1, deadline: now - 1n,
        reviewEndsAt: now - 1n, approvalRequired: 2_000_000n, approvalWeight: 500_000n,
        rejectionThreshold: 4_000_000n, rejectionWeight: 1_000_000n }),
      syntheticEntry(9n, { committed: 8n, expectedCalls: 8n, supporterCount: 8, status: 1, deadline: now + 90n,
        reviewEndsAt: now + 90n, approvalRequired: 2_000_000n, approvalWeight: 500_000n,
        rejectionThreshold: 4_000_000n, rejectionWeight: 1_000_000n }),
    ];
    await routeFixture(entries, async (url) => {
      const get = async (body: object) => (await fetch(url + "/v1/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      const openPool = await get({ status: "open", sort: "score" });
      const fractional = openPool.opportunities.find((row: { demandId: string }) => row.demandId === "2");
      expect(fractional.scoreBreakdown.funding.percentile).toBe(1 / 3);
      expect(fractional.scoreBreakdown.funding.contribution).toBe(1 / 6);
      expect(Number((fractional.scoreBreakdown.funding.contribution + fractional.scoreBreakdown.expectedCalls.contribution
        + fractional.scoreBreakdown.supporters.contribution + fractional.scoreBreakdown.deadlineFreshness.contribution).toFixed(6))).toBe(fractional.score);
      const top = openPool.opportunities.find((row: { demandId: string }) => row.demandId === "4");
      expect(top.reasoning.positive.join(" ")).toContain("Current escrow ranks in the upper quartile");
      expect(top.reasoning.positive.join(" ")).toContain("Historical expected calls rank in the upper quartile");
      expect(top.reasoning.positive.join(" ")).toContain("Historical supporter count ranks in the upper quartile");
      const low = openPool.opportunities.find((row: { demandId: string }) => row.demandId === "1");
      expect(low.reasoning.positive.join(" ")).not.toContain("upper quartile");
      const submitted = await get({ status: "ready" });
      expect(submitted.opportunities[0].status).toBe("READY");
      expect(submitted.opportunities[0].economicSignals.review).toEqual({ approvalGap: "0.000000", rejectionHeadroom: "3.500000", reviewTimeRemainingSeconds: "100" });
      const inReview = await get({ status: "submitted" });
      expect(inReview.opportunities[0].status).toBe("SUBMITTED");
      expect(inReview.opportunities[0].economicSignals.review).toEqual({ approvalGap: "1.500000", rejectionHeadroom: "3.000000", reviewTimeRemainingSeconds: "90" });
      const rejected = await get({ status: "rejected" });
      expect(rejected.opportunities[0].status).toBe("REJECTED");
      expect(rejected.opportunities[0].economicSignals.review).toEqual({ approvalGap: "1.500000", rejectionHeadroom: "0.000000", reviewTimeRemainingSeconds: "80" });
      const expired = await get({ status: "expired" });
      expect(expired.opportunities[0].status).toBe("EXPIRED");
      expect(expired.opportunities[0].economicSignals.review.reviewTimeRemainingSeconds).toBe("0");
      const fulfilled = await get({ status: "fulfilled" });
      expect(fulfilled.opportunities[0].economicSignals.review).toBeNull();
      expect(fulfilled.opportunities[0].reasoning.cautions.join(" ")).toContain("Residual escrow may be refundable");
    });
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
      const browser = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, {
        method: "POST", headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
      });
      expect(browser.status).toBe(402);
      expect(browser.headers.get("content-type")).toContain("text/html");
      expect(browser.headers.get("payment-required")).toBeNull();
      const alias = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities/`, {
        method: "POST", headers: { accept: "application/json" },
      });
      expect(alias.status).toBe(402);
      expect(alias.headers.get("payment-required")).toBeTruthy();
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

  test("handles zero and extreme bigint values without losing precision", () => {
    const now = 1_700_000_000n;
    const zero = { committed: 0n, expectedCalls: 0n, supporters: 0, deadlineUnix: now };
    expect(scoreOpportunity(zero, [zero], now)).toBe(0.9);
    const huge = { committed: (1n << 255n), expectedCalls: (1n << 255n), supporters: 0xffff_ffff, deadlineUnix: now + 2_592_000n };
    const pool = [zero, huge];
    expect(scoreOpportunity(huge, pool, now)).toBe(1);
  });
});

describe("effective opportunity statuses", () => {
  test("preserves review, deadline, quorum, rejection, fulfillment and closure precedence", () => {
    const now = 1_700_000_000n;
    const make = (id: bigint, status: number, overrides: Partial<IndexEntry> = {}): IndexEntry => ({
      demandId: id,
      data: { creator: testContract, builder: testContract, maxUnitPrice: 0n, committed: id, reviewCommitted: 0n,
        approvalRequired: 0n, expectedCalls: 0n, deadline: now + 10n, reviewEndsAt: now + 20n,
        supporterCount: 0, status, capability: "fixture", specification: "", serviceUrl: "", evidenceHash: `0x${"0".repeat(64)}` },
      approvalWeight: 0n, approvalRequired: 0n, quorumReached: false, rejectionWeight: 0n,
      rejectionThreshold: 0n, candidateRejected: false, ...overrides,
    });
    const entries = [
      make(1n, 0, { data: { ...make(1n, 0).data, deadline: now - 1n } }),
      make(2n, 1, { quorumReached: true }),
      make(3n, 1, { candidateRejected: true }),
      make(4n, 1, { data: { ...make(4n, 1).data, deadline: now - 1n } }),
      make(5n, 1, { data: { ...make(5n, 1).data, deadline: now - 1n, reviewEndsAt: now - 1n } }),
      make(6n, 2),
      make(7n, 3),
    ];
    const rows = filterAndSort(entries, { minBounty: 0n, minSupporters: 0, sort: "bounty", limit: 50 }, now);
    expect(Object.fromEntries(rows.map((row) => [row.demandId, row.status]))).toEqual({
      "1": "EXPIRED", "2": "READY", "3": "REJECTED", "4": "SUBMITTED", "5": "EXPIRED", "6": "FULFILLED", "7": "CLOSED",
    });
  });

  test("orders extended ISO years by deadline and keeps out-of-range dates last", () => {
    const make = (id: bigint, deadline: bigint): IndexEntry => ({
      demandId: id,
      data: { creator: testContract, builder: testContract, maxUnitPrice: 0n, committed: id, reviewCommitted: 0n,
        approvalRequired: 0n, expectedCalls: 0n, deadline, reviewEndsAt: 0n, supporterCount: 0, status: 0,
        capability: "fixture", specification: "", serviceUrl: "", evidenceHash: `0x${"0".repeat(64)}` },
      approvalWeight: 0n, approvalRequired: 0n, quorumReached: false, rejectionWeight: 0n,
      rejectionThreshold: 0n, candidateRejected: false,
    });
    const y9999 = BigInt(Date.parse("9999-12-31T23:59:59.000Z") / 1000);
    const y10000 = BigInt(Date.parse("+010000-01-01T00:00:00.000Z") / 1000);
    const rows = filterAndSort([make(1n, y10000), make(2n, y9999), make(3n, (1n << 64n) - 1n)],
      { minBounty: 0n, minSupporters: 0, sort: "deadline", limit: 50 }, 1n);
    expect(rows.map((row) => row.demandId)).toEqual(["2", "1", "3"]);
    expect(rows[1]?.deadline).toBe("+010000-01-01T00:00:00.000Z");
    expect(rows[2]?.deadline).toBeNull();
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
