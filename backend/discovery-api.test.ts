import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionResult, toFunctionSelector, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_DEMAND_ABI, loadConfig } from "./contract.ts";
import { loadOperationalConfig } from "./config.ts";
import { discoveryDigest, parseDiscoveryMetadata } from "./discovery-metadata.ts";
import { DiscoveryStore } from "./discovery-store.ts";
import { createApp } from "./server.ts";

test("metadata PUT binds route, chain, canonical service and monotonic revision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-discovery-api-"));
  const store = new DiscoveryStore(join(dir, "data.sqlite"));
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const contract = `0x${"11".repeat(20)}` as const, evidenceHash = `0x${"aa".repeat(32)}` as const, blockHash = `0x${"bb".repeat(32)}` as const;
  const deployment = { chainId: 31337, contract, rpcUrl: "https://rpc.example", deployBlock: 0n, chain: { name: "Fixture", explorerUrl: "https://example.com", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }, escrowToken: { address: contract, symbol: "T", decimals: 6 } };
  const demand = { creator: contract, builder: account.address, maxUnitPrice: 1n, committed: 0n, reviewCommitted: 0n, approvalRequired: 0n, expectedCalls: 1n, deadline: 1000n, reviewEndsAt: 0n, supporterCount: 0, status: 2, capability: "test", specification: "test", serviceUrl: "https://example.com/", evidenceHash };
  let chainId = 31337, reorg = false, walletValid = false;
  const walletAbi = [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const;
  const client = { getChainId: async () => chainId, getBlock: async (args?: { blockNumber?: bigint }) => ({ number: 42n, hash: reorg && args ? `0x${"cc".repeat(32)}` : blockHash }), request: async ({ params }: { params: unknown[] }) => {
    expect(params[1]).toEqual({ blockHash, requireCanonical: true });
    const call = params[0] as { data: string };
    if (call.data.startsWith(toFunctionSelector("isValidSignature(bytes32,bytes)"))) return encodeFunctionResult({ abi: walletAbi, functionName: "isValidSignature", result: walletValid ? "0x1626ba7e" : "0xffffffff" });
    return encodeFunctionResult({ abi: AGENT_DEMAND_ABI, functionName: "getDemand", result: demand });
  } } as unknown as PublicClient;
  const server = createApp({ middleware: (_req, _res, next) => next() }, { market: { ...loadConfig(), deployment }, client, discovery: store, config: loadOperationalConfig({ RATE_DEMANDS: "1000" }) }).listen(0, "127.0.0.1");
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    const body = { schemaVersion: "unmet-discovery-v1", chainId: "31337", contract, demandId: "1", builder: account.address.toLowerCase(), serviceUrl: demand.serviceUrl, evidenceHash, revision: "1", issuedAt: "1", request: { method: "GET", query: [], contentType: null, body: null }, targets: [{ network: "eip155:1", asset: contract, payTo: contract }], signature: "0x12" };
    const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify(body)));
    body.signature = await account.sign({ hash: discoveryDigest(metadata) });
    const url = `http://127.0.0.1:${address.port}/v1/services/31337/${contract}/1/discovery`;
    const put = (value: unknown, endpoint = url) => fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    expect((await put(body)).status).toBe(200);
    expect((await put(body)).status).toBe(200);
    const old = { ...body, revision: "0" };
    old.signature = await account.sign({ hash: discoveryDigest(parseDiscoveryMetadata(Buffer.from(JSON.stringify(old)))) });
    expect((await put(old)).status).toBe(409);
    const conflict = { ...body, request: { ...body.request, query: [["q", "different"]] } };
    conflict.signature = await account.sign({ hash: discoveryDigest(parseDiscoveryMetadata(Buffer.from(JSON.stringify(conflict)))) });
    expect((await put(conflict)).status).toBe(409);
    expect((await put(body, url.replace("/31337/", "/1/"))).status).toBe(400);
    const otherContract = `0x${"22".repeat(20)}`;
    for (const mismatch of [
      { ...body, chainId: "1" }, { ...body, contract: otherContract }, { ...body, demandId: "2" },
      { ...body, builder: otherContract }, { ...body, serviceUrl: "https://other.example/" },
    ]) expect((await put(mismatch)).status).toBe(400);
    expect((await put(body, url.replace(contract, otherContract))).status).toBe(400);
    expect((await put(body, url.replace("/1/discovery", "/2/discovery"))).status).toBe(400);
    expect((await put(body, `http://127.0.0.1:${address.port}/v1/services/1/discovery`)).status).toBe(404);
    expect((await put({ ...body, evidenceHash: `0x${"cc".repeat(32)}` })).status).toBe(400);
    expect((await put({ ...body, signature: "0x12" })).status).toBe(400);
    for (const status of [0, 1, 3, 4]) { demand.status = status; expect((await put(body)).status).toBe(404); }
    demand.status = 2;
    reorg = true;
    expect((await put(body)).status).toBe(503);
    reorg = false;
    const wallet = `0x${"44".repeat(20)}` as const;
    demand.builder = wallet;
    const contractBody = { ...body, builder: wallet, revision: "2", signature: "0x1234" };
    walletValid = true;
    expect((await put(contractBody)).status).toBe(200);
    walletValid = false;
    expect((await put(contractBody)).status).toBe(400);
    chainId = 1;
    expect((await put(body)).status).toBe(503);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
