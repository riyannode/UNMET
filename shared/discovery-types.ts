export type DiscoveryMetadata = {
  schemaVersion: "unmet-discovery-v1";
  chainId: string; contract: `0x${string}`; demandId: string; builder: `0x${string}`;
  serviceUrl: string; evidenceHash: `0x${string}`; revision: string; issuedAt: string;
  request: { method: "GET" | "POST"; query: [string, string][]; contentType: "application/json" | null; body: Record<string, unknown> | null };
  targets: { network: string; asset: `0x${string}`; payTo: `0x${string}` }[];
  signature: `0x${string}`;
};

export const discoveryTypes = { DiscoveryMetadata: [
  { name: "payloadHash", type: "bytes32" },
] } as const;

export type DiscoveryOffer = {
  scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number;
  transferMethod: string; paymentFlow: string; extra: Record<string, unknown>; validationPolicyId: string; withinOriginatingMaxPrice: boolean | null;
};
export type DiscoveryState = "pending" | "metadata_invalid" | "compatible" | "incompatible" | "unavailable" | "stale";
export type DiscoveryView = {
  metadataState: "missing" | "valid" | "invalid"; state: DiscoveryState; metadata?: unknown; observedAt?: string | null; lastAttemptAt?: string;
  reason?: string | null; requestHash?: string; blockHash?: string; metadataRevision?: string; offers: DiscoveryOffer[];
};
export type DiscoveryObservation = { state: Exclude<DiscoveryState, "pending" | "stale">; reason: string | null; offers: DiscoveryOffer[]; metadataRevision?: string; requestHash?: string; blockHash?: string };
export type StoredDiscoveryObservation = { observedAt: number | null; lastAttemptAt: number; generation: number; failure: string | null; result: DiscoveryObservation | null };

export function isDiscoveryState(value: unknown): value is DiscoveryState {
  return typeof value === "string" && ["pending", "metadata_invalid", "compatible", "incompatible", "unavailable", "stale"].includes(value);
}
export function isDiscoveryView(value: unknown): value is DiscoveryView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (typeof data.metadataState !== "string" || !["missing", "valid", "invalid"].includes(data.metadataState) || !isDiscoveryState(data.state) || !Array.isArray(data.offers) || data.offers.length > 32) return false;
  if (data.observedAt !== undefined && data.observedAt !== null && typeof data.observedAt !== "string") return false;
  if (data.reason !== undefined && data.reason !== null && typeof data.reason !== "string") return false;
  for (const key of ["lastAttemptAt", "requestHash", "blockHash", "metadataRevision"]) if (data[key] !== undefined && typeof data[key] !== "string") return false;
  return data.offers.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const offer = item as Record<string, unknown>;
    return [offer.network, offer.asset, offer.amount, offer.payTo, offer.scheme, offer.transferMethod, offer.paymentFlow, offer.validationPolicyId].every((field) => typeof field === "string") && Number.isSafeInteger(offer.maxTimeoutSeconds) && typeof offer.maxTimeoutSeconds === "number" && offer.maxTimeoutSeconds > 0 && !!offer.extra && typeof offer.extra === "object" && !Array.isArray(offer.extra) && (typeof offer.withinOriginatingMaxPrice === "boolean" || offer.withinOriginatingMaxPrice === null);
  });
}
