import { isIP } from "node:net";

type Env = Record<string, string | undefined>;

function integer(env: Env, key: string, fallback: number, min: number, max: number) {
  const raw = env[key] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error("CONFIG_INVALID: " + key);
  }
  return value;
}

export function httpUrl(value: string, key: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hash) throw new Error();
    return value;
  } catch { throw new Error("CONFIG_INVALID: " + key); }
}

export function loadOperationalConfig(env: Env = process.env) {
  const trustedProxies = (env.TRUSTED_PROXIES || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const proxy of trustedProxies) {
    const [ip, prefix, extra] = proxy.split("/");
    const family = isIP(ip);
    if (!family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw new Error("CONFIG_INVALID: TRUSTED_PROXIES");
    }
  }
  const origins = (env.FRONTEND_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const origin of origins) {
    httpUrl(origin, "FRONTEND_ORIGIN");
    if (new URL(origin).origin !== origin) throw new Error("CONFIG_INVALID: FRONTEND_ORIGIN");
  }
  const rpcMaxInFlight = integer(env, "RPC_MAX_IN_FLIGHT", 16, 4, 128);
  if (env.PAYMENT_DB_PATH && !env.PAYMENT_DB_PATH.startsWith("/")) {
    throw new Error("CONFIG_INVALID: PAYMENT_DB_PATH");
  }
  return {
    x402RpcUrl: httpUrl(env.X402_RPC_URL || "https://rpc.xlayer.tech", "X402_RPC_URL"),
    paymentDbPath: env.PAYMENT_DB_PATH,
    paymentRetentionDays: integer(env, "PAYMENT_RETENTION_DAYS", 30, 1, 3650),
    paymentMaxRecords: integer(env, "PAYMENT_MAX_RECORDS", 100_000, 1, 1_000_000),
    port: integer(env, "PORT", 8787, 1, 65535),
    trustedProxies,
    rateWindowMs: integer(env, "RATE_WINDOW_MS", 60_000, 100, 3_600_000),
    demandsPerWindow: integer(env, "RATE_DEMANDS", 60, 1, 100_000),
    opportunitiesPerWindow: integer(env, "RATE_OPPORTUNITIES", 20, 1, 100_000),
    rateMaxKeys: integer(env, "RATE_MAX_KEYS", 10_000, 1, 1_000_000),
    maxInFlight: integer(env, "MAX_IN_FLIGHT", 16, 1, 256),
    rpcMaxInFlight,
    rpcTimeoutMs: integer(env, "RPC_TIMEOUT_MS", 5000, 100, 30_000),
    upstreamMaxBytes: integer(env, "UPSTREAM_MAX_BYTES", 2_097_152, 1024, 16_777_216),
    indexBatchSize: Math.min(integer(env, "INDEX_BATCH_SIZE", 4, 1, 32), Math.max(1, Math.floor((rpcMaxInFlight - 3) / 3))),
    indexMaxDemands: integer(env, "INDEX_MAX_DEMANDS", 10_000, 1, 100_000),
    indexMaxLogWindows: integer(env, "INDEX_MAX_LOG_WINDOWS", 100, 1, 10_000),
    indexBudgetMs: integer(env, "INDEX_BUDGET_MS", 15_000, 100, 120_000),
    indexRefreshMs: integer(env, "INDEX_REFRESH_MS", 5000, 0, 60_000),
    dependencyCacheMs: integer(env, "DEPENDENCY_CACHE_MS", 5000, 100, 60_000),
    facilitatorTimeoutMs: integer(env, "FACILITATOR_TIMEOUT_MS", 15_000, 100, 60_000),
    shutdownTimeoutMs: integer(env, "SHUTDOWN_TIMEOUT_MS", 20_000, 100, 120_000),
  };
}

export type OperationalConfig = ReturnType<typeof loadOperationalConfig>;
