import { readFileSync } from "node:fs";
import { parseStrictJSON } from "./validation-codec.ts";

export type DiscoveryConfig = {
  tickMs: number; refreshMs: number; staleMs: number; maxInFlight: number; timeoutMs: number;
};

const defaults: DiscoveryConfig = { tickMs: 30_000, refreshMs: 300_000, staleMs: 900_000, maxInFlight: 2, timeoutMs: 10_000 };
const bounds: Record<keyof DiscoveryConfig, [number, number]> = {
  tickMs: [1000, 3_600_000], refreshMs: [1000, 86_400_000], staleMs: [1000, 604_800_000],
  maxInFlight: [1, 16], timeoutMs: [1, 10_000],
};

export function parseDiscoveryConfig(raw: Uint8Array): DiscoveryConfig {
  const value = parseStrictJSON(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DISCOVERY_INVALID_CONFIG");
  const keys = Object.keys(defaults) as (keyof DiscoveryConfig)[];
  if (Object.keys(value).some((key) => !keys.includes(key as keyof DiscoveryConfig))) throw new Error("DISCOVERY_INVALID_CONFIG");
  const resolved = { ...defaults };
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) continue;
    const [min, max] = bounds[key];
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < min || item > max) throw new Error("DISCOVERY_INVALID_CONFIG");
    resolved[key] = item;
  }
  if (resolved.tickMs > resolved.refreshMs || resolved.refreshMs >= resolved.staleMs) throw new Error("DISCOVERY_INVALID_CONFIG");
  return resolved;
}

export function loadDiscoveryConfig(path?: string): DiscoveryConfig {
  return parseDiscoveryConfig(path ? readFileSync(path) : Buffer.from("{}"));
}
