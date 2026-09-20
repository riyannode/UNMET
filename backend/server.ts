import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { decodeEventLog, getAddress, type Address, type PublicClient } from "viem";
import {
  AGENT_DEMAND_ABI,
  formatUnits6,
  getPublicClient,
  isoFromUnix,
  loadConfig,
  parseUnits6,
  readApprovalProgress,
  readDemand,
  readNextDemandId,
  readRejectionProgress,
  statusLabel,
  type DemandTuple,
} from "./contract.ts";

const cfg = loadConfig();

type IndexEntry = {
  demandId: bigint;
  data: DemandTuple;
  approvalWeight: bigint;
  approvalRequired: bigint;
  quorumReached: boolean;
  rejectionWeight: bigint;
  rejectionThreshold: bigint;
  candidateRejected: boolean;
};

type ScoreInput = {
  committed: bigint;
  expectedCalls: bigint;
  supporters: number;
  deadlineUnix: bigint;
};

type Opportunity = {
  demandId: string;
  capability: string;
  currentEscrow: string;
  fundedBounty: string;
  reviewCommitted: string;
  supporters: number;
  expectedCalls: string;
  maxUnitPrice: string;
  deadline: string | null;
  status: string;
  creator: string;
  builder: string;
  approvalWeight: string;
  approvalRequired: string;
  rejectionWeight: string;
  rejectionThreshold: string;
  candidateRejected: boolean;
  score: number;
};

type QueryInput = {
  minBounty: bigint;
  minSupporters: number;
  status?: string;
  sort: "bounty" | "supporters" | "calls" | "deadline" | "score";
  limit: number;
};

const memoryIndex = new Map<string, IndexEntry>();
let indexReady = false;
let lastIndexedBlock = 0n;
let lastIndexedBlockHash: `0x${string}` | null = null;
let refreshPromise: Promise<void> | null = null;

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

function allowedOrigins(): Set<string> {
  const configured = (process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== "production") configured.push("http://localhost:5173", "http://127.0.0.1:5173");
  return new Set(configured);
}

function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,payment-signature,payment-required,payment-response");
  res.setHeader("access-control-expose-headers", "payment-required,payment-response");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function secureHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  next();
}

function requestLog(req: Request, res: Response, next: NextFunction) {
  const start = performance.now();
  const requestId = req.get("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    log({
      level: "info",
      requestId,
      route: `${req.method} ${req.path}`,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
    });
  });
  next();
}

async function readEntry(client: PublicClient, contract: Address, demandId: bigint): Promise<IndexEntry> {
  const [data, progress, rejection] = await Promise.all([
    readDemand(client, contract, demandId),
    readApprovalProgress(client, contract, demandId),
    readRejectionProgress(client, contract, demandId),
  ]);
  return {
    demandId,
    data,
    approvalWeight: progress[0],
    approvalRequired: progress[1],
    quorumReached: progress[2],
    rejectionWeight: rejection[0],
    rejectionThreshold: rejection[1],
    candidateRejected: rejection[2],
  };
}

async function mapInChunks(ids: bigint[], size: number, task: (id: bigint) => Promise<void>) {
  for (let i = 0; i < ids.length; i += size) {
    await Promise.all(ids.slice(i, i + size).map(task));
  }
}

async function rebuildIndex(client: PublicClient, contract: Address) {
  const [nextId, block] = await Promise.all([readNextDemandId(client, contract), client.getBlock()]);
  const fresh = new Map<string, IndexEntry>();
  const ids: bigint[] = [];
  for (let id = 1n; id < nextId; id += 1n) ids.push(id);

  await mapInChunks(ids, 20, async (id) => {
    const entry = await readEntry(client, contract, id);
    fresh.set(id.toString(), entry);
  });

  memoryIndex.clear();
  for (const [key, value] of fresh) memoryIndex.set(key, value);
  lastIndexedBlock = block.number;
  lastIndexedBlockHash = block.hash;
  indexReady = true;
  log({ level: "info", event: "index_rebuilt", demands: memoryIndex.size, block: block.number.toString(), blockHash: block.hash });
}

async function changedDemandIds(client: PublicClient, contract: Address, fromBlock: bigint, toBlock: bigint): Promise<Set<bigint>> {
  if (fromBlock > toBlock) return new Set();
  const logs = await client.getLogs({ address: contract, fromBlock, toBlock });
  const ids = new Set<bigint>();
  for (const entry of logs) {
    try {
      const decoded = decodeEventLog({ abi: AGENT_DEMAND_ABI, data: entry.data, topics: entry.topics, strict: false });
      const args = decoded.args as Record<string, unknown> | undefined;
      const demandId = args?.demandId;
      if (typeof demandId === "bigint") ids.add(demandId);
    } catch {
      // Unknown event from a future contract version: force a full read on next restart, but do not corrupt current state.
    }
  }
  return ids;
}

