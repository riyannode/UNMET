import { expect, test } from "bun:test";
import { parseDiscoveryConfig } from "./discovery-config.ts";
const parse = (input: unknown) => parseDiscoveryConfig(Buffer.from(JSON.stringify(input)));
test("discovery configuration resolves defaults and bounded overrides", () => {
  expect(parse({})).toEqual({ tickMs: 30000, refreshMs: 300000, staleMs: 900000, maxInFlight: 2, timeoutMs: 10000 });
  expect(parse({ tickMs: 2000, refreshMs: 3000, staleMs: 4000, maxInFlight: 4, timeoutMs: 5000 }).maxInFlight).toBe(4);
  for (const value of [{ unknown: 1 }, { maxInFlight: 0 }, { timeoutMs: 10001 }, { tickMs: 4000, refreshMs: 3000 }, { refreshMs: 900000 }, { tickMs: "3" }]) {
    expect(() => parse(value)).toThrow();
  }
});
