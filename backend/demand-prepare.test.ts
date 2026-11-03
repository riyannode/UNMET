import { expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionData, type PublicClient } from "viem";
import { AGENT_DEMAND_ABI, loadConfig } from "./contract.ts";
import { createApp } from "./server.ts";
import { loadOperationalConfig } from "./config.ts";
import { validateDemandInput } from "./demand-prepare.ts";

const deployment = {
  chainId: 1952, contract: "0x3333333333333333333333333333333333333333", rpcUrl: "http://127.0.0.1:8545", deployBlock: 0n,
  chain: { name: "Test", explorerUrl: "https://example.test", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 } },
  escrowToken: { address: "0x4444444444444444444444444444444444444444", symbol: "USDC_TEST", decimals: 6 },
} as const;
const input = {
  chainId: 1952, contract: deployment.contract, capability: "vendor-kyb-api",
  specification: { schemaVersion: "unmet-rfq-v1", description: "  Verify a business.\n" },
  maxUnitPrice: "20000", expectedCalls: "1000", deadline: "1700003600", initialCommitment: "20000000",
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

async function fixture(run: (url: string, calls: string[]) => Promise<void>, overrides: {
  chainId?: number; token?: string; decimals?: number; code?: string; minimum?: bigint; timestamp?: bigint;
  unavailable?: boolean; configured?: boolean; limit?: string; hold?: Promise<void>;
} = {}) {
  const calls: string[] = [];
  const client = {
    getChainId: async () => { calls.push("chainId"); if (overrides.unavailable) throw new Error("offline"); await overrides.hold; return overrides.chainId ?? 1952; },
    getBytecode: async () => { calls.push("code"); return overrides.code ?? "0x01"; },
    getBlock: async () => { calls.push("block"); return { number: 42n, timestamp: overrides.timestamp ?? 1700000000n }; },
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      calls.push(functionName);
      if (functionName === "token") return overrides.token ?? deployment.escrowToken.address;
      if (functionName === "decimals") return overrides.decimals ?? 6;
      if (functionName === "minCommitment") { expect(blockNumber).toBe(42n); return overrides.minimum ?? 1_000_000n; }
      throw new Error("unexpected RPC");
    },
  } as unknown as PublicClient;
  const server = createApp({ middleware: () => { throw new Error("unexpected payment"); }, ready: async () => { throw new Error("unexpected payment readiness"); } }, {
    config: loadOperationalConfig({ RATE_DEMANDS: overrides.limit ?? "1000", MAX_IN_FLIGHT: "1" }), client,
    market: { ...loadConfig(), deployment: overrides.configured === false ? undefined : deployment },
  }).listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener unavailable");
  try { await run(`http://127.0.0.1:${address.port}/v1/demands/prepare`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const post = (url: string, body: unknown = input) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "payment-signature": "unused" }, body: JSON.stringify(body) });

test("prepare returns only an unsigned, zero-value intent for the existing ABI", async () => {
  await fixture(async (url, calls) => {
    const response = await post(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("link")).toContain("service-desc");
    expect(response.headers.get("payment-required")).toBeNull();
    expect(response.headers.get("payment-response")).toBeNull();
    const intent = await response.json();
    expect(Object.keys(intent)).toEqual(["chainId", "to", "data", "value"]);
    expect(intent).toEqual({ chainId: 1952, to: deployment.contract, value: "0", data: encodeFunctionData({
      abi: AGENT_DEMAND_ABI, functionName: "createDemand", args: ["vendor-kyb-api", '{"description":"Verify a business.","schemaVersion":"unmet-rfq-v1"}', 20000n, 1000n, 1700003600n, 20000000n],
    }) });
    expect(decodeFunctionData({ abi: AGENT_DEMAND_ABI, data: intent.data }).functionName).toBe("createDemand");
    expect(calls).toEqual(["chainId", "code", "token", "decimals", "block", "minCommitment"]);
  });
});