async function refreshIndex(client: PublicClient, contract: Address) {
  if (!indexReady) {
    await rebuildIndex(client, contract);
    return;
  }

  const current = await client.getBlock();
  const currentBlock = current.number;
  if (currentBlock < lastIndexedBlock) {
    await rebuildIndex(client, contract);
    return;
  }
  if (lastIndexedBlock > 0n && lastIndexedBlockHash) {
    const indexed = await client.getBlock({ blockNumber: lastIndexedBlock });
    if (indexed.hash !== lastIndexedBlockHash) {
      await rebuildIndex(client, contract);
      return;
    }
  }
  if (currentBlock === lastIndexedBlock) return;

  const ids = await changedDemandIds(client, contract, lastIndexedBlock + 1n, currentBlock);
  const nextId = await readNextDemandId(client, contract);
  for (let id = 1n; id < nextId; id += 1n) {
    if (!memoryIndex.has(id.toString())) ids.add(id);
  }

  await mapInChunks([...ids], 20, async (id) => {
    memoryIndex.set(id.toString(), await readEntry(client, contract, id));
  });
  lastIndexedBlock = currentBlock;
  lastIndexedBlockHash = current.hash;
}

async function ensureIndex(client: PublicClient) {
  if (!cfg.contract) throw new Error("DEMAND_CONTRACT not configured");
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshIndex(client, cfg.contract).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function percentileBig(values: bigint[], value: bigint): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 1;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let below = 0;
  for (const item of sorted) if (item < value) below += 1;
  return below / (sorted.length - 1);
}

function percentileNumber(values: number[], value: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  for (const item of sorted) if (item < value) below += 1;
  return below / (sorted.length - 1);
}

export function scoreOpportunity(item: ScoreInput, pool: ScoreInput[], nowUnix: bigint): number {
  const horizon = 30n * 24n * 3600n;
  const remaining = item.deadlineUnix > nowUnix ? item.deadlineUnix - nowUnix : 0n;
  const freshness = Number(remaining > horizon ? horizon : remaining) / Number(horizon);
  return 0.5 * percentileBig(pool.map((p) => p.committed), item.committed)
    + 0.25 * percentileBig(pool.map((p) => p.expectedCalls), item.expectedCalls)
    + 0.15 * percentileNumber(pool.map((p) => p.supporters), item.supporters)
    + 0.1 * freshness;
}

function raw(entry: IndexEntry): ScoreInput {
  return {
    committed: entry.data.committed,
    expectedCalls: entry.data.expectedCalls,
    supporters: Number(entry.data.supporterCount),
    deadlineUnix: entry.data.deadline,
  };
}

function effectiveStatus(entry: IndexEntry, nowUnix: bigint): string {
  const base = statusLabel(Number(entry.data.status));
  if (base === "FULFILLED" || base === "CLOSED") return base;
  if (base === "SUBMITTED" && entry.quorumReached) return "READY";
  if (nowUnix >= entry.data.deadline) {
    if (base === "OPEN") return "EXPIRED";
    if (base === "SUBMITTED" && (nowUnix >= entry.data.reviewEndsAt || entry.candidateRejected)) return "EXPIRED";
  }
  if (base === "SUBMITTED" && entry.candidateRejected) return "REJECTED";
  return base;
}

function toOpportunity(entry: IndexEntry, pool: ScoreInput[], nowUnix: bigint): Opportunity {
  return {
    demandId: entry.demandId.toString(),
    capability: entry.data.capability,
    currentEscrow: formatUnits6(entry.data.committed),
    fundedBounty: formatUnits6(entry.data.reviewCommitted === 0n ? entry.data.committed : entry.data.reviewCommitted),
    reviewCommitted: formatUnits6(entry.data.reviewCommitted),
    supporters: Number(entry.data.supporterCount),
    expectedCalls: entry.data.expectedCalls.toString(),
    maxUnitPrice: formatUnits6(entry.data.maxUnitPrice),
    deadline: isoFromUnix(entry.data.deadline),
    status: effectiveStatus(entry, nowUnix),
    creator: entry.data.creator,
    builder: entry.data.builder,
    approvalWeight: entry.approvalWeight.toString(),
    approvalRequired: entry.approvalRequired.toString(),
    rejectionWeight: entry.rejectionWeight.toString(),
    rejectionThreshold: entry.rejectionThreshold.toString(),
    candidateRejected: entry.candidateRejected,
    score: Number(scoreOpportunity(raw(entry), pool, nowUnix).toFixed(6)),
  };
}

