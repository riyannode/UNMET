import type { DiscoveryMetadata, DiscoveryOffer } from "../shared/discovery-types.ts";
import { SERVICE_PRICE_ASSET } from "../shared/service-price.ts";
import { canonicalJSON, hashJSON, type JSONObject } from "./validation-codec.ts";
import { normalizeOffer, normalizeResource, parseChallenge } from "./validation-evaluator.ts";
import { validationPolicyId, type ObserverDeployment, type PolicyEnvelope } from "./validation-config.ts";

export function discoveryRequest(metadata: DiscoveryMetadata) {
  const url = new URL(metadata.serviceUrl);
  for (const [name, value] of metadata.request.query) url.searchParams.append(name, value);
  return { url: url.href, body: metadata.request.body === null ? null : canonicalJSON(metadata.request.body),
    requestHash: hashJSON({ schemaVersion: "unmet-http-request-v1", url: url.href, method: metadata.request.method, contentType: metadata.request.contentType, body: metadata.request.body }) };
}

export function evaluateDiscovery(metadata: DiscoveryMetadata, response: { status: number; paymentRequired: string | null }, deployment: ObserverDeployment, verifiedAssets: Set<string>, maxUnitPrice: bigint) {
  if (response.status >= 500 && response.status <= 599) throw new Error("DISCOVERY_PROVIDER_UNAVAILABLE");
  if (response.status !== 402 || !response.paymentRequired) throw new Error("DISCOVERY_INCOMPATIBLE");
  const value = parseChallenge(response.paymentRequired);
  const accepts = value.accepts as JSONObject[];
  if (accepts.length > 32) throw new Error("DISCOVERY_INVALID_CHALLENGE");
  const request = discoveryRequest(metadata);
  const resource = value.resource as JSONObject;
  normalizeResource(resource, request.url);
  const offers: DiscoveryOffer[] = [];
  for (const offer of accepts) {
    if (typeof offer.network !== "string" || typeof offer.asset !== "string" || typeof offer.payTo !== "string" || typeof offer.amount !== "string" || typeof offer.maxTimeoutSeconds !== "number") continue;
    const asset = offer.asset.toLowerCase(), payTo = offer.payTo.toLowerCase();
    if (!metadata.targets.some((target) => target.network === offer.network && target.asset === asset && target.payTo === payTo)) continue;
    const profile = deployment.paymentProfiles.find((item) => item.enabled && item.network === offer.network);
    const configured = profile?.assets.find((item) => item.enabled && item.asset === asset);
    if (!profile || !configured || !verifiedAssets.has(`${offer.network}:${asset}`)) continue;
    const normalized = normalizeOffer(offer, profile);
    if (!normalized) continue;
    const amount = BigInt(normalized.amount as string);
    const extra = normalized.extra as JSONObject;
    const comparable = deployment.demandPriceAsset.network === SERVICE_PRICE_ASSET.network && deployment.demandPriceAsset.asset === SERVICE_PRICE_ASSET.asset && deployment.demandPriceAsset.decimals === SERVICE_PRICE_ASSET.decimals && offer.network === SERVICE_PRICE_ASSET.network && asset === SERVICE_PRICE_ASSET.asset && configured.decimals === SERVICE_PRICE_ASSET.decimals;
    const { paymentRpcUrl: _paymentRpcUrl, ...policyProfile } = profile;
    const policy: PolicyEnvelope = { schemaVersion: "unmet-validation-policy-v2", escrowChainId: deployment.escrowChainId, escrowContract: deployment.escrowContract, profile: policyProfile, demandPriceAsset: deployment.demandPriceAsset };
    offers.push({ scheme: "exact", network: offer.network, asset, amount: amount.toString(), payTo, maxTimeoutSeconds: offer.maxTimeoutSeconds, transferMethod: extra.assetTransferMethod as string, paymentFlow: extra.paymentFlow as string, extra, validationPolicyId: validationPolicyId(policy), withinOriginatingMaxPrice: comparable ? amount <= maxUnitPrice : null });
  }
  offers.sort((a, b) => canonicalJSON(a) < canonicalJSON(b) ? -1 : canonicalJSON(a) > canonicalJSON(b) ? 1 : 0);
  return { requestHash: request.requestHash, offers };
}
