import Ajv2020 from "ajv/dist/2020";
import { isIP } from "node:net";
import schema from "../docs/schemas/validation-policy.json";
import { hashJSON, parseStrictJSON, parseUint256, ValidationError } from "./validation-codec";

export interface PriceAsset { network: string; asset: string; decimals: number }
export interface TransferMethod {
  method: "eip3009" | "permit2";
  enabled: boolean;
  paymentFlows: "authorization"[];
  defaultPaymentFlow: "authorization" | null;
  tokenDomain: { name: string; version: string } | null;
  permit2Contract: string | null;
  settlementSpender: string | null;
}
export interface PaymentProfile {
  id: string; enabled: boolean; network: string; x402Versions: 2[]; schemes: "exact"[];
  assets: { asset: string; decimals: number; enabled: boolean; defaultTransferMethod: "eip3009" | "permit2" | null; transferMethods: TransferMethod[] }[];
  paymentRules: { amountType: "uint256"; priceComparison: "same-asset-exact"; maxTimeoutSeconds: number };
  receiverRules: { mode: "builder-authorized"; allowZeroAddress: false };
  facilitator: { id: string; url: string } | null;
}
export interface PolicyEnvelope {
  schemaVersion: "unmet-validation-policy-v2"; escrowChainId: string; escrowContract: string;
  profile: PaymentProfile; demandPriceAsset: PriceAsset;
}
export interface Deployment {
  escrowChainId: string; escrowContract: string; escrowRpcUrl: string; verifier: string; demandPriceAsset: PriceAsset;
  paymentProfiles: (PaymentProfile & { paymentRpcUrl: string })[];
}
export interface ValidationConfig { maxInFlight: number; managementAddresses: string[]; deployments: Deployment[]; signerSocketPath: string; signerAuthTokenPath: string }

const ajv = new Ajv2020();
const validatePolicy = ajv.compile<PolicyEnvelope>(schema);
const configSchema = {
  type: "object", additionalProperties: false, required: ["maxInFlight", "managementAddresses", "deployments", "signerSocketPath", "signerAuthTokenPath"],
  properties: {
    signerSocketPath: {type:"string",pattern:"^/"}, signerAuthTokenPath: {type:"string",pattern:"^/"},
    maxInFlight: { type: "integer", minimum: 1, maximum: 1024 },
    managementAddresses: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    deployments: { type: "array", minItems: 1, items: {
      type: "object", additionalProperties: false,
      required: ["escrowChainId", "escrowContract", "escrowRpcUrl", "verifier", "demandPriceAsset", "paymentProfiles"],
      properties: {
        escrowChainId: { type: "string" }, escrowContract: { type: "string" }, escrowRpcUrl: { type: "string" }, verifier: {type:"string",pattern:"^0x(?!0{40}$)[0-9a-f]{40}$"},
        demandPriceAsset: { type: "object" },
        paymentProfiles: { type: "array", minItems: 1, items: { type: "object", required: ["paymentRpcUrl"], properties: { paymentRpcUrl: { type: "string" } } } },
      },
    } },
  },
};
const validateConfig = ajv.compile<ValidationConfig>(configSchema);
function invalid(): never { throw new ValidationError("FAIL", "INVALID_CONFIG"); }
function sorted(values: string[]): boolean { return values.every((value, i) => i === 0 || values[i - 1] < value); }
function validUrl(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password && !url.hash; } catch { return false; }
}
function validateEnvelope(policy: PolicyEnvelope): void {
  if (!validatePolicy(policy)) invalid();
  try {
    if (parseUint256(policy.escrowChainId) === 0n) invalid();
    for (const network of [policy.profile.network, policy.demandPriceAsset.network]) parseUint256(network.slice(7));
  } catch { invalid(); }
  const profile = policy.profile;
  if (!sorted(profile.x402Versions.map(String)) || !sorted(profile.schemes) || !sorted(profile.assets.map(a => a.asset))) invalid();
  if (profile.facilitator) {
    try {
      const url = new URL(profile.facilitator.url);
      if (url.protocol !== "https:" || url.href !== profile.facilitator.url || url.username || url.password || url.search || url.hash) invalid();
    } catch { invalid(); }
  }
  for (const asset of profile.assets) {
    if (!sorted(asset.transferMethods.map(m => m.method))) invalid();
    if (asset.defaultTransferMethod && !asset.transferMethods.some(m => m.method === asset.defaultTransferMethod)) invalid();
    for (const method of asset.transferMethods) {
      if (!sorted(method.paymentFlows) || (method.defaultPaymentFlow && !method.paymentFlows.includes(method.defaultPaymentFlow))) invalid();
    }
  }
}
export function parseValidationConfig(raw: Uint8Array): ValidationConfig {
  const config = parseStrictJSON(raw, 12);
  if (!validateConfig(config)) invalid();
  if (config.managementAddresses.some(address => !isIP(address))) invalid();
  const deployments = new Set<string>();
  for (const deployment of config.deployments) {
    if (deployment.verifier.length !== 42 || !/^0x[0-9a-f]{40}$/.test(deployment.verifier) || deployment.verifier === `0x${"0".repeat(40)}`) invalid();
    if (!validUrl(deployment.escrowRpcUrl)) invalid();
    const key = `${deployment.escrowChainId}:${deployment.escrowContract}`;
    if (deployments.has(key)) invalid();
    deployments.add(key);
    const networks = new Set<string>();
    for (const entry of deployment.paymentProfiles) {
      const { paymentRpcUrl, ...profile } = entry;
      if (!validUrl(paymentRpcUrl)) invalid();
      const policy: PolicyEnvelope = { schemaVersion: "unmet-validation-policy-v2", escrowChainId: deployment.escrowChainId, escrowContract: deployment.escrowContract, profile, demandPriceAsset: deployment.demandPriceAsset };
      validateEnvelope(policy);
      if (networks.has(profile.network)) invalid();
      networks.add(profile.network);
    }
  }
  return config;
}
export function resolvePolicy(config: ValidationConfig, chainId: string, contract: string, network: string): { policy: PolicyEnvelope; escrowRpcUrl: string; paymentRpcUrl: string; verifier:string } | undefined {
  for (const deployment of config.deployments) {
    if (deployment.escrowChainId !== chainId || deployment.escrowContract !== contract) continue;
    for (const entry of deployment.paymentProfiles) {
      if (entry.network !== network || !entry.enabled) continue;
      const { paymentRpcUrl, ...profile } = entry;
      return { policy: { schemaVersion: "unmet-validation-policy-v2", escrowChainId: chainId, escrowContract: contract, profile, demandPriceAsset: deployment.demandPriceAsset }, escrowRpcUrl: deployment.escrowRpcUrl, paymentRpcUrl, verifier:deployment.verifier };
    }
  }
  return undefined;
}
export function validationPolicyId(policy: PolicyEnvelope): `0x${string}` { validateEnvelope(policy); return hashJSON(policy); }
