import Ajv2020 from "ajv/dist/2020";
import { isIP } from "node:net";
import { BaseError, ExecutionRevertedError, hashTypedData, encodeFunctionData, decodeFunctionResult, type Address, type Hex, type PublicClient } from "viem";
import { discoveryTypes, type DiscoveryMetadata } from "../shared/discovery-types.ts";
import { canonicalJSON, hashJSON, parseStrictJSON, parseUint256 } from "./validation-codec.ts";
import { domain, signedBy } from "./validation-crypto.ts";
import discoveryMetadataSchema from "../docs/schemas/discovery-metadata.json";
const validate = new Ajv2020({ strict: true }).compile<DiscoveryMetadata>(discoveryMetadataSchema);
const walletAbi = [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ name: "magicValue", type: "bytes4" }] }] as const;

export function parseDiscoveryMetadata(raw: Uint8Array, now = Math.floor(Date.now() / 1000)): DiscoveryMetadata {
  if (raw.byteLength > 32768) throw new Error("DISCOVERY_INVALID_METADATA");
  const input = parseStrictJSON(raw);
  if (!validate(input)) throw new Error("DISCOVERY_INVALID_METADATA");
  for (const value of [input.chainId, input.demandId, input.revision, input.issuedAt]) parseUint256(value);
  if (input.chainId === "0" || input.demandId === "0" || BigInt(input.issuedAt) > (1n << 64n) - 1n || BigInt(input.issuedAt) > BigInt(now) + 60n) throw new Error("DISCOVERY_INVALID_METADATA");
  const url = new URL(input.serviceUrl);
  const alias = input.serviceUrl.replace(/^(https:\/\/[^/]+):443(?=\/|$)/, "$1");
  if (Buffer.byteLength(input.serviceUrl) > 512 || url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname.replace(/^\[|\]$/g, "")) || input.serviceUrl.includes("?") || input.serviceUrl.includes("#") || (alias !== url.href && `${alias}/` !== url.href)) throw new Error("DISCOVERY_INVALID_METADATA");
  for (const [name, value] of input.request.query) url.searchParams.append(name, value);
  if (Buffer.byteLength(url.href) > 2048) throw new Error("DISCOVERY_INVALID_METADATA");
  if (input.request.method === "GET" ? input.request.contentType !== null || input.request.body !== null : input.request.contentType !== "application/json" || input.request.body === null) throw new Error("DISCOVERY_INVALID_METADATA");
  const keys = input.targets.map((target) => `${target.network}:${target.asset}:${target.payTo}`);
  if (keys.some((key, index) => index > 0 && keys[index - 1] >= key)) throw new Error("DISCOVERY_INVALID_METADATA");
  return input;
}

export function discoveryPayload(metadata: DiscoveryMetadata) {
  const { signature: _signature, ...payload } = metadata;
  return { payload: canonicalJSON(payload), payloadHash: hashJSON(payload) };
}
export function discoveryDigest(metadata: DiscoveryMetadata): Hex {
  return hashTypedData({ domain: domain(metadata.chainId, metadata.contract), types: discoveryTypes, primaryType: "DiscoveryMetadata", message: { payloadHash: discoveryPayload(metadata).payloadHash } });
}
export function discoveryIdentity(metadata: Pick<DiscoveryMetadata, "chainId" | "contract" | "demandId">) {
  return `${metadata.chainId}:${metadata.contract}:${metadata.demandId}`;
}
export async function verifyDiscoverySignature(client: PublicClient, metadata: DiscoveryMetadata, blockHash: Hex): Promise<boolean> {
  const digest = discoveryDigest(metadata);
  if (await signedBy(digest, metadata.signature, metadata.builder)) return true;
  let result: Hex | undefined;
  try { result = await client.request({ method: "eth_call", params: [{ to: metadata.builder as Address, data: encodeFunctionData({ abi: walletAbi, functionName: "isValidSignature", args: [digest, metadata.signature] }) }, { blockHash, requireCanonical: true }] }); }
  catch (error) { if (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError)) return false; throw error; }
  if (!result) return false;
  try { return decodeFunctionResult({ abi: walletAbi, functionName: "isValidSignature", data: result }) === "0x1626ba7e"; } catch { return false; }
}
