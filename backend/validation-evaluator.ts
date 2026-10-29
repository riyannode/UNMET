import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalJSON, hashJSON, parseStrictJSON, parseUint256, ValidationError, type JSONObject, type JSONValue } from "./validation-codec";
import { validationPolicyId, type PolicyEnvelope } from "./validation-config";

export type ValidationRequest = {
  schemaVersion: "unmet-x402-validation-v1"; escrowChainId: string; escrowContract: string;
  demandId: string; submissionNonce: string; builderWallet: string; authorizedPayTo: string;
  serviceUrl: string; evidenceHash: string; paymentNetwork: string;
  request: { method: "GET" | "POST"; query: [string, string][]; contentType: "application/json" | null; body: JSONObject | null };
  builderAuthorization: { issuedAt: string; expiresAt: string; signature: string };
};
export type ParsedValidationRequest = { input: ValidationRequest; requestUrl: string; requestHash: `0x${string}`; postBody: string | null };
const requestSchema = JSON.parse(readFileSync(new URL("../docs/schemas/validation-request.json", import.meta.url), "utf8"));
const validateRequest = new Ajv2020({ strict: true }).compile<ValidationRequest>(requestSchema);
const fail = (code: string): never => { throw new ValidationError("FAIL", code); };
const unavailable = (code: string): never => { throw new ValidationError("UNAVAILABLE", code); };
const obj = (v: JSONValue | undefined): v is JSONObject => v !== null && typeof v === "object" && !Array.isArray(v);
const address = (v: string) => /^0x(?!0{40}$)[0-9a-fA-F]{40}$/.test(v);

export function parseValidationRequest(raw: Uint8Array): ParsedValidationRequest {
  if (raw.byteLength > 32768) return fail("INVALID_REQUEST");
  const input = parseStrictJSON(raw);
  if (!validateRequest(input)) return fail("INVALID_REQUEST");
  try {
    for (const n of [input.escrowChainId, input.demandId, input.submissionNonce, input.builderAuthorization.issuedAt, input.builderAuthorization.expiresAt, input.paymentNetwork.slice(7)]) parseUint256(n);
    if (BigInt(input.builderAuthorization.issuedAt) > 2n ** 64n - 1n || BigInt(input.builderAuthorization.expiresAt) > 2n ** 64n - 1n) return fail("INVALID_REQUEST");
  } catch { return fail("INVALID_REQUEST"); }
  let url: URL;
  try { url = new URL(input.serviceUrl); } catch { return fail("INVALID_REQUEST"); }
  const alias = input.serviceUrl.replace(/^(https:\/\/[^/]+):443(?=\/|$)/, "$1");
  if (Buffer.byteLength(input.serviceUrl) > 512 || Buffer.byteLength(url.href) > 512 || (alias !== url.href && `${alias}/` !== url.href) || url.protocol !== "https:" || url.username || url.password ||
      input.serviceUrl.includes("?") || input.serviceUrl.includes("#") || !url.hostname || url.port ||
      isIP(url.hostname.replace(/^\[|\]$/g, ""))) return fail("INVALID_REQUEST");
  // WHATWG serialization removes the explicit default port 443.
  input.serviceUrl = url.href;
  for (const [name, value] of input.request.query) url.searchParams.append(name, value);
  if (Buffer.byteLength(url.href) > 2048) return fail("INVALID_REQUEST");
  const postBody = input.request.body === null ? null : canonicalJSON(input.request.body);
  const requestHash = hashJSON({ schemaVersion: "unmet-http-request-v1", url: url.href, method: input.request.method, contentType: input.request.contentType, body: input.request.body });
  return { input, requestUrl: url.href, requestHash, postBody };
}

// x402 V2 core wire shape at 3c0a740ef84f5a58215a75b709b2f3332839463c.
// Optional extra is an object when present; standard padded or unpadded base64 is accepted.
function challenge(header: string): JSONObject {
  if (header.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(header)) return fail("INVALID_CHALLENGE");
  const bytes = Buffer.from(header, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== header.replace(/=+$/, "")) return fail("INVALID_CHALLENGE");
  let value: JSONValue;
  try { value = parseStrictJSON(bytes); } catch { return fail("INVALID_CHALLENGE"); }
  if (!obj(value) || value.x402Version !== 2 || !obj(value.resource) || typeof value.resource.url !== "string" || !value.resource.url.trim() ||
      !Array.isArray(value.accepts) || !value.accepts.length ||
      ("error" in value && typeof value.error !== "string") || ("extensions" in value && !obj(value.extensions))) return fail("INVALID_CHALLENGE");
  const resource = value.resource;
  for (const key of ["description", "mimeType", "serviceName", "iconUrl"]) if (key in resource && typeof resource[key] !== "string") return fail("INVALID_CHALLENGE");
  if ("serviceName" in resource && (typeof resource.serviceName !== "string" || !/^[\x20-\x7e]{1,32}$/.test(resource.serviceName))) return fail("INVALID_CHALLENGE");
  if ("tags" in resource && (!Array.isArray(resource.tags) || resource.tags.length > 5 || resource.tags.some(x => typeof x !== "string" || !/^[\x20-\x7e]{1,32}$/.test(x)))) return fail("INVALID_CHALLENGE");
  if ("iconUrl" in resource) { try { const u = new URL(resource.iconUrl as string); if (!["http:", "https:"].includes(u.protocol) || (resource.iconUrl as string).length > 2048) return fail("INVALID_CHALLENGE"); } catch { return fail("INVALID_CHALLENGE"); } }
  if (obj(value.extensions)) for (const extension of Object.values(value.extensions)) if (!obj(extension) || !obj(extension.info) || !obj(extension.schema)) return fail("INVALID_CHALLENGE");
  for (const offer of value.accepts) {
    if (!obj(offer) || typeof offer.scheme !== "string" || !offer.scheme || typeof offer.network !== "string" ||
        !/^[a-z0-9-]{3,8}:[a-zA-Z0-9_-]{1,32}$/.test(offer.network) || typeof offer.asset !== "string" || !offer.asset ||
        typeof offer.amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(offer.amount) ||
        typeof offer.payTo !== "string" || !offer.payTo || typeof offer.maxTimeoutSeconds !== "number" ||
        !Number.isFinite(offer.maxTimeoutSeconds) || offer.maxTimeoutSeconds <= 0 || ("extra" in offer && !obj(offer.extra))) return fail("INVALID_CHALLENGE");
  }
  return value;
}

