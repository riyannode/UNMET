import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseUnits,
  toBytes,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "1952");
if (CHAIN_ID !== 1952 && CHAIN_ID !== 196) throw new Error("VITE_CHAIN_ID must be 1952 or 196");

const DEFAULT_RPC = CHAIN_ID === 196 ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech/terigon";
const DEFAULT_TOKEN = CHAIN_ID === 196
  ? "0x779ded0c9e1022225f8e0630b35a9b54be713736"
  : "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";

export const RPC_URL = import.meta.env.VITE_XLAYER_RPC_URL || DEFAULT_RPC;
export const DEMAND_CONTRACT = parseConfiguredAddress(import.meta.env.VITE_DEMAND_CONTRACT, "VITE_DEMAND_CONTRACT");
export const PAYMENT_TOKEN = getAddress(import.meta.env.VITE_PAYMENT_TOKEN || DEFAULT_TOKEN);

export const targetChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: CHAIN_ID === 196
        ? "https://www.okx.com/web3/explorer/xlayer"
        : "https://www.okx.com/web3/explorer/xlayer-test",
    },
  },
});

export const DEMAND_ABI = [
  { type: "function", name: "nextDemandId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function", name: "createDemand", stateMutability: "nonpayable",
    inputs: [
      { name: "capability", type: "string" },
      { name: "specification", type: "string" },
      { name: "maxUnitPrice", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
      { name: "deadline", type: "uint64" },
      { name: "initialCommitment", type: "uint96" },
    ], outputs: [{ name: "demandId", type: "uint256" }],
  },
  {
    type: "function", name: "supportDemand", stateMutability: "nonpayable",
    inputs: [
      { name: "demandId", type: "uint256" },
      { name: "amount", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
    ], outputs: [],
  },
  {
    type: "function", name: "submitService", stateMutability: "nonpayable",
    inputs: [
      { name: "demandId", type: "uint256" },
      { name: "serviceUrl", type: "string" },
      { name: "evidenceHash", type: "bytes32" },
    ], outputs: [],
  },
  { type: "function", name: "approveService", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "rejectService", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "reopen", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "demandId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "getDemand", stateMutability: "view", inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
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
    ] }],
  },
  {
    type: "function", name: "getSupport", stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }, { name: "supporter", type: "address" }],
    outputs: [
      { name: "commitment", type: "uint96" },
      { name: "expectedCalls", type: "uint64" },
      { name: "approvedCurrentSubmission", type: "bool" },
      { name: "rejectedCurrentSubmission", type: "bool" },
    ],
  },
  {
    type: "function", name: "approvalProgress", stateMutability: "view", inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [
      { name: "weight", type: "uint256" },
      { name: "required", type: "uint256" },
      { name: "quorumReached", type: "bool" },
    ],
  },
  {
    type: "function", name: "rejectionProgress", stateMutability: "view", inputs: [{ name: "demandId", type: "uint256" }],
    outputs: [
      { name: "weight", type: "uint256" },
      { name: "thresholdToBlock", type: "uint256" },
      { name: "candidateRejected", type: "bool" },
    ],
  },
  {
    type: "function", name: "isRefundable", stateMutability: "view",
    inputs: [{ name: "demandId", type: "uint256" }, { name: "supporter", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

export const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const satisfies Abi;

export type DemandView = {
  demandId: bigint;
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
  approvalWeight: bigint;
  quorumReached: boolean;
  rejectionWeight: bigint;
  rejectionThreshold: bigint;
  candidateRejected: boolean;
};

export type SupportView = {
  commitment: bigint;
  expectedCalls: bigint;
  approved: boolean;
  rejected: boolean;
  refundable: boolean;
};

type EthereumProvider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
};

declare global {
  interface Window { ethereum?: EthereumProvider; }
}

function parseConfiguredAddress(value: string | undefined, name: string): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address`);
  return getAddress(value);
}

function requireContract(): Address {
  if (!DEMAND_CONTRACT) throw new Error("VITE_DEMAND_CONTRACT is not configured");
  return DEMAND_CONTRACT;
}

function injected(): EthereumProvider {
  if (!window.ethereum) throw new Error("WALLET_NOT_FOUND");
  return window.ethereum;
}

export function getPublic(): PublicClient {
  return createPublicClient({ chain: targetChain, transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
}

export function walletClient() {
  return createWalletClient({ chain: targetChain, transport: custom(injected() as never) });
}

export async function connectWallet(): Promise<Address> {
  const accounts = await injected().request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) throw new Error("WALLET_NOT_FOUND");
  return getAddress(accounts[0]);
}

export async function currentWallet(): Promise<Address | null> {
  if (!window.ethereum) return null;
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) return null;
  return getAddress(accounts[0]);
}

export async function currentChainId(): Promise<number | null> {
  if (!window.ethereum) return null;
  const result = await window.ethereum.request({ method: "eth_chainId" });
  if (typeof result !== "string") return null;
  return Number.parseInt(result, 16);
}

export async function ensureChain(): Promise<void> {
  const eth = injected();
  const current = await currentChainId();
  if (current === CHAIN_ID) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) {
      if (code === 4001) throw new Error("WALLET_REJECTED");
      throw new Error("CHAIN_WRONG_NETWORK");
    }
    await eth.request({ method: "wallet_addEthereumChain", params: [{
      chainId: `0x${CHAIN_ID.toString(16)}`,
      chainName: targetChain.name,
      nativeCurrency: targetChain.nativeCurrency,
      rpcUrls: targetChain.rpcUrls.default.http,
      blockExplorerUrls: [targetChain.blockExplorers.default.url],
    }] });
  }
}

export function watchWallet(onChange: () => void): () => void {
  if (!window.ethereum?.on) return () => {};
  const listener = () => onChange();
  window.ethereum.on("accountsChanged", listener);
  window.ethereum.on("chainChanged", listener);
  return () => {
    window.ethereum?.removeListener?.("accountsChanged", listener);
    window.ethereum?.removeListener?.("chainChanged", listener);
  };
}

export function statusName(status: number): "OPEN" | "SUBMITTED" | "FULFILLED" | "CLOSED" | "UNKNOWN" {
  if (status === 0) return "OPEN";
  if (status === 1) return "SUBMITTED";
  if (status === 2) return "FULFILLED";
  if (status === 3) return "CLOSED";
  return "UNKNOWN";
}

export function effectiveStatus(demand: DemandView, now = BigInt(Math.floor(Date.now() / 1000))): string {
  const base = statusName(demand.status);
  if (base === "FULFILLED" || base === "CLOSED") return base;
  if (base === "SUBMITTED" && demand.quorumReached) return "READY";
  if (now >= demand.deadline) {
    if (base === "OPEN") return "EXPIRED";
    if (base === "SUBMITTED" && (now >= demand.reviewEndsAt || demand.candidateRejected)) return "EXPIRED";
  }
  if (base === "SUBMITTED" && demand.candidateRejected) return "REJECTED";
  return base;
}

async function readDemandWithClient(client: PublicClient, demandId: bigint): Promise<DemandView> {
  const contract = requireContract();
  const [raw, progress, rejection] = await Promise.all([
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "getDemand", args: [demandId] }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "approvalProgress", args: [demandId] }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "rejectionProgress", args: [demandId] }),
  ]);
  const d = raw as Omit<DemandView, "demandId" | "approvalWeight" | "quorumReached" | "rejectionWeight" | "rejectionThreshold" | "candidateRejected">;
  const p = progress as readonly [bigint, bigint, boolean];
  const r = rejection as readonly [bigint, bigint, boolean];
  return {
    ...d,
    demandId,
    supporterCount: Number(d.supporterCount),
    status: Number(d.status),
    approvalWeight: p[0],
    approvalRequired: p[1],
    quorumReached: p[2],
    rejectionWeight: r[0],
    rejectionThreshold: r[1],
    candidateRejected: r[2],
  };
}

export async function readDemandOnChain(demandId: bigint): Promise<DemandView> {
  return readDemandWithClient(getPublic(), demandId);
}

export async function readBoard(): Promise<DemandView[]> {
  if (!DEMAND_CONTRACT) return [];
  const client = getPublic();
  const next = await client.readContract({ address: DEMAND_CONTRACT, abi: DEMAND_ABI, functionName: "nextDemandId" }) as bigint;
  const ids: bigint[] = [];
  for (let id = 1n; id < next; id += 1n) ids.push(id);
  const output: DemandView[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    output.push(...await Promise.all(ids.slice(i, i + 20).map((id) => readDemandWithClient(client, id))));
  }
  output.sort((a, b) => (b.committed > a.committed ? 1 : b.committed < a.committed ? -1 : b.demandId > a.demandId ? 1 : b.demandId < a.demandId ? -1 : 0));
  return output;
}

export async function readSupport(demandId: bigint, supporter: Address): Promise<SupportView> {
  const client = getPublic();
  const contract = requireContract();
  const [support, refundable] = await Promise.all([
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "getSupport", args: [demandId, supporter] }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "isRefundable", args: [demandId, supporter] }),
  ]);
  const value = support as readonly [bigint, bigint, boolean, boolean];
  return { commitment: value[0], expectedCalls: value[1], approved: value[2], rejected: value[3], refundable: Boolean(refundable) };
}

async function requireAccount(): Promise<Address> {
  const account = await connectWallet();
  await ensureChain();
  return account;
}

async function wait(hash: Hash): Promise<Hash> {
  const receipt = await getPublic().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("CHAIN_RECEIPT_FAILED");
  return hash;
}

async function writeDemand(
  account: Address,
  functionName: "createDemand" | "supportDemand" | "submitService" | "approveService" | "rejectService" | "finalize" | "reopen" | "refund",
  args: readonly unknown[],
): Promise<Hash> {
  const hash = await walletClient().writeContract({
    address: requireContract(),
    abi: DEMAND_ABI,
    functionName,
    args: args as never,
    account,
    chain: targetChain,
  }) as Hash;
  return wait(hash);
}

async function ensureAllowance(owner: Address, amount: bigint): Promise<void> {
  if (amount <= 0n) throw new Error("SUPPORT_TOO_SMALL");
  const client = getPublic();
  const contract = requireContract();
  const current = await client.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [owner, contract] }) as bigint;
  if (current >= amount) return;
  const wallet = walletClient();
  if (current > 0n) {
    const reset = await wallet.writeContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [contract, 0n], account: owner, chain: targetChain });
    await wait(reset);
  }
  const approval = await wallet.writeContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [contract, amount], account: owner, chain: targetChain });
  await wait(approval);
}

function parsePositiveUint(value: string, bits: 64 | 96, code: string): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error(code);
  const parsed = BigInt(value.trim());
  if (parsed <= 0n || parsed > (1n << BigInt(bits)) - 1n) throw new Error(code);
  return parsed;
}

export async function createDemand(input: {
  capability: string;
  specification: string;
  maxPrice: string;
  expectedCalls: string;
  deadlineDays: string;
  commitment: string;
}): Promise<Hash> {
  const account = await requireAccount();
  const capability = input.capability.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability) || capability.length > 64) throw new Error("DEMAND_INVALID_CAPABILITY");
  const specification = input.specification.trim();
  if (!specification || new TextEncoder().encode(specification).length > 2048) throw new Error("DEMAND_INVALID_SPEC");
  const commitment = parseUsd0(input.commitment);
  const maxPrice = parseUsd0(input.maxPrice);
  if (commitment <= 0n || commitment > (1n << 96n) - 1n || maxPrice <= 0n || maxPrice > (1n << 96n) - 1n) throw new Error("DEMAND_INVALID_AMOUNT");
  const calls = parsePositiveUint(input.expectedCalls, 64, "DEMAND_INVALID_CALLS");
  const days = Number(input.deadlineDays);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new Error("DEMAND_INVALID_DEADLINE");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(days * 86400));
  await ensureAllowance(account, commitment);
  return writeDemand(account, "createDemand", [capability, specification, maxPrice, calls, deadline, commitment]);
}

export async function supportDemand(demandId: bigint, amount: string, expectedCalls: string): Promise<Hash> {
  const account = await requireAccount();
  const atomic = parseUsd0(amount);
  if (atomic <= 0n || atomic > (1n << 96n) - 1n) throw new Error("SUPPORT_TOO_SMALL");
  const calls = parsePositiveUint(expectedCalls, 64, "DEMAND_INVALID_CALLS");
  await ensureAllowance(account, atomic);
  return writeDemand(account, "supportDemand", [demandId, atomic, calls]);
}

export async function submitService(demandId: bigint, serviceUrl: string, evidence: string): Promise<Hash> {
  const account = await requireAccount();
  let parsedUrl: URL;
  try { parsedUrl = new URL(serviceUrl.trim()); } catch { throw new Error("SUBMISSION_INVALID_URL"); }
  if (parsedUrl.protocol !== "https:") throw new Error("SUBMISSION_INVALID_URL");
  const evidenceValue = evidence.trim();
  if (!evidenceValue) throw new Error("SUBMISSION_INVALID_EVIDENCE");
  const evidenceHash = /^0x[0-9a-fA-F]{64}$/.test(evidenceValue)
    ? evidenceValue as `0x${string}`
    : keccak256(toBytes(evidenceValue));
  return writeDemand(account, "submitService", [demandId, parsedUrl.toString(), evidenceHash]);
}

export async function approveService(demandId: bigint): Promise<Hash> {
  return writeDemand(await requireAccount(), "approveService", [demandId]);
}
export async function rejectService(demandId: bigint): Promise<Hash> {
  return writeDemand(await requireAccount(), "rejectService", [demandId]);
}
export async function finalizeDemand(demandId: bigint): Promise<Hash> {
  return writeDemand(await requireAccount(), "finalize", [demandId]);
}
export async function reopenDemand(demandId: bigint): Promise<Hash> {
  return writeDemand(await requireAccount(), "reopen", [demandId]);
}
export async function refundDemand(demandId: bigint): Promise<Hash> {
  return writeDemand(await requireAccount(), "refund", [demandId]);
}

export function formatUsd0(value: bigint): string { return formatUnits(value, 6); }
export function parseUsd0(value: string): bigint { return parseUnits(value.trim(), 6); }
export function explorerTx(hash: string): string { return `${targetChain.blockExplorers.default.url}/tx/${hash}`; }
export function explorerAddress(address: string): string { return `${targetChain.blockExplorers.default.url}/address/${address}`; }
