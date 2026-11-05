import { request } from "node:http";
import Ajv2020 from "ajv/dist/2020";
import type { DiscoveryConfig } from "./discovery-config.ts";
import type { DiscoveryRecord, DiscoveryStore } from "./discovery-store.ts";
import { parseDiscoveryMetadata } from "./discovery-metadata.ts";
import { discoveryRequest } from "./discovery-evaluator.ts";
import type { StoredDiscoveryObservation } from "../shared/discovery-types.ts";

const responseSchema = {
  type: "object", additionalProperties: false, required: ["state", "reason", "offers"],
  properties: {
    state: { enum: ["compatible", "incompatible", "unavailable", "metadata_invalid"] }, reason: { type: ["string", "null"], maxLength: 64 },
    metadataRevision: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 78 }, requestHash: { type: "string", pattern: "^0x[0-9a-f]{64}$" }, blockHash: { type: "string", pattern: "^0x[0-9a-f]{64}$" },
    offers: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: false,
      required: ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "transferMethod", "paymentFlow", "extra", "validationPolicyId", "withinOriginatingMaxPrice"],
      properties: { scheme: { const: "exact" }, network: { type: "string", pattern: "^eip155:[1-9][0-9]{0,31}$" }, asset: { type: "string", pattern: "^0x[0-9a-f]{40}$" }, payTo: { type: "string", pattern: "^0x[0-9a-f]{40}$" }, amount: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 78 }, maxTimeoutSeconds: { type: "integer", minimum: 1 }, transferMethod: { enum: ["eip3009", "permit2"] }, paymentFlow: { const: "authorization" }, extra: { type: "object" }, validationPolicyId: { type: "string", pattern: "^0x[0-9a-f]{64}$" }, withinOriginatingMaxPrice: { type: ["boolean", "null"] } },
    } },
  },
};
const validResponse = new Ajv2020({ strict: true }).compile(responseSchema);
export function parseStoredObservation(raw: string): StoredDiscoveryObservation {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DISCOVERY_INVALID_OBSERVATION");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "failure,generation,lastAttemptAt,observedAt,result" || (row.observedAt !== null && (!Number.isSafeInteger(row.observedAt) || typeof row.observedAt !== "number" || row.observedAt < 0)) || typeof row.lastAttemptAt !== "number" || !Number.isSafeInteger(row.lastAttemptAt) || row.lastAttemptAt < 0 || typeof row.generation !== "number" || !Number.isSafeInteger(row.generation) || row.generation < 0 || (row.failure !== null && (typeof row.failure !== "string" || row.failure.length > 64)) || (row.result !== null && !validResponse(row.result))) throw new Error("DISCOVERY_INVALID_OBSERVATION");
  return value as StoredDiscoveryObservation;
}
function previousObservation(record: DiscoveryRecord): StoredDiscoveryObservation | null {
  try { return record.observation ? parseStoredObservation(record.observation) : null; }
  catch { return null; }
}
export function matchesRecord(value: unknown, record: DiscoveryRecord): boolean {
  if (!validResponse(value) || !value || typeof value !== "object" || !("state" in value) || !("offers" in value) || !Array.isArray(value.offers)) return false;
  const state = value.state;
  if (state === "compatible" || (state === "incompatible" && value.offers.length)) {
    if (!("metadataRevision" in value) || value.metadataRevision !== record.revision || !("requestHash" in value) || !("blockHash" in value)) return false;
  }
  if (state === "compatible" && !value.offers.length) return false;
  if (state !== "compatible" && value.offers.length) return false;
  const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify({ ...JSON.parse(record.payload), signature: record.signature })));
  if ("requestHash" in value && value.requestHash !== discoveryRequest(metadata).requestHash) return false;
  return value.offers.every((offer: { network: string; asset: string; payTo: string; amount: string; transferMethod: string; paymentFlow: string; extra: Record<string, unknown> }) =>
    BigInt(offer.amount) < 1n << 256n && offer.extra.assetTransferMethod === offer.transferMethod && offer.extra.paymentFlow === offer.paymentFlow && metadata.targets.some((target) => target.network === offer.network && target.asset === offer.asset && target.payTo === offer.payTo));
}

function observe(socket: string, record: DiscoveryRecord, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path: "/observe", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 65536) req.destroy(); else chunks.push(chunk); });
      res.on("end", () => { try { if (res.statusCode !== 200) throw new Error(); resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error("DISCOVERY_UNAVAILABLE")); } });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs + 5000, () => req.destroy());
    req.on("error", reject);
    req.end(JSON.stringify({ ...JSON.parse(record.payload), signature: record.signature }));
  });
}

export function startDiscoveryScheduler(store: DiscoveryStore, config: DiscoveryConfig, socket: string, prefix: string, current: (record: DiscoveryRecord) => Promise<boolean>, generation: (record: DiscoveryRecord) => number = () => 0) {
  let running = false, stopped = false;
  const startedAt = Date.now();
  let pending: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running || stopped) return;
    running = true;
    pending = (async () => {
      const now = Date.now();
      const records = store.due(prefix, Math.max(now - config.refreshMs, startedAt - 1), config.maxInFlight);
      await Promise.all(records.map(async (record) => {
        store.markAttempt(record.identity, record.revision, now);
        const failure = (reason: string) => {
          const previous = previousObservation(record);
          if (!stopped) store.setObservation(record.identity, record.revision, record.payloadHash, JSON.stringify({ observedAt: previous?.observedAt ?? null, result: previous?.result ?? null, lastAttemptAt: Date.now(), generation: previous?.generation ?? generation(record), failure: reason }));
        };
        try { if (!await current(record)) { failure("CANONICAL_INACTIVE"); return; } }
        catch { failure("CANONICAL_UNAVAILABLE"); return; }
        const initialGeneration = generation(record);
        let result: unknown;
        try { result = await observe(socket, record, config.timeoutMs); }
        catch { result = { state: "unavailable", reason: "OBSERVER_UNAVAILABLE", offers: [] }; }
        try { if (!matchesRecord(result, record)) result = { state: "unavailable", reason: "INVALID_OBSERVER_RESPONSE", offers: [] }; }
        catch { result = { state: "unavailable", reason: "INVALID_OBSERVER_RESPONSE", offers: [] }; }
        const state = (result as { state: string }).state;
        const previous = previousObservation(record);
        const next = state === "unavailable" ? { observedAt: previous?.observedAt ?? null, result: previous?.result ?? null, lastAttemptAt: Date.now(), generation: previous?.generation ?? initialGeneration, failure: (result as { reason: string }).reason } : { observedAt: Date.now(), result, lastAttemptAt: Date.now(), generation: initialGeneration, failure: null };
        try {
          if (!await current(record)) { failure("CANONICAL_INACTIVE"); return; }
          if (generation(record) !== initialGeneration) { failure("CANONICAL_CHANGED"); return; }
          if (!stopped) store.setObservation(record.identity, record.revision, record.payloadHash, JSON.stringify(next));
        } catch { failure("CANONICAL_UNAVAILABLE"); }
      }));
    })().catch(() => {}).finally(() => { running = false; });
  };
  const timer = setInterval(tick, config.tickMs);
  tick();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
