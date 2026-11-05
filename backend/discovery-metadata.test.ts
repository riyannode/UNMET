import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { discoveryDigest, discoveryPayload, parseDiscoveryMetadata, verifyDiscoverySignature } from "./discovery-metadata.ts";
import { encodeFunctionResult, type PublicClient } from "viem";
import fixture from "./fixtures/discovery.json";
import { discoveryRequest } from "./discovery-evaluator.ts";

const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
const base = () => ({
  schemaVersion: "unmet-discovery-v1", chainId: "1952", contract: `0x${"11".repeat(20)}`, demandId: "1", builder: account.address.toLowerCase(),
  serviceUrl: "https://example.com/", evidenceHash: `0x${"22".repeat(32)}`, revision: "1", issuedAt: "100",
  request: { method: "GET", query: [], contentType: null, body: null },
  targets: [{ network: "eip155:1", asset: `0x${"33".repeat(20)}`, payTo: `0x${"44".repeat(20)}` }], signature: "0x12",
});
const parse = (value: unknown) => parseDiscoveryMetadata(Buffer.from(JSON.stringify(value)), 100);

test("metadata rejects unknown fields, invalid bindings, and duplicate targets", () => {
  expect(parse(base()).demandId).toBe("1");
  for (const value of [
    { ...base(), extra: true }, { ...base(), chainId: "01" }, { ...base(), serviceUrl: "http://example.com/" },
    { ...base(), request: { ...base().request, body: {} } }, { ...base(), targets: [...base().targets, ...base().targets] },
    { ...base(), targets: [] }, { ...base(), issuedAt: "161" },
    { ...base(), request: { ...base().request, unknown: true } },
    { ...base(), targets: Array.from({ length: 9 }, (_, i) => ({ ...base().targets[0], network: `eip155:${i + 1}` })) },
    { ...base(), serviceUrl: `https://example.com/${"é".repeat(300)}` },
    { ...base(), serviceUrl: "https://127.0.0.1/" }, { ...base(), issuedAt: (1n << 64n).toString() },
    { ...base(), request: { method: "POST", query: [], contentType: "application/json", body: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } } },
  ]) expect(() => parse(value)).toThrow();
  expect(() => parseDiscoveryMetadata(Buffer.from([0xff]))).toThrow();
  expect(() => parseDiscoveryMetadata(Buffer.from(JSON.stringify(base()) + " ".repeat(32768)))).toThrow();
});

test("signed payload binds identity and is independent of signature bytes", async () => {
  const metadata = parse(base());
  const signature = await account.sign({ hash: discoveryDigest(metadata) });
  const signed = { ...metadata, signature };
  expect(discoveryPayload(metadata)).toEqual(discoveryPayload(signed));
  expect(discoveryDigest({ ...signed, demandId: "2" })).not.toBe(discoveryDigest(signed));
  const client = { call: () => { throw new Error("unexpected ERC-1271 call"); } } as unknown as PublicClient;
  expect(await verifyDiscoverySignature(client, signed, `0x${"11".repeat(32)}`)).toBe(true);
});

test("contract wallet verification uses a canonical block-hash pin", async () => {
  const metadata = parse(base());
  const blockHash = `0x${"aa".repeat(32)}` as const;
  const client = { request: async (request: { method: string; params: unknown[] }) => {
    expect(request.method).toBe("eth_call");
    expect(request.params[1]).toEqual({ blockHash, requireCanonical: true });
    return encodeFunctionResult({ abi: [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const, functionName: "isValidSignature", result: "0x1626ba7e" });
  } } as unknown as PublicClient;
  expect(await verifyDiscoverySignature(client, metadata, blockHash)).toBe(true);
});

test("independent canonical and EIP-712 fixture binds metadata fields", () => {
  const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify(fixture.metadata)), 1793750400);
  expect<string>(discoveryPayload(metadata).payload).toBe(fixture.expected.canonicalPayload);
  expect<string>(discoveryPayload(metadata).payloadHash).toBe(fixture.expected.payloadHash);
  expect<string>(discoveryRequest(metadata).requestHash).toBe(fixture.expected.requestHash);
  expect<string>(discoveryDigest(metadata)).toBe(fixture.expected.digest);
  for (const changed of [
    { ...metadata, chainId: "1" }, { ...metadata, contract: `0x${"77".repeat(20)}` as const },
    { ...metadata, demandId: "2" }, { ...metadata, revision: "2" }, { ...metadata, targets: metadata.targets.slice(0, 1) },
    { ...metadata, request: { ...metadata.request, query: [...metadata.request.query].reverse() } },
  ]) expect<string>(discoveryDigest(changed)).not.toBe(fixture.expected.digest);
});
