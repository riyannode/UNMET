import Ajv2020 from "ajv/dist/2020";
import canonicalize from "canonicalize";
import { hashTypedData, keccak256, recoverAddress, sha256, stringToHex, type Address, type Hex } from "viem";
import schema from "../docs/schemas/validation-response.json";
import requestSchema from "../docs/schemas/validation-request.json";
import { attestationTypes, authorizationTypes } from "../shared/validation-types";
import { parseStrictJSON, type JSONObject } from "./strict-json";

export type RequestMetadata = { method: "GET" | "POST"; query: [string, string][]; contentType: "application/json" | null; body: object | null };
export type ValidationInput = { chainId: number; contract: Address; demandId: bigint; builder: Address; payTo: Address; serviceUrl: string; evidenceHash: Hex; network: string; nonce: bigint; request: RequestMetadata };
type Attestation = { escrowChainId: string; verifyingContract: Address; demandId: string; builderWallet: Address; serviceUrlHash: Hex; evidenceHash: Hex; paymentRequirementsHash: Hex; submissionNonce: string; validationPolicyId: Hex; issuedAt: string; expiresAt: string };
type Pass = { status: "PASS"; profileId: string; selectedOffer: { network: string; payTo: Address }; requestHash: Hex; paymentRequirementsHash: Hex; validationPolicyId: Hex; validatedAt: string; expiresAt: string; attestation: Attestation; signature: Hex };
const validResponse = new Ajv2020({ strict: false }).compile<Pass | { status: "FAIL" | "UNAVAILABLE" }>(schema);
const validRequest = new Ajv2020({ strict: false }).compile(requestSchema);
export const validationNetworks = (import.meta.env.VITE_VALIDATION_NETWORKS ?? "").split(",").map(value => value.trim()).filter(Boolean);
if (validationNetworks.some(value => !/^eip155:[1-9][0-9]{0,31}$/.test(value))) throw new Error("CONFIG_INVALID: VITE_VALIDATION_NETWORKS");

export function parseRequestMetadata(method: "GET" | "POST", query: string, body: string): RequestMetadata {
  const parse = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    if (new TextDecoder().decode(bytes) !== text) throw new Error("VALIDATION_INVALID_REQUEST");
    return parseStrictJSON(bytes);
  };
  const pairs = parse(query);
  const payload = method === "POST" ? parse(body) : null;
  const isPair = (value: unknown): value is [string, string] => Array.isArray(value) && value.length === 2 && value.every(item => typeof item === "string");
  const isObject = (value: unknown): value is JSONObject => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!Array.isArray(pairs) || pairs.length > 32 || !pairs.every(isPair) || (payload !== null && !isObject(payload)) || (method === "POST" && payload === null)) throw new Error("VALIDATION_INVALID_REQUEST");
  return { method, query: pairs, contentType: method === "POST" ? "application/json" : null, body: payload };
}