const SORTS = new Set(["bounty", "supporters", "calls", "deadline", "score"]);
const STATUSES = new Set(["open", "submitted", "ready", "rejected", "expired", "fulfilled", "closed"]);

export function validateOpportunitiesInput(body: unknown): { ok: true; value: QueryInput } | { ok: false; code: string; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_JSON", message: "Body must be a JSON object" };
  }
  const input = body as Record<string, unknown>;
  let minBounty = 0n;
  if (input.minBounty !== undefined) {
    if (typeof input.minBounty !== "string") return { ok: false, code: "INVALID_JSON", message: "minBounty must be a decimal string" };
    try { minBounty = parseUnits6(input.minBounty); }
    catch { return { ok: false, code: "INVALID_JSON", message: "minBounty must have at most 6 decimals" }; }
  }

  const minSupporters = input.minSupporters === undefined ? 1 : input.minSupporters;
  if (typeof minSupporters !== "number" || !Number.isSafeInteger(minSupporters) || minSupporters < 0 || minSupporters > 0xffff_ffff) {
    return { ok: false, code: "INVALID_JSON", message: "minSupporters must be a non-negative uint32 integer" };
  }

  const sort = input.sort === undefined ? "bounty" : input.sort;
  if (typeof sort !== "string" || !SORTS.has(sort)) {
    return { ok: false, code: "INVALID_SORT", message: "sort must be bounty|supporters|calls|deadline|score" };
  }

  const limit = input.limit === undefined ? 10 : input.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, code: "INVALID_LIMIT", message: "limit must be between 1 and 50" };
  }

  let status: string | undefined = "open";
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !STATUSES.has(input.status.toLowerCase())) {
      return { ok: false, code: "INVALID_STATUS", message: "status must be open|submitted|ready|rejected|expired|fulfilled|closed" };
    }
    status = input.status.toLowerCase();
  }

  return { ok: true, value: { minBounty, minSupporters, status, sort: sort as QueryInput["sort"], limit } };
}

export function filterAndSort(entries: IndexEntry[], input: QueryInput, nowUnix = BigInt(Math.floor(Date.now() / 1000))): Opportunity[] {
  const filtered = entries.filter((entry) => {
    if (entry.data.committed < input.minBounty) return false;
    if (Number(entry.data.supporterCount) < input.minSupporters) return false;
    if (input.status && effectiveStatus(entry, nowUnix).toLowerCase() !== input.status) return false;
    return true;
  });
  const pool = filtered.map(raw);
  const scored = filtered.map((entry) => toOpportunity(entry, pool, nowUnix));
  scored.sort((a, b) => {
    if (input.sort === "supporters") return b.supporters - a.supporters || compareIdDesc(a.demandId, b.demandId);
    if (input.sort === "calls") return compareBigDesc(BigInt(a.expectedCalls), BigInt(b.expectedCalls)) || compareIdDesc(a.demandId, b.demandId);
    if (input.sort === "deadline") {
      if (a.deadline === null || b.deadline === null) {
        if (a.deadline !== b.deadline) return a.deadline === null ? 1 : -1;
      } else {
        const byDeadline = Date.parse(a.deadline) - Date.parse(b.deadline);
        if (byDeadline !== 0) return byDeadline;
      }
      return compareIdDesc(a.demandId, b.demandId);
    }
    if (input.sort === "score") return b.score - a.score || compareIdDesc(a.demandId, b.demandId);
    return compareBigDesc(parseUnits6(a.currentEscrow), parseUnits6(b.currentEscrow)) || compareIdDesc(a.demandId, b.demandId);
  });
  return scored.slice(0, input.limit);
}

function compareBigDesc(a: bigint, b: bigint): number { return b > a ? 1 : b < a ? -1 : 0; }
function compareIdDesc(a: string, b: string): number { return compareBigDesc(BigInt(a), BigInt(b)); }

function requirePaymentEnv() {
  const apiKey = process.env.OKX_API_KEY;
  const secretKey = process.env.OKX_SECRET_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  const payToRaw = process.env.OKX_PAY_TO || process.env.PAY_TO_ADDRESS;
  if (!apiKey || !secretKey || !passphrase || !payToRaw) {
    throw new Error("OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE and OKX_PAY_TO are required");
  }
  const priceRaw = process.env.OPPORTUNITY_PRICE || "0.01";
  if (!/^\d+(\.\d{1,6})?$/.test(priceRaw)) throw new Error("OPPORTUNITY_PRICE must be a decimal amount with <=6 decimals");
  return {
    apiKey,
    secretKey,
    passphrase,
    payTo: getAddress(payToRaw),
    price: `$${priceRaw}`,
    network: `eip155:${cfg.chainId}` as `eip155:${number}`,
  };
}