export function evaluateChallenge(parsed: ParsedValidationRequest, observation: { status: number; paymentRequired: string | null }, policy: PolicyEnvelope, maxUnitPrice: bigint, verifiedDecimals: number) {
  if (policy.escrowChainId !== parsed.input.escrowChainId || policy.escrowContract !== parsed.input.escrowContract || policy.profile.network !== parsed.input.paymentNetwork) return fail("INVALID_POLICY");
  if (observation.status >= 500 && observation.status <= 599) return unavailable("ENDPOINT_UNAVAILABLE");
  if (observation.status !== 402 || observation.paymentRequired === null) return fail("INVALID_CHALLENGE");
  const value = challenge(observation.paymentRequired);
  const resource = value.resource as JSONObject;
  let url: URL;
  try { url = new URL(resource.url as string, parsed.requestUrl); } catch { return fail("INVALID_RESOURCE"); }
  const requested = new URL(parsed.requestUrl);
  if (url.username || url.password || /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:[\\/]*|[\\/]{2,})[^/\\?#]*@/.test(resource.url as string) || (resource.url as string).includes("#") || url.origin !== requested.origin || url.pathname !== requested.pathname || (url.search && url.search !== requested.search)) return fail("INVALID_RESOURCE");
  const normalizedResource: JSONObject = { ...resource, url: url.href };
  let incomparable = false;
  for (const [index, item] of (value.accepts as JSONObject[]).entries()) {
    const offer = item;
    const network = offer.network as string, asset = offer.asset as string, payTo = offer.payTo as string;
    if (!policy.profile.enabled || offer.scheme !== "exact" || !policy.profile.schemes.includes("exact") || !address(asset) || !address(payTo)) continue;
    if (network !== policy.demandPriceAsset.network || asset.toLowerCase() !== policy.demandPriceAsset.asset) incomparable = true;
    if (network !== policy.profile.network) continue;
    const configured = policy.profile.assets.find(a => a.asset === asset.toLowerCase() && a.enabled);
    if (!configured) continue;
    const extra = obj(offer.extra) ? offer.extra : {};
    const methodName = "assetTransferMethod" in extra ? extra.assetTransferMethod : configured.defaultTransferMethod;
    const method = configured.transferMethods.find(m => m.method === methodName && m.enabled);
    if (!method) continue;
    const flow = "paymentFlow" in extra ? extra.paymentFlow : method.defaultPaymentFlow;
    if (flow !== "authorization" || !method.paymentFlows.includes("authorization")) continue;
    if (method.method === "eip3009" && (!method.tokenDomain || extra.name !== method.tokenDomain.name || extra.version !== method.tokenDomain.version)) continue;
    if (payTo.toLowerCase() !== parsed.input.authorizedPayTo || !Number.isSafeInteger(offer.maxTimeoutSeconds) || (offer.maxTimeoutSeconds as number) > policy.profile.paymentRules.maxTimeoutSeconds) continue;
    if (network !== policy.demandPriceAsset.network || asset.toLowerCase() !== policy.demandPriceAsset.asset || configured.decimals !== policy.demandPriceAsset.decimals || verifiedDecimals !== configured.decimals) { incomparable = true; continue; }
    let amount: bigint;
    try { amount = parseUint256(offer.amount as string); } catch { continue; }
    if (amount > maxUnitPrice) continue;
    const selected: JSONObject = { scheme: offer.scheme, network, asset: asset.toLowerCase(), amount: amount.toString(), payTo: payTo.toLowerCase(), maxTimeoutSeconds: offer.maxTimeoutSeconds, extra: { ...extra, assetTransferMethod: method.method, paymentFlow: flow } };
    const paymentRequirementsHash = hashJSON({ schemaVersion: "unmet-payment-requirements-v2", x402Version: 2, resource: normalizedResource, requestHash: parsed.requestHash, selected });
    return { eligible: true as const, selectedOffer: selected, selectedOfferIndex: index, requestHash: parsed.requestHash, paymentRequirementsHash, validationPolicyId: validationPolicyId(policy) };
  }
  return fail(incomparable ? "UNSUPPORTED_PRICE_COMPARISON" : "NO_ELIGIBLE_OFFER");
}
