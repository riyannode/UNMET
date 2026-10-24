import { durablePayment } from "./durable-payment.ts";
import { MAINNET_ASSETS } from "./payment-identity.ts";
import type { PaymentStore } from "./payment-store.ts";
import { PaymentError } from "./payment-error.ts";
import { loadOperationalConfig, type OperationalConfig } from "./config.ts";
import { admittedWork, concurrencyGate, rateLimiter } from "./admission.ts";
import { createBoundedFetch, withBoundedFetch } from "./upstream.ts";
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
const operations = loadOperationalConfig();

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

export type DemandIndexState = {
  entries: Map<string, IndexEntry>;
  ready: boolean;
  lastIndexedBlock: bigint;
  lastIndexedBlockHash: `0x${string}` | null;
};

export function createDemandIndexState(): DemandIndexState {
  return { entries: new Map(), ready: false, lastIndexedBlock: 0n, lastIndexedBlockHash: null };
}

const demandIndex = createDemandIndexState();
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
  res.setHeader("access-control-allow-headers", "content-type,payment-signature,payment-required,payment-response,idempotency-key");
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
  const requestId = crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    log({
      level: "info",
      requestId,
      route: `${req.method} ${req.route?.path || "unmatched"}`,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
    });
  });
  next();
}

async function readEntry(client: PublicClient, contract: Address, demandId: bigint, blockNumber: bigint): Promise<IndexEntry> {
  const [data, progress, rejection] = await Promise.allSettled([
    readDemand(client, contract, demandId, blockNumber),
    readApprovalProgress(client, contract, demandId, blockNumber),
    readRejectionProgress(client, contract, demandId, blockNumber),
  ]);
  if (data.status === "rejected") throw data.reason;
  if (progress.status === "rejected") throw progress.reason;
  if (rejection.status === "rejected") throw rejection.reason;
  return {
    demandId,
    data: data.value,
    approvalWeight: progress.value[0],
    approvalRequired: progress.value[1],
    quorumReached: progress.value[2],
    rejectionWeight: rejection.value[0],
    rejectionThreshold: rejection.value[1],
    candidateRejected: rejection.value[2],
  };
}

