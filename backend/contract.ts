import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Abi,
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

export const AGENT_DEMAND_ABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token_", type: "address" },
      { name: "treasury_", type: "address" },
      { name: "feeBps_", type: "uint16" },
      { name: "quorumBps_", type: "uint16" },
      { name: "minCommitment_", type: "uint96" },
      { name: "reviewPeriod_", type: "uint32" },
    ],
  },
  { type: "function", name: "nextDemandId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalEscrowed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "quorumBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "minCommitment", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint96" }] },
  { type: "function", name: "reviewPeriod", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint32" }] },
  {
    type: "function",
    name: "createDemand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "capability", type: "string" },
      { name: "specification", type: "string" },
      { name: "maxUnitPrice", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
      { name: "deadline", type: "uint64" },
      { name: "initialCommitment", type: "uint96" },
    ],
    outputs: [{ name: "demandId", type: "uint256" }],
  },
  {
    type: "function",
    name: "supportDemand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "demandId", type: "uint256" },
      { name: "amount", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitService",
    stateMutability: "nonpayable",
    inputs: [
      { name: "demandId", type: "uint256" },
      { name: "serviceUrl", type: "string" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "approveService", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "rejectService", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "reopen", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "computeDemandKey",
    stateMutability: "pure",
    inputs: [{ name: "capability", type: "string" }, { name: "specification", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getDemand",
    stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "creator", type: "address" },
        { name: "builder", type: "address" },
        { name: "maxUnitPrice", type: "uint96" },
        { name: "committed", type: "uint128" },
        { name: "reviewCommitted", type: "uint128" },
        { name: "approvalRequired", type: "uint128" },
        { name: "expectedCalls", type: "uint64" },
        { name: "deadline", type: "uint64" },
        { name: "reviewEndsAt", type: "uint64" },
        { name: "supporterCount", type: "uint32" },
        { name: "status", type: "uint8" },
        { name: "capability", type: "string" },
        { name: "specification", type: "string" },
        { name: "serviceUrl", type: "string" },
        { name: "evidenceHash", type: "bytes32" },
      ],
    }],
  },
  {
    type: "function",
    name: "getSupport",
    stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }, { name: "supporter", type: "address" }],
    outputs: [
      { name: "commitment", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
      { name: "approvedCurrentSubmission", type: "bool" },
      { name: "rejectedCurrentSubmission", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "approvalProgress",
    stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [
      { name: "weight", type: "uint256" },
      { name: "required", type: "uint256" },
      { name: "quorumReached", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "rejectionProgress",
    stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [
      { name: "weight", type: "uint256" },
      { name: "thresholdToBlock", type: "uint256" },
      { name: "candidateRejected", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isRefundable",
    stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }, { name: "supporter", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "DemandCreated",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "demandKey", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "capability", type: "string", indexed: false },
      { name: "maxUnitPrice", type: "uint96", indexed: false },
      { name: "expectedCalls", type: "uint64", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "initialCommitment", type: "uint96", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DemandSupported",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
      { name: "expectedCalls", type: "uint64", indexed: false },
      { name: "committedTotal", type: "uint128", indexed: false },
      { name: "supporterCount", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ServiceSubmitted",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "serviceUrl", type: "string", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "reviewEndsAt", type: "uint64", indexed: false },
      { name: "reviewCommitted", type: "uint128", indexed: false },
      { name: "approvalRequired", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ServiceApproved",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "weight", type: "uint96", indexed: false },
      { name: "approvalWeight", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ServiceRejected",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "weight", type: "uint96", indexed: false },
      { name: "rejectionWeight", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SubmissionRejected",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "approvalWeight", type: "uint256", indexed: false },
      { name: "rejectionWeight", type: "uint256", indexed: false },
      { name: "approvalRequired", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DemandFulfilled",
    inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "treasury", type: "address", indexed: true },
      { name: "approvedAmount", type: "uint128", indexed: false },
      { name: "fee", type: "uint128", indexed: false },
      { name: "payout", type: "uint128", indexed: false },
      { name: "remainingRefundable", type: "uint128", indexed: false },
    ],
  },
  { type: "event", name: "Refunded", inputs: [
    { name: "demandId", type: "uint256", indexed: true },
    { name: "supporter", type: "address", indexed: true },
    { name: "amount", type: "uint96", indexed: false },
  ] },
  { type: "event", name: "DemandClosed", inputs: [
    { name: "demandId", type: "uint256", indexed: true },
    { name: "demandKey", type: "bytes32", indexed: true },
  ] },
] as const satisfies Abi;

export const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const satisfies Abi;

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

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  return getAddress(value);
}

export function loadConfig() {
  const chainId = Number(process.env.CHAIN_ID || "1952");
  if (chainId !== 1952 && chainId !== 196) throw new Error("CHAIN_ID must be 1952 or 196");
  const rpcUrl = process.env.XLAYER_RPC_URL || (chainId === 196 ? X_LAYER_MAINNET.rpcUrls.default.http[0] : X_LAYER_TESTNET.rpcUrls.default.http[0]);
  const contract = optionalAddress(process.env.DEMAND_CONTRACT);
  const deployBlock = BigInt(process.env.DEMAND_DEPLOY_BLOCK || "0");
  const paymentToken = getAddress(process.env.PAYMENT_TOKEN || (chainId === 196
    ? "0x779ded0c9e1022225f8e0630b35a9b54be713736"
    : "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c"));
  return { rpcUrl, chainId, contract, deployBlock, paymentToken };
}

export function getPublicClient(rpcUrl?: string): PublicClient {
  const cfg = loadConfig();
  const url = rpcUrl || cfg.rpcUrl;
  const chain = cfg.chainId === 196 ? X_LAYER_MAINNET : X_LAYER_TESTNET;
  return createPublicClient({
    chain: { ...chain, rpcUrls: { default: { http: [url] } } },
    transport: http(url, { timeout: 15_000, retryCount: 2 }),
  }) as PublicClient;
}

export async function readDemand(client: PublicClient, contract: Address, demandId: bigint): Promise<DemandTuple> {
  return await client.readContract({
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "getDemand",
    args: [demandId],
  }) as DemandTuple;
}

export async function readNextDemandId(client: PublicClient, contract: Address): Promise<bigint> {
  return await client.readContract({
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "nextDemandId",
  }) as bigint;
}

export async function readApprovalProgress(client: PublicClient, contract: Address, demandId: bigint) {
  return await client.readContract({
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "approvalProgress",
    args: [demandId],
  }) as readonly [bigint, bigint, boolean];
}

export async function readRejectionProgress(client: PublicClient, contract: Address, demandId: bigint) {
  return await client.readContract({
    address: contract,
    abi: AGENT_DEMAND_ABI,
    functionName: "rejectionProgress",
    args: [demandId],
  }) as readonly [bigint, bigint, boolean];
}

export function statusLabel(status: number): "OPEN" | "SUBMITTED" | "FULFILLED" | "CLOSED" | "UNKNOWN" {
  if (status === 0) return "OPEN";
  if (status === 1) return "SUBMITTED";
  if (status === 2) return "FULFILLED";
  if (status === 3) return "CLOSED";
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

export function isoFromUnix(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toISOString();
}
