import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
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
  type Log,
  type PublicClient,
} from "viem";
import { normalizeCapability } from "./capability";
import {
  waitForTransaction,
  type ObservedTransaction,
  type TransactionIntent,
  type TransactionStage,
  type TransactionUpdateHandler,
} from "./transaction-lifecycle";
import { deadlineDurationSeconds } from "./create-demand-chat-model";

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "1952");
if (CHAIN_ID !== 1952 && CHAIN_ID !== 196) throw new Error("VITE_CHAIN_ID must be 1952 or 196");

const DEFAULT_RPC = CHAIN_ID === 196 ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech/terigon";
const DEFAULT_TOKEN = CHAIN_ID === 196
  ? "0x779ded0c9e1022225f8e0630b35a9b54be713736"
  : "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";

export const RPC_URL = import.meta.env.VITE_XLAYER_RPC_URL || DEFAULT_RPC;
export const DEMAND_CONTRACT = parseConfiguredAddress(import.meta.env.VITE_DEMAND_CONTRACT, "VITE_DEMAND_CONTRACT");
export const PAYMENT_TOKEN = getAddress(import.meta.env.VITE_PAYMENT_TOKEN || DEFAULT_TOKEN);

const DEFAULT_MARKET_SYNC_INTERVAL_MS = 60_000;
const MARKET_SYNC_LOG_RANGE = 100n;
const MARKET_SYNC_MAX_LOG_RANGES_PER_POLL = 10n;
const BOARD_READ_BATCH_SIZE = 20;

export function parseMarketSyncInterval(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_MARKET_SYNC_INTERVAL_MS;
  const interval = Number(value);
  return Number.isSafeInteger(interval) && interval > 0 ? interval : DEFAULT_MARKET_SYNC_INTERVAL_MS;
}

