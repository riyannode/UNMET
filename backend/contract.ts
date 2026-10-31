import { httpUrl, loadOperationalConfig } from "./config.ts";
import { createBoundedFetch } from "./upstream.ts";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";

export const X_LAYER_TESTNET = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" } },
});

export const X_LAYER_MAINNET = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer" } },
});

export { AGENT_DEMAND_ABI, ERC20_ABI } from "../shared/abi.ts";
import { AGENT_DEMAND_ABI, ERC20_ABI } from "../shared/abi.ts";
import { validateDeployment, verifyDeployment, type EscrowDeployment } from "../shared/deployment.ts";

export type DemandTuple = {
  creator: Address;
  builder: Address;
  maxUnitPrice: bigint;
  committed: bigint;
  reviewCommitted: bigint;
  approvalRequired: bigint;
  expectedCalls: bigint;
  deadline: bigint;
  reviewEndsAt: bigint;
  supporterCount: number;
  status: number;
  capability: string;
  specification: string;
  serviceUrl: string;
  evidenceHash: `0x${string}`;
};

function optionalAddress(value: string | undefined, key: string): Address | undefined {
  if (!value) return undefined;
  try {
    const address = getAddress(value);
    if (/^0x0{40}$/i.test(address)) throw new Error();
    return address;
  } catch { throw new Error(`CONFIG_INVALID: ${key}`); }
}

export function loadConfig() {
  const chainId = Number(process.env.CHAIN_ID || "1952");
  if (!/^\d+$/.test(process.env.CHAIN_ID || "1952") || !Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("CONFIG_INVALID: CHAIN_ID");
  const knownChain = chainId === 196 ? X_LAYER_MAINNET : chainId === 1952 ? X_LAYER_TESTNET : undefined;
  const rpcUrl = process.env.XLAYER_RPC_URL || knownChain?.rpcUrls.default.http[0] || "";
  httpUrl(rpcUrl, "XLAYER_RPC_URL");
  const contract = optionalAddress(process.env.DEMAND_CONTRACT, "DEMAND_CONTRACT");
  if (!/^\d+$/.test(process.env.DEMAND_DEPLOY_BLOCK || "0")) throw new Error("CONFIG_INVALID: DEMAND_DEPLOY_BLOCK");
  const deployBlock = BigInt(process.env.DEMAND_DEPLOY_BLOCK || "0");
  const paymentToken = optionalAddress(process.env.PAYMENT_TOKEN, "PAYMENT_TOKEN");
  const decimalsRaw = process.env.PAYMENT_TOKEN_DECIMALS;
  if (decimalsRaw !== undefined && (!/^\d+$/.test(decimalsRaw) || Number(decimalsRaw) > 255)) throw new Error("CONFIG_INVALID: PAYMENT_TOKEN_DECIMALS");
  if (paymentToken && decimalsRaw === undefined) throw new Error("CONFIG_INVALID: PAYMENT_TOKEN_DECIMALS");
  const nativeDecimals = process.env.CHAIN_NATIVE_DECIMALS;
  if (!knownChain && (!process.env.CHAIN_NAME || !process.env.CHAIN_EXPLORER_URL || !process.env.CHAIN_NATIVE_NAME || !process.env.CHAIN_NATIVE_SYMBOL || nativeDecimals === undefined || !/^\d+$/.test(nativeDecimals) || Number(nativeDecimals) > 255)) throw new Error("CONFIG_INVALID: CHAIN_METADATA");
  const chain = knownChain ? { name: knownChain.name, explorerUrl: knownChain.blockExplorers.default.url, nativeCurrency: knownChain.nativeCurrency } : { name: process.env.CHAIN_NAME!, explorerUrl: process.env.CHAIN_EXPLORER_URL!, nativeCurrency: { name: process.env.CHAIN_NATIVE_NAME!, symbol: process.env.CHAIN_NATIVE_SYMBOL!, decimals: Number(nativeDecimals) } };
  const deployment = contract && paymentToken && decimalsRaw !== undefined ? validateDeployment({
    chainId, contract, rpcUrl, deployBlock,
    chain,
    escrowToken: { address: paymentToken, symbol: process.env.PAYMENT_TOKEN_SYMBOL || "USDC", decimals: Number(decimalsRaw) },
  }) : undefined;
  return { rpcUrl, chainId, contract, deployBlock, paymentToken, deployment };

}

const rpcConfig = loadOperationalConfig();
const rpcFetch = createBoundedFetch({
  maxInFlight: rpcConfig.rpcMaxInFlight,
  timeoutMs: rpcConfig.rpcTimeoutMs,
  maxBytes: rpcConfig.upstreamMaxBytes,
});

export function getPublicClient(deployment: EscrowDeployment): PublicClient {
  validateDeployment(deployment);
  const chain = defineChain({
    id: deployment.chainId, name: deployment.chain.name, nativeCurrency: deployment.chain.nativeCurrency,
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: deployment.chain.explorerUrl } },
  });
  return createPublicClient({
    chain,
    transport: http(deployment.rpcUrl, { timeout: rpcConfig.rpcTimeoutMs, retryCount: 0, fetchFn: rpcFetch }),
  }) as PublicClient;
}

export async function verifyMarket(client: PublicClient, deployment: EscrowDeployment): Promise<void> {
  await verifyDeployment({
    getChainId: () => client.getChainId(),
    getBytecode: (address) => client.getBytecode({ address }),
    getToken: (address) => client.readContract({ address, abi: AGENT_DEMAND_ABI, functionName: "token" }),
    getDecimals: (address) => client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
  }, deployment);
}

export async function readDemand(client: PublicClient, contract: Address, demandId: bigint, blockNumber?: bigint): Promise<DemandTuple> {
  return await client.readContract({
    blockNumber,
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "getDemand",
    args: [demandId],
  }) as DemandTuple;
}

export async function readNextDemandId(client: PublicClient, contract: Address, blockNumber?: bigint): Promise<bigint> {
  return await client.readContract({
    blockNumber,
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "nextDemandId",
  }) as bigint;
}

export async function readApprovalProgress(client: PublicClient, contract: Address, demandId: bigint, blockNumber?: bigint) {
  return await client.readContract({
    blockNumber,
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "approvalProgress",
    args: [demandId],
  }) as readonly [bigint, bigint, boolean];
}

export async function readRejectionProgress(client: PublicClient, contract: Address, demandId: bigint, blockNumber?: bigint) {
  return await client.readContract({
    blockNumber,
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "rejectionProgress",
    args: [demandId],
  }) as readonly [bigint, bigint, boolean];
}

export function statusLabel(status: number): "OPEN" | "SUBMITTED" | "FULFILLED" | "CLOSED" | "CANCELLED" | "UNKNOWN" {
  if (status === 0) return "OPEN";
  if (status === 1) return "SUBMITTED";
  if (status === 2) return "FULFILLED";
  if (status === 3) return "CLOSED";
  if (status === 4) return "CANCELLED";
  return "UNKNOWN";
}

export function formatUnits6(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  return `${neg ? "-" : ""}${whole}.${frac.toString().padStart(6, "0")}`;
}

export function parseUnits6(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("invalid 6-decimal amount");
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function isoFromUnix(ts: bigint): string | null {
  const millis = ts * 1000n;
  const maxDateMillis = 8_640_000_000_000_000n;
  if (millis > maxDateMillis || millis < -maxDateMillis) return null;
  return new Date(Number(millis)).toISOString();
}