test("strict parsing rejects duplicates, malformed UTF-8, BOM, comments and nonobjects before RPC", async () => {
  await fixture(async (url, calls) => {
    for (const body of ['{"chainId":1952,"chainId":1952}', JSON.stringify(input).replace('"description":', '"description":"first","description":'),
      JSON.stringify(input).replace('"schemaVersion":', '"schemaVersion":"other","schemaVersion":'), "{} trailing", "[]", "null", "/*comment*/{}", "\ufeff{}", new Uint8Array([0xc3, 0x28])]) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(response.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

test("schema, unknown fields, description, deployment and integer failures are deterministic and do no RPC", async () => {
  await fixture(async (url, calls) => {
    for (const body of [
      { ...input, extra: true }, { ...input, specification: { ...input.specification, extra: true } },
      { ...input, specification: { schemaVersion: "unmet-rfq-v2", description: "future" } },
      { ...input, specification: "legacy input is not accepted by prepare" },
      ...["", " \n", "a".repeat(2000), "🧪".repeat(500), "\ud800"].map((description) => ({ ...input, specification: { ...input.specification, description } })),
      ...[0, 196, 1952.5, "1952"].map((chainId) => ({ ...input, chainId })),
      ...["0x" + "0".repeat(40), "bad", "0x" + "5".repeat(40)].map((contract) => ({ ...input, contract })),
      ...["Upper Case", "a--b", "-a", "a".repeat(65)].map((capability) => ({ ...input, capability })),
      ...["maxUnitPrice", "expectedCalls", "deadline", "initialCommitment"].flatMap((field) =>
        [0, 1, "0", "-1", "01", "+1", "1.0", "1e3", " 1", "1".repeat(79)].map((value) => ({ ...input, [field]: value }))),
      { ...input, maxUnitPrice: (1n << 96n).toString() }, { ...input, initialCommitment: (1n << 96n).toString() },
      { ...input, expectedCalls: (1n << 64n).toString() }, { ...input, deadline: (1n << 64n).toString() },
    ]) expect((await post(url, body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

test("accepts exact uint bounds and encoded UTF-8 boundary without rounding", () => {
  for (const description of ["a".repeat(1999), "🧪".repeat(499) + "abc"]) {
    const result = validateDemandInput(encode({ ...input, specification: { ...input.specification, description },
      maxUnitPrice: ((1n << 96n) - 1n).toString(), expectedCalls: ((1n << 64n) - 1n).toString(),
      deadline: ((1n << 64n) - 1n).toString(), initialCommitment: ((1n << 96n) - 1n).toString() }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(new TextEncoder().encode(result.value.specification).length).toBe(2048);
    expect(result.value.expectedCalls).toBe((1n << 64n) - 1n);
    expect(result.value.maxUnitPrice).toBe((1n << 96n) - 1n);
  }
});

test("validates deadline against chain timestamp and commitment against pinned minimum", async () => {
  await fixture(async (url) => {
    expect((await post(url, { ...input, deadline: "1700003599" })).status).toBe(400);
    expect((await post(url, { ...input, initialCommitment: "999999" })).status).toBe(400);
    expect((await post(url, { ...input, initialCommitment: "1000000" })).status).toBe(200);
  });
});

test("refuses unavailable or mismatched configured deployments without returning an intent", async () => {
  for (const overrides of [{ chainId: 196 }, { code: "0x" }, { token: "0x" + "5".repeat(40) }, { decimals: 18 }, { unavailable: true }, { configured: false }]) {
    await fixture(async (url) => {
      const response = await post(url);
      expect(response.status).toBe(503);
      expect(await response.json()).toHaveProperty("error.code");
    }, overrides);
  }
});

test("bounds body, media, compression and quota without payment side effects", async () => {
  await fixture(async (url, calls) => {
    const send = (headers: Record<string, string>, body: string) => fetch(url, { method: "POST", headers, body });
    expect((await send({ "content-type": "text/plain" }, "{}")).status).toBe(415);
    expect((await send({ "content-type": "application/json; charset=utf-16" }, "{}")).status).toBe(415);
    expect((await send({ "content-type": "application/json", "content-encoding": "gzip" }, "{}")).status).toBe(415);
    expect((await send({ "content-type": "application/json" }, " ".repeat(32769))).status).toBe(413);
    expect(calls).toEqual([]);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  }, { limit: "1" });
});

test("prepare shares admission with demand reads and keeps capacity until RPC ends", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    await fixture(async (url, calls) => {
      const pending = post(url);
      for (let i = 0; !calls.length && i < 100; i++) await Bun.sleep(1);
      expect(calls).toEqual(["chainId"]);
      expect((await post(url)).status).toBe(503);
      expect((await fetch(url.replace("/prepare", ""))).status).toBe(503);
      release();
      expect((await pending).status).toBe(200);
      expect((await post(url)).status).toBe(200);
    }, { hold });
  } finally { release(); }
});