export const MARKET_SYNC_INTERVAL_MS = parseMarketSyncInterval(import.meta.env.VITE_MARKET_SYNC_INTERVAL_MS);

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
  {
    type: "event", name: "DemandCreated", inputs: [
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
    type: "event", name: "DemandSupported", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
      { name: "expectedCalls", type: "uint64", indexed: false },
      { name: "committedTotal", type: "uint128", indexed: false },
      { name: "supporterCount", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event", name: "ServiceSubmitted", inputs: [
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
    type: "event", name: "ServiceApproved", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "weight", type: "uint96", indexed: false },
      { name: "approvalWeight", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "ServiceRejected", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "weight", type: "uint96", indexed: false },
      { name: "rejectionWeight", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "SubmissionRejected", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "submissionNonce", type: "uint256", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "approvalWeight", type: "uint256", indexed: false },
      { name: "rejectionWeight", type: "uint256", indexed: false },
      { name: "approvalRequired", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event", name: "DemandFulfilled", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "treasury", type: "address", indexed: true },
      { name: "approvedAmount", type: "uint128", indexed: false },
      { name: "fee", type: "uint128", indexed: false },
      { name: "payout", type: "uint128", indexed: false },
      { name: "remainingRefundable", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event", name: "Refunded", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "supporter", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },
  {
    type: "event", name: "DemandClosed", inputs: [
      { name: "demandId", type: "uint256", indexed: true },
      { name: "demandKey", type: "bytes32", indexed: true },
    ],
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

function parseConfiguredAddress(value: string | undefined, name: string): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address`);
  return getAddress(value);
}

function requireContract(): Address {
  if (!DEMAND_CONTRACT) throw new Error("VITE_DEMAND_CONTRACT is not configured");
  return DEMAND_CONTRACT;
}

let reownWalletProvider: EthereumProvider | null = null;

function requireReownProvider(): EthereumProvider {
  if (!reownWalletProvider) throw new Error("WALLET_NOT_FOUND");
  return reownWalletProvider;
}

function isEthereumProvider(provider: unknown): provider is EthereumProvider {
  return typeof provider === "object" && provider !== null
    && "request" in provider && typeof provider.request === "function";
}

export function setReownWalletProvider(provider: unknown): void {
  reownWalletProvider = isEthereumProvider(provider) ? provider : null;
}

export function getPublic(): PublicClient {
  return createPublicClient({ chain: targetChain, transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
}

export function walletClient() {
  return createWalletClient({ chain: targetChain, transport: custom(requireReownProvider() as never) });
}

export async function currentWallet(): Promise<Address | null> {
  const provider = reownWalletProvider;
  if (!provider) return null;
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) return null;
  return getAddress(accounts[0]);
}

export async function currentChainId(): Promise<number | null> {
  const provider = reownWalletProvider;
  if (!provider) return null;
  const result = await provider.request({ method: "eth_chainId" });
  if (typeof result !== "string") return null;
  return Number.parseInt(result, 16);
}

export async function ensureChain(): Promise<void> {
  const eth = requireReownProvider();
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

async function readDemandWithClient(
  client: PublicClient,
  demandId: bigint,
  blockNumber?: bigint,
  contract: Address = requireContract(),
): Promise<DemandView> {
  const atBlock = blockNumber === undefined ? {} : { blockNumber };
  const [raw, progress, rejection] = await Promise.all([
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "getDemand", args: [demandId], ...atBlock }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "approvalProgress", args: [demandId], ...atBlock }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "rejectionProgress", args: [demandId], ...atBlock }),
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

export function sortDemandsByFunding(output: DemandView[]): DemandView[] {
  return output.sort((a, b) => (b.committed > a.committed ? 1 : b.committed < a.committed ? -1 : b.demandId > a.demandId ? 1 : b.demandId < a.demandId ? -1 : 0));
}

export type MarketSyncCursor = { blockNumber: bigint; blockHash: Hash };
export type MarketBoardSnapshot = { demands: DemandView[]; cursor: MarketSyncCursor | null };
export type MarketSyncResult = MarketBoardSnapshot & { changed: boolean; reorgRecovered: boolean };

async function readBoardAt(client: PublicClient, contract: Address, blockNumber: bigint): Promise<DemandView[]> {
  const next = await client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "nextDemandId", blockNumber }) as bigint;
  const ids: bigint[] = [];
  for (let id = 1n; id < next; id += 1n) ids.push(id);
  const output: DemandView[] = [];
  for (let i = 0; i < ids.length; i += BOARD_READ_BATCH_SIZE) {
    output.push(...await Promise.all(ids.slice(i, i + BOARD_READ_BATCH_SIZE).map((id) => readDemandWithClient(client, id, blockNumber, contract))));
  }
  return sortDemandsByFunding(output);
}

async function readBoardSnapshotWithClient(client: PublicClient, contract: Address): Promise<MarketBoardSnapshot> {
  const block = await client.getBlock({ blockTag: "latest" });
  const demands = await readBoardAt(client, contract, block.number);
  const canonicalBlock = await client.getBlock({ blockNumber: block.number });
  if (canonicalBlock.hash !== block.hash) throw new Error("MARKET_SNAPSHOT_REORGED");
  return { demands, cursor: { blockNumber: block.number, blockHash: block.hash } };
}

export async function readBoardSnapshot(): Promise<MarketBoardSnapshot> {
  if (!DEMAND_CONTRACT) return { demands: [], cursor: null };
  return readBoardSnapshotWithClient(getPublic(), DEMAND_CONTRACT);
}

export async function readBoard(): Promise<DemandView[]> {
  return (await readBoardSnapshot()).demands;
}

export function demandIdsFromLogs(logs: readonly Pick<Log, "data" | "topics">[]): Set<bigint> {
  const demandIds = new Set<bigint>();
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: DEMAND_ABI, data: log.data, topics: log.topics, strict: false });
      if (typeof decoded.args.demandId === "bigint") demandIds.add(decoded.args.demandId);
    } catch {
      // Ignore logs from events outside the AgentDemand ABI.
    }
  }
  return demandIds;
}

export async function synchronizeMarketBoard(
  client: PublicClient,
  contract: Address,
  currentBoard: readonly DemandView[],
  cursor: MarketSyncCursor,
): Promise<MarketSyncResult> {
  const head = await client.getBlockNumber();
  if (head < cursor.blockNumber) {
    return { ...(await readBoardSnapshotWithClient(client, contract)), changed: true, reorgRecovered: true };
  }

  const checkpoint = await client.getBlock({ blockNumber: cursor.blockNumber });
  if (checkpoint.hash !== cursor.blockHash) {
    return { ...(await readBoardSnapshotWithClient(client, contract)), changed: true, reorgRecovered: true };
  }
  if (head === cursor.blockNumber) {
    return { demands: [...currentBoard], cursor, changed: false, reorgRecovered: false };
  }

  const maximumBlocks = MARKET_SYNC_LOG_RANGE * MARKET_SYNC_MAX_LOG_RANGES_PER_POLL;
  const lastBlock = head < cursor.blockNumber + maximumBlocks ? head : cursor.blockNumber + maximumBlocks;
  const target = await client.getBlock({ blockNumber: lastBlock });
  const changedIds = new Set<bigint>();
  for (let fromBlock = cursor.blockNumber + 1n; fromBlock <= lastBlock;) {
    const rangeEnd = fromBlock + MARKET_SYNC_LOG_RANGE - 1n;
    const toBlock = rangeEnd < lastBlock ? rangeEnd : lastBlock;
    const logs = await client.getLogs({ address: contract, fromBlock, toBlock });
    for (const demandId of demandIdsFromLogs(logs)) changedIds.add(demandId);
    fromBlock = toBlock + 1n;
  }

  const ids = [...changedIds];
  const updates: DemandView[] = [];
  for (let i = 0; i < ids.length; i += BOARD_READ_BATCH_SIZE) {
    updates.push(...await Promise.all(
      ids.slice(i, i + BOARD_READ_BATCH_SIZE).map((demandId) => readDemandWithClient(client, demandId, lastBlock, contract)),
    ));
  }

  const canonicalTarget = await client.getBlock({ blockNumber: lastBlock });
  if (canonicalTarget.hash !== target.hash) throw new Error("MARKET_SYNC_REORGED_DURING_SCAN");

  if (updates.length === 0) return {
    demands: [...currentBoard],
    cursor: { blockNumber: lastBlock, blockHash: target.hash },
    changed: false,
    reorgRecovered: false,
  };

  const demandsById = new Map(currentBoard.map((demand) => [demand.demandId.toString(), demand]));
  for (const demand of updates) demandsById.set(demand.demandId.toString(), demand);
  return {
    demands: sortDemandsByFunding([...demandsById.values()]),
    cursor: { blockNumber: lastBlock, blockHash: target.hash },
    changed: true,
    reorgRecovered: false,
  };
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
  const account = await currentWallet();
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  await ensureChain();
  return account;
}

async function readTransactionByHash(hash: Hash): Promise<ObservedTransaction> {
  const transaction = await getPublic().getTransaction({ hash });
  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    data: transaction.input,
    value: transaction.value,
  };
}

export async function readTransactionOnChain(hash: Hash): Promise<ObservedTransaction> {
  return readTransactionByHash(hash);
}

async function wait(
  hash: Hash,
  intent: TransactionIntent,
  stage: TransactionStage,
  wallet: Address,
  chainId: number,
  onUpdate?: TransactionUpdateHandler,
  verifyExisting = false,
): Promise<Hash> {
  return waitForTransaction({
    stage,
    hash,
    intent,
    wallet,
    chainId,
    onUpdate,
    ...(verifyExisting ? { readTransaction: readTransactionByHash } : {}),
    waitForReceipt: ({ hash: receiptHash, onReplaced }) => getPublic().waitForTransactionReceipt({
      hash: receiptHash,
      onReplaced: (replacement) => onReplaced?.({
        reason: replacement.reason,
        transaction: {
          hash: replacement.transaction.hash,
          from: replacement.transaction.from,
          to: replacement.transaction.to,
          data: replacement.transaction.input,
          value: replacement.transaction.value,
        },
        transactionReceipt: {
          transactionHash: replacement.transactionReceipt.transactionHash,
          status: replacement.transactionReceipt.status,
        },
      }),
    }),
  });
}

async function writeDemand(
  account: Address,
  functionName: "createDemand" | "supportDemand" | "submitService" | "approveService" | "rejectService" | "finalize" | "reopen" | "refund",
  args: readonly unknown[],
  stage: TransactionStage = "action",
  onUpdate?: TransactionUpdateHandler,
): Promise<Hash> {
  const address = requireContract();
  const data = encodeFunctionData({ abi: DEMAND_ABI, functionName, args: args as never });
  const intent: TransactionIntent = { to: address, data, value: 0n };
  const hash = await walletClient().writeContract({
    address,
    abi: DEMAND_ABI,
    functionName,
    args: args as never,
    account,
    chain: targetChain,
  }) as Hash;
  return wait(hash, intent, stage, account, CHAIN_ID, onUpdate);
}

async function ensureAllowance(owner: Address, amount: bigint, onUpdate?: TransactionUpdateHandler): Promise<void> {
  if (amount <= 0n) throw new Error("SUPPORT_TOO_SMALL");
  const client = getPublic();
  const contract = requireContract();
  const current = await client.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [owner, contract] }) as bigint;
  if (current >= amount) return;
  const wallet = walletClient();
  if (current > 0n) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [contract, 0n] });
    const reset = await wallet.writeContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [contract, 0n], account: owner, chain: targetChain });
    await wait(reset, { to: PAYMENT_TOKEN, data, value: 0n }, "approval", owner, CHAIN_ID, onUpdate);
  }
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [contract, amount] });
  const approval = await wallet.writeContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [contract, amount], account: owner, chain: targetChain });
  await wait(approval, { to: PAYMENT_TOKEN, data, value: 0n }, "approval", owner, CHAIN_ID, onUpdate);
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
}, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  const durationSeconds = deadlineDurationSeconds(input.deadlineDays);
  const account = await requireAccount();
  const capability = normalizeCapability(input.capability);
  const specification = input.specification.trim();
  if (!specification || new TextEncoder().encode(specification).length > 2048) throw new Error("DEMAND_INVALID_SPEC");
  const commitment = parseUsd0(input.commitment);
  const maxPrice = parseUsd0(input.maxPrice);
  if (commitment <= 0n || commitment > (1n << 96n) - 1n || maxPrice <= 0n || maxPrice > (1n << 96n) - 1n) throw new Error("DEMAND_INVALID_AMOUNT");
  const calls = parsePositiveUint(input.expectedCalls, 64, "DEMAND_INVALID_CALLS");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + durationSeconds);
  await ensureAllowance(account, commitment, onUpdate);
  return writeDemand(account, "createDemand", [capability, specification, maxPrice, calls, deadline, commitment], "demand", onUpdate);
}

export async function supportDemand(demandId: bigint, amount: string, expectedCalls: string, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  const account = await requireAccount();
  const atomic = parseUsd0(amount);
  if (atomic <= 0n || atomic > (1n << 96n) - 1n) throw new Error("SUPPORT_TOO_SMALL");
  const calls = parsePositiveUint(expectedCalls, 64, "DEMAND_INVALID_CALLS");
  await ensureAllowance(account, atomic, onUpdate);
  return writeDemand(account, "supportDemand", [demandId, atomic, calls], "action", onUpdate);
}

export async function submitService(demandId: bigint, serviceUrl: string, evidence: string, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  const account = await requireAccount();
  let parsedUrl: URL;
  try { parsedUrl = new URL(serviceUrl.trim()); } catch { throw new Error("SUBMISSION_INVALID_URL"); }
  if (parsedUrl.protocol !== "https:") throw new Error("SUBMISSION_INVALID_URL");
  const evidenceValue = evidence.trim();
  if (!evidenceValue) throw new Error("SUBMISSION_INVALID_EVIDENCE");
  const evidenceHash = /^0x[0-9a-fA-F]{64}$/.test(evidenceValue)
    ? evidenceValue as `0x${string}`
    : keccak256(toBytes(evidenceValue));
  return writeDemand(account, "submitService", [demandId, parsedUrl.toString(), evidenceHash], "action", onUpdate);
}

export async function approveService(demandId: bigint, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  return writeDemand(await requireAccount(), "approveService", [demandId], "action", onUpdate);
}
export async function rejectService(demandId: bigint, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  return writeDemand(await requireAccount(), "rejectService", [demandId], "action", onUpdate);
}
export async function finalizeDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  return writeDemand(await requireAccount(), "finalize", [demandId], "action", onUpdate);
}
export async function reopenDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  return writeDemand(await requireAccount(), "reopen", [demandId], "action", onUpdate);
}
export async function refundDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler): Promise<Hash> {
  return writeDemand(await requireAccount(), "refund", [demandId], "action", onUpdate);
}

export async function verifyTransaction(
  stage: TransactionStage,
  hash: Hash,
  intent: TransactionIntent,
  expectedWallet: Address,
  expectedChainId: number,
  onUpdate?: TransactionUpdateHandler,
): Promise<Hash> {
  const wallet = await currentWallet();
  if (!wallet) throw new Error("WALLET_NOT_CONNECTED");
  const chainId = await currentChainId();
  if (chainId !== CHAIN_ID || expectedChainId !== CHAIN_ID) throw new Error("CHAIN_WRONG_NETWORK");
  if (wallet.toLowerCase() !== expectedWallet.toLowerCase()) throw new Error("WALLET_CHANGED");
  return wait(hash, intent, stage, wallet, expectedChainId, onUpdate, true);
}

export function formatUsd0(value: bigint): string { return formatUnits(value, 6); }
export function parseUsd0(value: string): bigint { return parseUnits(value.trim(), 6); }
export function explorerTx(hash: string): string { return `${targetChain.blockExplorers.default.url}/tx/${hash}`; }
export function explorerAddress(address: string): string { return `${targetChain.blockExplorers.default.url}/address/${address}`; }