async function createPaymentMiddleware(): Promise<RequestHandler> {
  const pay = requirePaymentEnv();
  const facilitatorClient = new OKXFacilitatorClient({
    apiKey: pay.apiKey,
    secretKey: pay.secretKey,
    passphrase: pay.passphrase,
    syncSettle: true,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(pay.network, new ExactEvmScheme());
  await resourceServer.initialize();

  return paymentMiddleware({
    "POST /v1/opportunities": {
      accepts: [{
        scheme: "exact",
        network: pay.network,
        payTo: pay.payTo,
        price: pay.price,
      }],
      description: "Rank funded AI-agent capabilities that still need builders",
      mimeType: "application/json",
    },
  }, resourceServer);
}

let vercelPaymentMiddlewarePromise: Promise<RequestHandler> | null = null;
const lazyPaymentMiddleware: RequestHandler = (req, res, next) => {
  const pending = vercelPaymentMiddlewarePromise ??= createPaymentMiddleware();
  void pending.then((middleware) => middleware(req, res, next)).catch((error: unknown) => {
    if (vercelPaymentMiddlewarePromise === pending) vercelPaymentMiddlewarePromise = null;
    next(error);
  });
};

export function createApp(payment: { middleware: RequestHandler } | null = null) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestLog);
  app.use(secureHeaders);
  app.use(cors);
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/health", async (_req, res) => {
    if (!cfg.contract) {
      res.status(503).json({ ok: false, error: { code: "CHAIN_CONTRACT_UNCONFIGURED", message: "DEMAND_CONTRACT not configured" } });
      return;
    }
    try {
      const client = getPublicClient();
      const [latestBlock, bytecode] = await Promise.all([
        client.getBlockNumber(),
        client.getBytecode({ address: cfg.contract }),
      ]);
      if (!bytecode || bytecode === "0x") throw new Error("contract bytecode missing");
      res.json({ ok: true, name: "UNMET", chainId: cfg.chainId, contract: cfg.contract, latestBlock: latestBlock.toString() });
    } catch {
      res.status(503).json({ ok: false, error: { code: "CHAIN_RPC_UNAVAILABLE", message: "RPC or contract unavailable" } });
    }
  });

  app.get("/v1/demands", async (_req, res, next) => {
    try {
      if (!cfg.contract) throw new Error("DEMAND_CONTRACT not configured");
      const client = getPublicClient();
      await ensureIndex(client);
      const entries = [...memoryIndex.values()];
      const demands = filterAndSort(entries, { minBounty: 0n, minSupporters: 0, sort: "bounty", limit: 50 });
      res.json({ chainId: cfg.chainId, contract: cfg.contract, blockNumber: lastIndexedBlock.toString(), generatedAt: new Date().toISOString(), demands });
    } catch (error) { next(error); }
  });

  if (payment) app.post("/v1/opportunities", payment.middleware);

  app.post("/v1/opportunities", async (req, res, next) => {
    try {
      const parsed = validateOpportunitiesInput(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: { code: parsed.code, message: parsed.message } });
        return;
      }
      if (!cfg.contract) throw new Error("DEMAND_CONTRACT not configured");
      const client = getPublicClient();
      await ensureIndex(client);
      const opportunities = filterAndSort([...memoryIndex.values()], parsed.value);
      res.json({
        chainId: cfg.chainId,
        contract: cfg.contract,
        blockNumber: lastIndexedBlock.toString(),
        generatedAt: new Date().toISOString(),
        opportunities,
      });
    } catch (error) { next(error); }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log({ level: "error", event: "request_error", error: error instanceof Error ? error.message : String(error) });
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
      return;
    }
    res.status(503).json({ error: { code: "CHAIN_RPC_UNAVAILABLE", message: "Service temporarily unavailable" } });
  });
  return app;
}

export const app = createApp({ middleware: lazyPaymentMiddleware });
export default app;

export async function startServer() {
  if (!cfg.contract) throw new Error("DEMAND_CONTRACT is required before server start");
  const pay = requirePaymentEnv();
  const middleware = await createPaymentMiddleware();
  const app = createApp({ middleware });
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(port, host, () => {
    log({ level: "info", event: "listen", host, port, chainId: cfg.chainId, contract: cfg.contract, paymentNetwork: pay.network });
  });

  const shutdown = (signal: string) => {
    log({ level: "info", event: "shutdown", signal });
    server.close((error) => process.exit(error ? 1 : 0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (import.meta.main) await startServer();