async function mapInChunks(ids: bigint[], size: number, task: (id: bigint) => Promise<void>) {
  for (let i = 0; i < ids.length; i += size) {
    const results = await Promise.allSettled(ids.slice(i, i + size).map(task));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

function indexBudget(config: OperationalConfig) {
  const deadline = performance.now() + config.indexBudgetMs;
  return () => {
    if (performance.now() >= deadline) throw new Error("INDEX_BUDGET_EXCEEDED");
  };
}

async function rebuildIndex(client: PublicClient, contract: Address, state: DemandIndexState, config: OperationalConfig, check: () => void) {
  check();
  const block = await client.getBlock();
  check();
  const nextId = await readNextDemandId(client, contract, block.number);
  check();
  if (nextId < 1n || nextId - 1n > BigInt(config.indexMaxDemands)) throw new Error("INDEX_CAPACITY");
  const fresh = new Map<string, IndexEntry>();
  for (let first = 1n; first < nextId; first += BigInt(config.indexBatchSize)) {
    check();
    const ids: bigint[] = [];
    for (let id = first; id < nextId && ids.length < config.indexBatchSize; id++) ids.push(id);
    await mapInChunks(ids, config.indexBatchSize, async (id) => {
      fresh.set(id.toString(), await readEntry(client, contract, id, block.number));
    });
  }
  check();
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash !== block.hash) throw new Error("INDEX_REORG");
  check();
  state.entries = fresh;
  state.lastIndexedBlock = block.number;
  state.lastIndexedBlockHash = block.hash;
  state.ready = true;
  log({ level: "info", event: "index_rebuilt", demands: state.entries.size, block: block.number.toString(), blockHash: block.hash });
}

export async function changedDemandIds(client: PublicClient, contract: Address, fromBlock: bigint, toBlock: bigint, config = operations, check: () => void = () => {}): Promise<Set<bigint>> {
  if (fromBlock > toBlock) return new Set();
  if ((toBlock - fromBlock) / 100n + 1n > BigInt(config.indexMaxLogWindows)) throw new Error("INDEX_BUDGET_EXCEEDED");
  const ids = new Set<bigint>();
  for (let start = fromBlock; start <= toBlock;) {
    check();
    const end = start + 99n > toBlock ? toBlock : start + 99n;
    const logs = await client.getLogs({ address: contract, fromBlock: start, toBlock: end });
    if (logs.length > config.indexMaxDemands * 10) throw new Error("INDEX_CAPACITY");
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
    if (ids.size > config.indexMaxDemands) throw new Error("INDEX_CAPACITY");
    start = end + 1n;
  }
  return ids;
}

export async function refreshIndex(client: PublicClient, contract: Address, state: DemandIndexState, config = operations) {
  const check = indexBudget(config);
  if (!state.ready) return rebuildIndex(client, contract, state, config, check);
  const current = await client.getBlock();
  check();
  if (current.number < state.lastIndexedBlock ||
      current.number - state.lastIndexedBlock > BigInt(config.indexMaxLogWindows) * 100n) {
    return rebuildIndex(client, contract, state, config, check);
  }
  if (state.lastIndexedBlockHash) {
    const indexed = await client.getBlock({ blockNumber: state.lastIndexedBlock });
    if (indexed.hash !== state.lastIndexedBlockHash) return rebuildIndex(client, contract, state, config, check);
  }
  if (current.number === state.lastIndexedBlock) return;
  const ids = await changedDemandIds(client, contract, state.lastIndexedBlock + 1n, current.number, config, check);
  const nextId = await readNextDemandId(client, contract, current.number);
  check();
  if (nextId < 1n || nextId - 1n > BigInt(config.indexMaxDemands)) throw new Error("INDEX_CAPACITY");
  for (let id = 1n; id < nextId; id++) if (!state.entries.has(id.toString())) ids.add(id);
  const updates = new Map<string, IndexEntry>();
  await mapInChunks([...ids], config.indexBatchSize, async (id) => {
    check();
    updates.set(id.toString(), await readEntry(client, contract, id, current.number));
  });
  check();
  const canonical = await client.getBlock({ blockNumber: current.number });
  if (canonical.hash !== current.hash) throw new Error("INDEX_REORG");
  check();
  for (const [key, value] of updates) state.entries.set(key, value);
  state.lastIndexedBlock = current.number;
  state.lastIndexedBlockHash = current.hash;
}

let lastRefresh = 0;
async function ensureIndex(client: PublicClient, contract = cfg.contract) {
  if (!contract) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
  if (refreshPromise) return refreshPromise;
  if (demandIndex.ready && Date.now() - lastRefresh < operations.indexRefreshMs) return;
  refreshPromise = refreshIndex(client, contract, demandIndex).then(() => {
    lastRefresh = Date.now();
  }).finally(() => { refreshPromise = null; });
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
  const fields = new Set(["minBounty", "minSupporters", "status", "sort", "limit"]);
  if (Object.keys(input).some((key) => !fields.has(key))) {
    return { ok: false, code: "INVALID_JSON", message: "Unknown filter field" };
  }
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

type X402PaymentEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  X402_CHAIN_ID?: string;
  OPPORTUNITY_PRICE?: string;
};

export function resolveX402PaymentConfig(env: X402PaymentEnv = process.env, coreChainId = cfg.chainId) {
  const isProduction = env.VERCEL_ENV === "production" || (env.VERCEL_ENV !== "preview" && env.NODE_ENV === "production");
  if (isProduction && env.X402_CHAIN_ID !== "196") {
    throw new Error("X402_CHAIN_ID must be explicitly set to 196 in production");
  }
  const x402ChainId = env.X402_CHAIN_ID ?? String(coreChainId);
  if (x402ChainId !== "1952" && x402ChainId !== "196") throw new Error("X402_CHAIN_ID must be 1952 or 196");
  const priceRaw = env.OPPORTUNITY_PRICE || "0.01";
  if (!/^\d+(\.\d{1,6})?$/.test(priceRaw)) throw new Error("OPPORTUNITY_PRICE must be a decimal amount with <=6 decimals");
  const priceAmount = parseUnits6(priceRaw);
  if (x402ChainId === "196" && priceAmount !== parseUnits6("0.01")) throw new Error("CONFIG_INVALID: OPPORTUNITY_PRICE");
  return {
    network: `eip155:${x402ChainId}` as `eip155:${number}`,
    assets: x402ChainId === "196" ? MAINNET_ASSETS.map(({ asset, name, version }) => ({ asset, extra: { name, version } })) : null,
    price: `$${priceRaw}`,
  };
}

export function opportunityPaymentOptions(pay: ReturnType<typeof resolveX402PaymentConfig>, payTo: Address) {
  return pay.assets ? pay.assets.map(({ asset, extra }) => ({
    scheme: "exact" as const, network: pay.network, payTo,
    price: { asset, amount: parseUnits6("0.01").toString(), extra },
  })) : [{ scheme: "exact" as const, network: pay.network, payTo, price: pay.price }];
}

export function paymentStorageGuard(available: boolean): RequestHandler {
  return (req, res, next) => {
    if (!available && (req.get("payment-signature") || req.get("x-payment"))) {
      res.status(503).json({ error: { code: "PAYMENT_STORAGE_UNAVAILABLE", message: "Payment service unavailable" } });
      return;
    }
    next();
  };
}

function requireFacilitatorCredentials() {
  const apiKey = process.env.OKX_API_KEY?.trim();
  const secretKey = process.env.OKX_SECRET_KEY?.trim();
  const passphrase = process.env.OKX_PASSPHRASE?.trim();
  if (!apiKey || !secretKey || !passphrase) throw new Error("OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE are required");
  return { apiKey, secretKey, passphrase };
}

function requirePaymentEnv() {
  const credentials = requireFacilitatorCredentials();
  const payToRaw = process.env.OKX_PAY_TO || process.env.PAY_TO_ADDRESS;
  if (!payToRaw) throw new Error("OKX_PAY_TO is required");
  let payTo: Address;
  try {
    payTo = getAddress(payToRaw);
    if (/^0x0{40}$/i.test(payTo)) throw new Error();
  } catch { throw new Error("CONFIG_INVALID: OKX_PAY_TO"); }
  const payment = resolveX402PaymentConfig();
  return {
    ...credentials,
    payTo,
    ...payment,
  };
}

const facilitatorFetch = createBoundedFetch({
  maxInFlight: operations.maxInFlight,
  timeoutMs: operations.facilitatorTimeoutMs,
  maxBytes: operations.upstreamMaxBytes,
});

async function facilitatorCall<T>(task: () => Promise<T>): Promise<T> {
  try { return await withBoundedFetch(facilitatorFetch, task); }
  catch { throw new Error("PAYMENT_UPSTREAM_UNAVAILABLE"); }
}

let paymentStore: PaymentStore | undefined;
let storageInitialization: Promise<PaymentStore> | undefined;
async function initializePaymentStorage() {
  if (!operations.paymentDbPath) return undefined;
  return storageInitialization ??= import("./payment-store.ts").then(({ PaymentStore }) => {
    const store = new PaymentStore(operations.paymentDbPath!, operations.paymentMaxRecords);
    store.recoverInterrupted();
    store.cleanup(operations.paymentRetentionDays * 86_400_000);
    paymentStore = store;
    return store;
  });
}

export function createOfficialFacilitator() {
  const credentials = requireFacilitatorCredentials();
  const facilitatorClient = new OKXFacilitatorClient({
    ...credentials,
    syncSettle: true,
  });
  return {
    getSupported: () => facilitatorCall(() => facilitatorClient.getSupported()),
    verify: (...args: Parameters<typeof facilitatorClient.verify>) =>
      facilitatorCall(() => facilitatorClient.verify(...args)),
    settle: (...args: Parameters<typeof facilitatorClient.settle>) =>
      facilitatorCall(() => facilitatorClient.settle(...args)),
    getSettleStatus: (...args: Parameters<typeof facilitatorClient.getSettleStatus>) =>
      facilitatorCall(() => facilitatorClient.getSettleStatus(...args)),
  };
}

export async function createPaymentMiddleware(): Promise<RequestHandler & { ready: () => Promise<void> }> {
  const store = await initializePaymentStorage();
  const pay = requirePaymentEnv();
  const boundedFacilitator = createOfficialFacilitator();
  const durable = store ? durablePayment(store, boundedFacilitator) : undefined;
  const resourceServer = new x402ResourceServer(durable?.client || boundedFacilitator).register(pay.network, new ExactEvmScheme());
  await resourceServer.initialize();

  const middleware = paymentMiddleware({
    "POST /v1/opportunities": {
    accepts: opportunityPaymentOptions(pay, pay.payTo),
      description: "Rank funded AI-agent capabilities that still need builders",
      mimeType: "application/json",
    },
  }, resourceServer, undefined, undefined, false);
  const protectedMiddleware = durable ? durable.wrap(middleware) : middleware;
  const storageGuard = paymentStorageGuard(!!store);
  const handler: RequestHandler = (req, res, next) => storageGuard(req, res, (error) => error ? next(error)
    : withBoundedFetch(facilitatorFetch, async () => { await protectedMiddleware(req, res, next); }).catch(next));
  return Object.assign(handler, { ready: async () => {
    if (!store) throw new Error("PAYMENT_STORAGE_UNAVAILABLE");
    store.integrity();
  } });
}

let vercelPaymentMiddlewarePromise: ReturnType<typeof createPaymentMiddleware> | null = null;
const lazyPaymentMiddleware: RequestHandler = (req, res, next) => {
  if (!operations.paymentDbPath && (req.get("payment-signature") || req.get("x-payment"))) {
    res.status(503).json({ error: { code: "PAYMENT_STORAGE_UNAVAILABLE", message: "Payment service unavailable" } });
    return;
  }
  return initializedPayment().then((middleware) => {
    if (req.aborted || res.destroyed) {
      res.statusCode = 503;
      res.end();
      return;
    }
    return middleware(req, res, next);
  }).catch(next);
};

type Payment = { middleware: RequestHandler; ready?: () => Promise<unknown> };

let paymentRetryAt = 0;
function initializedPayment() {
  if (Date.now() < paymentRetryAt) return Promise.reject(new Error("PAYMENT_UNAVAILABLE"));
  return vercelPaymentMiddlewarePromise ??= createPaymentMiddleware().catch((error: unknown) => {
    vercelPaymentMiddlewarePromise = null;
    paymentRetryAt = Date.now() + operations.dependencyCacheMs;
    throw error;
  });
}
const paymentReady = async () => { const middleware = await initializedPayment(); await middleware.ready(); };

export function createApp(payment: Payment = { middleware: lazyPaymentMiddleware, ready: paymentReady }, options: {
  config?: OperationalConfig;
  client?: PublicClient;
  market?: ReturnType<typeof loadConfig>;
  now?: () => number;
} = {}) {
  const config = options.config || operations;
  const market = options.market || cfg;
  const app = express();
  let client = options.client;
  const rpc = () => client ??= getPublicClient();
  const limiter = rateLimiter(config, options.now);
  const gate = concurrencyGate(config.maxInFlight);
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustedProxies.length ? config.trustedProxies : false);
  app.use(requestLog);
  app.use(secureHeaders);
  app.use(cors);
  app.use(express.json({ limit: "32kb", strict: true }));

  type Health = { status: number; body: Record<string, unknown> };
  let healthCache: { until: number; result: Health } | undefined;
  let healthPending: Promise<Health> | undefined;
  const health = (): Promise<Health> => {
    if (healthCache && Date.now() < healthCache.until) return Promise.resolve(healthCache.result);
    if (healthPending) return healthPending;
    healthPending = (async (): Promise<Health> => {
      if (!market.contract) return { status: 503, body: { ok: false, error: { code: "CHAIN_CONTRACT_UNCONFIGURED", message: "DEMAND_CONTRACT not configured" } } };
      try {
        const [latestBlock, bytecode, chainId] = await Promise.all([
          rpc().getBlockNumber({ cacheTime: 0 }),
          rpc().getBytecode({ address: market.contract }),
          rpc().getChainId(),
        ]);
        if (!bytecode || bytecode === "0x" || chainId !== market.chainId) throw new Error("CHAIN_RPC_UNAVAILABLE");
        return { status: 200, body: { ok: true, name: "UNMET", chainId: market.chainId, contract: market.contract, latestBlock: latestBlock.toString() } };
      } catch {
        return { status: 503, body: { ok: false, error: { code: "CHAIN_RPC_UNAVAILABLE", message: "RPC or contract unavailable" } } };
      }
    })().then((result) => {
      healthCache = { until: Date.now() + config.dependencyCacheMs, result };
      return result;
    }).finally(() => { healthPending = undefined; });
    return healthPending;
  };
  app.get("/live", (_req, res) => { res.json({ ok: true, name: "UNMET" }); });
  app.get("/health", (_req, res, next) => {
    void health().then(({ status, body }) => res.status(status).json(body)).catch(next);
  });
  app.get("/ready", (_req, res, next) => {
    void (async () => {
      try {
        if (operations.paymentDbPath) await initializePaymentStorage();
        await payment.ready?.();
      }
      catch {
        res.status(503).json({ ok: false, error: { code: "PAYMENT_UNAVAILABLE", message: "Payment service unavailable" } });
        return;
      }
      const result = await health();
      res.status(result.status).json(result.body);
    })().catch(next);
  });

  app.get("/v1/demands", limiter("demands", config.demandsPerWindow), gate, admittedWork(async (req, res, next) => {
    try {
      if (!market.contract) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
      await ensureIndex(rpc(), market.contract);
      if (req.aborted || res.destroyed) {
        res.statusCode = 503;
        res.end();
        return;
      }
      const entries = [...demandIndex.entries.values()];
      const demands = filterAndSort(entries, { minBounty: 0n, minSupporters: 0, sort: "bounty", limit: 50 });
      res.json({ chainId: market.chainId, contract: market.contract, blockNumber: demandIndex.lastIndexedBlock.toString(), generatedAt: new Date().toISOString(), demands });
    } catch (error) { next(error); }
  }));

  const validate: RequestHandler = (req, res, next) => {
    if (!req.is("application/json")) {
      res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Use application/json" } });
      return;
    }
    const parsed = validateOpportunitiesInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: { code: parsed.code, message: parsed.message } });
      return;
    }
    res.locals.opportunityInput = parsed.value;
    next();
  };
  app.post("/v1/opportunities", validate, limiter("opportunities", config.opportunitiesPerWindow), gate, admittedWork(payment.middleware), admittedWork(async (req, res, next) => {
    try {
      if (!market.contract) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
      await ensureIndex(rpc(), market.contract);
      if (req.aborted || res.destroyed) {
        res.statusCode = 503;
        res.end();
        return;
      }
      const input: QueryInput = res.locals.opportunityInput;
      const opportunities = filterAndSort([...demandIndex.entries.values()], input);
      res.json({
        chainId: market.chainId,
        contract: market.contract,
        blockNumber: demandIndex.lastIndexedBlock.toString(),
        generatedAt: new Date().toISOString(),
        opportunities,
      });
    } catch (error) { next(error); }
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed) {
      // Complete the SDK's buffered response without starting settlement.
      res.statusCode = 503;
      res.end();
      return;
    }
    if (res.headersSent) return;
    const parserStatus = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    const code = error instanceof PaymentError ? error.code
      : parserStatus === 413 ? "BODY_TOO_LARGE"
      : parserStatus === 415 ? "UNSUPPORTED_MEDIA_TYPE"
      : error instanceof SyntaxError && "body" in error ? "INVALID_JSON"
      : error instanceof Error && ["INDEX_CAPACITY", "INDEX_BUDGET_EXCEEDED", "INDEX_REORG", "CHAIN_CONTRACT_UNCONFIGURED"].includes(error.message) ? error.message
      : "CHAIN_RPC_UNAVAILABLE";
    const status = code === "BODY_TOO_LARGE" ? 413 : code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : code === "INVALID_JSON" ? 400 : 503;
    log({ level: "error", event: "request_error", requestId: res.getHeader("x-request-id"), code });
    res.status(status).json({ error: { code, message: status >= 500 ? "Service temporarily unavailable" : "Invalid request body" } });
  });
  return app;
}