export function requestHash(serviceUrl: string, request: RequestMetadata): Hex {
  const url = new URL(serviceUrl);
  for (const [name, value] of request.query) url.searchParams.append(name, value);
  const serialized = canonicalize({ schemaVersion: "unmet-http-request-v1", url: url.href, method: request.method, contentType: request.contentType, body: request.body });
  if (serialized === undefined) throw new Error("VALIDATION_INVALID_REQUEST");
  return sha256(stringToHex(serialized));
}
export function validateRequest(input: ValidationInput, issuedAt: bigint, expiresAt: bigint): void {
  if (input.demandId < 0n || input.demandId >= 1n << 256n || input.nonce <= 0n || input.nonce >= 1n << 256n || issuedAt < 0n || expiresAt >= 1n << 64n || issuedAt >= expiresAt) throw new Error("VALIDATION_INVALID_REQUEST");
  const url = new URL(input.serviceUrl);
  const bytes = new TextEncoder();
  if (bytes.encode(input.serviceUrl).length > 512 || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error("VALIDATION_INVALID_REQUEST");
  for (const [name, value] of input.request.query) url.searchParams.append(name, value);
  if (bytes.encode(url.href).length > 2048) throw new Error("VALIDATION_INVALID_REQUEST");
  const candidate = { schemaVersion: "unmet-x402-validation-v1", escrowChainId: String(input.chainId), escrowContract: input.contract.toLowerCase(), demandId: String(input.demandId), submissionNonce: String(input.nonce), builderWallet: input.builder.toLowerCase(), authorizedPayTo: input.payTo.toLowerCase(), serviceUrl: input.serviceUrl, evidenceHash: input.evidenceHash, paymentNetwork: input.network, request: input.request, builderAuthorization: { issuedAt: String(issuedAt), expiresAt: String(expiresAt), signature: `0x${"00".repeat(65)}` } };
  if (!validRequest(candidate)) throw new Error("VALIDATION_INVALID_REQUEST");
  const raw = JSON.stringify(candidate);
  parseStrictJSON(bytes.encode(raw));
}
export function authorization(input: ValidationInput, issuedAt: bigint, expiresAt: bigint) {
  const domain = { name: "UNMET AgentDemand", version: "2", chainId: input.chainId, verifyingContract: input.contract } as const;
  const message = { demandId: input.demandId, builderWallet: input.builder, serviceUrlHash: keccak256(stringToHex(input.serviceUrl)), evidenceHash: input.evidenceHash, requestHash: requestHash(input.serviceUrl, input.request), paymentNetworkHash: keccak256(stringToHex(input.network)), authorizedPayTo: input.payTo, submissionNonce: input.nonce, issuedAt, expiresAt };
  return { domain, types: authorizationTypes, primaryType: "BuilderValidationAuthorization" as const, message };
}
function validSignature(signature: string): signature is Hex {
  if (!/^0x[0-9a-f]{128}(1b|1c)$/.test(signature)) return false;
  const r = BigInt(`0x${signature.slice(2, 66)}`), s = BigInt(`0x${signature.slice(66, 130)}`);
  return r > 0n && r < 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n && s > 0n && s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
}
export async function validatePass(value: unknown, input: ValidationInput, verifier: Address, now: bigint, authorizationExpires: bigint) {
  if (!validResponse(value) || value.status !== "PASS") throw new Error("VALIDATION_FAILED");
  const pass = value;
  const a = pass.attestation;
  const issued = BigInt(a.issuedAt), expires = BigInt(a.expiresAt);
  if ([a.escrowChainId, a.demandId, a.submissionNonce].some(value => value.length > 78 || BigInt(value) >= 1n << 256n) || issued >= 1n << 64n || expires >= 1n << 64n) throw new Error("VALIDATION_INVALID_PASS");
  if (a.escrowChainId !== String(input.chainId) || a.verifyingContract !== input.contract.toLowerCase() || a.demandId !== String(input.demandId)
      || a.builderWallet !== input.builder.toLowerCase() || a.serviceUrlHash !== keccak256(stringToHex(input.serviceUrl)) || a.evidenceHash !== input.evidenceHash.toLowerCase()
      || a.submissionNonce !== String(input.nonce) || pass.requestHash !== requestHash(input.serviceUrl, input.request)
      || a.paymentRequirementsHash !== pass.paymentRequirementsHash || a.validationPolicyId !== pass.validationPolicyId
      || pass.selectedOffer.network !== input.network || pass.selectedOffer.payTo !== input.payTo.toLowerCase()
      || pass.validatedAt !== a.issuedAt || pass.expiresAt !== a.expiresAt || issued > now + 60n || issued >= expires || expires - issued > 900n || now >= expires || expires > authorizationExpires
      || !validSignature(pass.signature)) throw new Error("VALIDATION_INVALID_PASS");
  const message = { ...a, escrowChainId: BigInt(a.escrowChainId), demandId: BigInt(a.demandId), submissionNonce: BigInt(a.submissionNonce), issuedAt: issued, expiresAt: expires };
  const digest = hashTypedData({ domain: { name: "UNMET AgentDemand", version: "2", chainId: input.chainId, verifyingContract: input.contract }, types: attestationTypes, primaryType: "ValidationAttestation", message });
  if ((await recoverAddress({ hash: digest, signature: pass.signature })).toLowerCase() !== verifier.toLowerCase()) throw new Error("VALIDATION_INVALID_SIGNATURE");
  return { attestation: message, signature: pass.signature };
}