export const app = createApp();
export default app;

export async function startServer() {
  if (!cfg.contract) throw new Error("CONFIG_INVALID: DEMAND_CONTRACT");
  const pay = requirePaymentEnv();
  if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_ORIGIN?.trim()) throw new Error("CONFIG_INVALID: FRONTEND_ORIGIN");
  const middleware = await createPaymentMiddleware();
  const application = createApp({ middleware, ready: middleware.ready });
  const port = operations.port;
  const host = process.env.HOST || "0.0.0.0";
  const server = application.listen(port, host, () => {
    log({ level: "info", event: "listen", host, port, chainId: cfg.chainId, contract: cfg.contract, paymentNetwork: pay.network });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  let draining = false;
  const shutdown = (signal: string) => {
    if (draining) return;
    draining = true;
    log({ level: "info", event: "shutdown", signal });
    const deadline = setTimeout(() => {
      log({ level: "error", event: "shutdown_timeout", code: "DRAIN_TIMEOUT" });
      server.closeAllConnections();
      process.exit(1);
    }, operations.shutdownTimeoutMs);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      paymentStore?.close();
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (import.meta.main) {
  try { await startServer(); }
  catch {
    log({ level: "error", event: "startup_failed", code: "STARTUP_UNAVAILABLE" });
    process.exitCode = 1;
  }
}
