import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  toBytes,
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
import { demandHref } from "./routing";
import { deploymentKey, formatEscrowAmount, parseEscrowAmount, validateDeployment, verifyDeployment, type EscrowDeployment } from "../shared/deployment";
import { authorization, validatePass, validateRequest, validationNetworks, type RequestMetadata } from "./validation";
import { ESCROW_DECIMALS, ESCROW_SYMBOL } from "./escrow-metadata";
export { ESCROW_DECIMALS, ESCROW_SYMBOL } from "./escrow-metadata";

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "1952");
if (!Number.isSafeInteger(CHAIN_ID) || CHAIN_ID <= 0) throw new Error("CONFIG_INVALID: VITE_CHAIN_ID");

const DEFAULT_RPC = CHAIN_ID === 196 ? "https://rpc.xlayer.tech" : CHAIN_ID === 1952 ? "https://testrpc.xlayer.tech/terigon" : "";
export const RPC_URL = import.meta.env.VITE_XLAYER_RPC_URL || DEFAULT_RPC;
export const DEMAND_CONTRACT = parseConfiguredAddress(import.meta.env.VITE_DEMAND_CONTRACT, "VITE_DEMAND_CONTRACT");
export function selectedDemandHref(demandId: bigint): string { return demandHref(CHAIN_ID, requireContract(), demandId); }
export const PAYMENT_TOKEN = parseConfiguredAddress(import.meta.env.VITE_PAYMENT_TOKEN, "VITE_PAYMENT_TOKEN");
if (PAYMENT_TOKEN && !import.meta.env.VITE_PAYMENT_TOKEN_DECIMALS) throw new Error("CONFIG_INVALID: VITE_PAYMENT_TOKEN_DECIMALS");

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
  name: import.meta.env.VITE_CHAIN_NAME || (CHAIN_ID === 196 ? "X Layer" : CHAIN_ID === 1952 ? "X Layer Testnet" : ""),
  nativeCurrency: { name: import.meta.env.VITE_CHAIN_NATIVE_NAME || (CHAIN_ID === 1952 || CHAIN_ID === 196 ? "OKB" : ""), symbol: import.meta.env.VITE_CHAIN_NATIVE_SYMBOL || (CHAIN_ID === 1952 || CHAIN_ID === 196 ? "OKB" : ""), decimals: Number(import.meta.env.VITE_CHAIN_NATIVE_DECIMALS || (CHAIN_ID === 1952 || CHAIN_ID === 196 ? "18" : "NaN")) },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: import.meta.env.VITE_CHAIN_EXPLORER_URL || (CHAIN_ID === 196
        ? "https://www.okx.com/web3/explorer/xlayer"
        : CHAIN_ID === 1952 ? "https://www.okx.com/web3/explorer/xlayer-test" : ""),
    },
  },
});
if (!RPC_URL || !targetChain.name || !targetChain.nativeCurrency.name || !targetChain.nativeCurrency.symbol || !Number.isInteger(targetChain.nativeCurrency.decimals) || !targetChain.blockExplorers.default.url) throw new Error("CONFIG_INVALID: VITE_CHAIN_METADATA");

export const selectedDeployment: EscrowDeployment | null = DEMAND_CONTRACT && PAYMENT_TOKEN ? validateDeployment({
  chainId: CHAIN_ID, contract: DEMAND_CONTRACT, rpcUrl: RPC_URL, deployBlock: 0n,
  chain: { name: targetChain.name, explorerUrl: targetChain.blockExplorers.default.url, nativeCurrency: targetChain.nativeCurrency },
  escrowToken: { address: PAYMENT_TOKEN, symbol: ESCROW_SYMBOL, decimals: ESCROW_DECIMALS },
}) : null;

async function requireVerifiedDeployment(deployment: EscrowDeployment | null = selectedDeployment): Promise<EscrowDeployment> {
  if (!deployment) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
  const client = getPublic(deployment);
  await verifyDeployment({
    getChainId: () => client.getChainId(),
    getBytecode: (address) => client.getBytecode({ address }),
    getToken: (address) => client.readContract({ address, abi: DEMAND_ABI, functionName: "token" }),
    getDecimals: (address) => client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
  }, deployment);
  return deployment;
}

export { AGENT_DEMAND_ABI as DEMAND_ABI, ERC20_ABI } from "../shared/abi.ts";
import { AGENT_DEMAND_ABI as DEMAND_ABI, ERC20_ABI } from "../shared/abi.ts";

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

export type WalletSession = {
  readonly provider: EthereumProvider;
  readonly generation: number;
  readonly account: Address | null;
};

function parseConfiguredAddress(value: string | undefined, name: string): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error(`${name} is not a valid EVM address`);
  return getAddress(value);
}

function requireContract(): Address {
  if (!DEMAND_CONTRACT) throw new Error("VITE_DEMAND_CONTRACT is not configured");
  return DEMAND_CONTRACT;
}

let reownWalletProvider: EthereumProvider | null = null;
let walletProviderGeneration = 0;
let reownWalletAccount: Address | null = null;

function requireReownProvider(): EthereumProvider {
  if (!reownWalletProvider) throw new Error("WALLET_NOT_FOUND");
  return reownWalletProvider;
}

function isEthereumProvider(provider: unknown): provider is EthereumProvider {
  return typeof provider === "object" && provider !== null
    && "request" in provider && typeof provider.request === "function";
}

export function setReownWalletProvider(provider: unknown, account: Address | null = null): void {
  const nextProvider = isEthereumProvider(provider) ? provider : null;
  const nextAccount = nextProvider ? account : null;
  if (nextProvider !== reownWalletProvider || nextAccount?.toLowerCase() !== reownWalletAccount?.toLowerCase()) {
    walletProviderGeneration += 1;
  }
  reownWalletProvider = nextProvider;
  reownWalletAccount = nextAccount;
}

export function captureWalletSession(account: Address | null = null): WalletSession | null {
  return reownWalletProvider
    ? { provider: reownWalletProvider, generation: walletProviderGeneration, account: account ?? reownWalletAccount }
    : null;
}

function chainFor(deployment: EscrowDeployment) {
  return defineChain({ id: deployment.chainId, name: deployment.chain.name, nativeCurrency: deployment.chain.nativeCurrency, rpcUrls: { default: { http: [deployment.rpcUrl] } }, blockExplorers: { default: { name: "Explorer", url: deployment.chain.explorerUrl } } });
}
export function getPublic(deployment: EscrowDeployment | null = selectedDeployment): PublicClient {
  if (!deployment) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
  return createPublicClient({ chain: chainFor(deployment), transport: http(deployment.rpcUrl, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
}

export function walletClient(session?: WalletSession, deployment: EscrowDeployment | null = selectedDeployment) {
  if (!deployment) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
  const provider = session?.provider ?? requireReownProvider();
  return createWalletClient({ chain: chainFor(deployment), transport: custom({
    request: async (request: { method: string; params?: readonly unknown[] }) => {
      if (session && (request.method === "eth_sendTransaction" || request.method === "wallet_sendTransaction" || request.method.startsWith("eth_signTypedData"))) {
        if (!session.account) throw new Error("WALLET_NOT_CONNECTED");
        await assertWalletSession(session, session.account, deployment.chainId);
        assertProviderSession(session);
      }
      return provider.request(request);
    },
  }) });
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

function assertProviderSession(session: WalletSession): void {
  if (session.provider !== reownWalletProvider || session.generation !== walletProviderGeneration) {
    throw new Error("WALLET_CHANGED");
  }
}

async function sessionWallet(session: WalletSession): Promise<Address | null> {
  assertProviderSession(session);
  const accounts = await session.provider.request({ method: "eth_accounts" });
  assertProviderSession(session);
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) return null;
  return getAddress(accounts[0]);
}

async function sessionChainId(session: WalletSession): Promise<number | null> {
  assertProviderSession(session);
  const result = await session.provider.request({ method: "eth_chainId" });
  assertProviderSession(session);
  return typeof result === "string" ? Number.parseInt(result, 16) : null;
}

async function assertWalletSession(session: WalletSession, expectedAccount: Address, chainId = CHAIN_ID): Promise<void> {
  const account = await sessionWallet(session);
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  if (account.toLowerCase() !== expectedAccount.toLowerCase() || session.account && account.toLowerCase() !== session.account.toLowerCase()) {
    throw new Error("WALLET_CHANGED");
  }
  if (await sessionChainId(session) !== chainId) throw new Error("CHAIN_WRONG_NETWORK");
}

async function requireWalletSession(session?: WalletSession): Promise<WalletSession> {
  const current = session ?? captureWalletSession();
  if (!current) throw new Error("WALLET_NOT_CONNECTED");
  assertProviderSession(current);
  return current;
}

async function ensureChain(deployment: EscrowDeployment, session?: WalletSession, expectedAccount?: Address): Promise<void> {
  const currentSession = await requireWalletSession(session);
  const account = expectedAccount ?? currentSession.account ?? await sessionWallet(currentSession);
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  if (currentSession.account && account.toLowerCase() !== currentSession.account.toLowerCase()) throw new Error("WALLET_CHANGED");
  if ((await sessionWallet(currentSession))?.toLowerCase() !== account.toLowerCase()) throw new Error("WALLET_CHANGED");
  const current = await sessionChainId(currentSession);
  if (current === deployment.chainId) return;
  assertProviderSession(currentSession);
  try {
    await currentSession.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${deployment.chainId.toString(16)}` }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) {
      if (code === 4001) throw new Error("WALLET_REJECTED");
      throw new Error("CHAIN_WRONG_NETWORK");
    }
    assertProviderSession(currentSession);
    if ((await sessionWallet(currentSession))?.toLowerCase() !== account.toLowerCase()) throw new Error("WALLET_CHANGED");
    await currentSession.provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: `0x${deployment.chainId.toString(16)}`,
      chainName: deployment.chain.name,
      nativeCurrency: deployment.chain.nativeCurrency,
      rpcUrls: [deployment.rpcUrl],
      blockExplorerUrls: [deployment.chain.explorerUrl],
    }] });
  }
  await assertWalletSession({ ...currentSession, account }, account, deployment.chainId);
}

function statusName(status: number): "OPEN" | "SUBMITTED" | "FULFILLED" | "CLOSED" | "UNKNOWN" {
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

function sortDemandsByFunding(output: DemandView[]): DemandView[] {
  return output.sort((a, b) => (b.committed > a.committed ? 1 : b.committed < a.committed ? -1 : b.demandId > a.demandId ? 1 : b.demandId < a.demandId ? -1 : 0));
}

export type MarketSyncCursor = { deploymentKey: string; blockNumber: bigint; blockHash: Hash };
type MarketBoardSnapshot = { demands: DemandView[]; cursor: MarketSyncCursor | null };
type MarketSyncResult = MarketBoardSnapshot & { changed: boolean; reorgRecovered: boolean };

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

async function readBoardSnapshotWithClient(client: PublicClient, deployment: EscrowDeployment): Promise<MarketBoardSnapshot> {
  const block = await client.getBlock({ blockTag: "latest" });
  const demands = await readBoardAt(client, deployment.contract, block.number);
  const canonicalBlock = await client.getBlock({ blockNumber: block.number });
  if (canonicalBlock.hash !== block.hash) throw new Error("MARKET_SNAPSHOT_REORGED");
  return { demands, cursor: { deploymentKey: deploymentKey(deployment.chainId, deployment.contract), blockNumber: block.number, blockHash: block.hash } };
}

export async function readBoardSnapshot(): Promise<MarketBoardSnapshot> {
  if (!selectedDeployment) return { demands: [], cursor: null };
  const deployment = await requireVerifiedDeployment();
  return readBoardSnapshotWithClient(getPublic(deployment), deployment);
}

export function demandIdsFromLogs(logs: readonly Pick<Log, "data" | "topics">[]): Set<bigint> {
  const demandIds = new Set<bigint>();
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: DEMAND_ABI, data: log.data, topics: log.topics, strict: false });
      if ("demandId" in decoded.args && typeof decoded.args.demandId === "bigint") demandIds.add(decoded.args.demandId);
    } catch {
      // Ignore logs from events outside the AgentDemand ABI.
    }
  }
  return demandIds;
}

export async function synchronizeMarketBoard(
  client: PublicClient,
  deployment: EscrowDeployment,
  currentBoard: readonly DemandView[],
  cursor: MarketSyncCursor,
): Promise<MarketSyncResult> {
  if (cursor.deploymentKey !== deploymentKey(deployment.chainId, deployment.contract)) throw new Error("MARKET_DEPLOYMENT_MISMATCH");
  const head = await client.getBlockNumber();
  if (head < cursor.blockNumber) {
    return { ...(await readBoardSnapshotWithClient(client, deployment)), changed: true, reorgRecovered: true };
  }

  const checkpoint = await client.getBlock({ blockNumber: cursor.blockNumber });
  if (checkpoint.hash !== cursor.blockHash) {
    return { ...(await readBoardSnapshotWithClient(client, deployment)), changed: true, reorgRecovered: true };
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
    const logs = await client.getLogs({ address: deployment.contract, fromBlock, toBlock });
    for (const demandId of demandIdsFromLogs(logs)) changedIds.add(demandId);
    fromBlock = toBlock + 1n;
  }

  const ids = [...changedIds];
  const updates: DemandView[] = [];
  for (let i = 0; i < ids.length; i += BOARD_READ_BATCH_SIZE) {
    updates.push(...await Promise.all(
      ids.slice(i, i + BOARD_READ_BATCH_SIZE).map((demandId) => readDemandWithClient(client, demandId, lastBlock, deployment.contract)),
    ));
  }

  const canonicalTarget = await client.getBlock({ blockNumber: lastBlock });
  if (canonicalTarget.hash !== target.hash) throw new Error("MARKET_SYNC_REORGED_DURING_SCAN");

  if (updates.length === 0) return {
    demands: [...currentBoard],
    cursor: { deploymentKey: cursor.deploymentKey, blockNumber: lastBlock, blockHash: target.hash },
    changed: false,
    reorgRecovered: false,
  };

  const demandsById = new Map(currentBoard.map((demand) => [demand.demandId.toString(), demand]));
  for (const demand of updates) demandsById.set(demand.demandId.toString(), demand);
  return {
    demands: sortDemandsByFunding([...demandsById.values()]),
    cursor: { deploymentKey: cursor.deploymentKey, blockNumber: lastBlock, blockHash: target.hash },
    changed: true,
    reorgRecovered: false,
  };
}

export async function readSupport(demandId: bigint, supporter: Address): Promise<SupportView> {
  const deployment = await requireVerifiedDeployment();
  const client = getPublic(deployment);
  const { contract } = deployment;
  const [support, refundable] = await Promise.all([
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "getSupport", args: [demandId, supporter] }),
    client.readContract({ address: contract, abi: DEMAND_ABI, functionName: "isRefundable", args: [demandId, supporter] }),
  ]);
  const value = support as readonly [bigint, bigint, boolean, boolean];
  return { commitment: value[0], expectedCalls: value[1], approved: value[2], rejected: value[3], refundable: Boolean(refundable) };
}

async function requireAccount(deployment: EscrowDeployment | null, session?: WalletSession): Promise<{ account: Address; session: WalletSession }> {
  if (!deployment) throw new Error("CHAIN_CONTRACT_UNCONFIGURED");
  const currentSession = await requireWalletSession(session);
  const account = await sessionWallet(currentSession);
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  if (currentSession.account && account.toLowerCase() !== currentSession.account.toLowerCase()) throw new Error("WALLET_CHANGED");
  const boundSession = { ...currentSession, account };
  await ensureChain(deployment, boundSession, account);
  await assertWalletSession(boundSession, account, deployment.chainId);
  return { account, session: boundSession };
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
  deployment: EscrowDeployment | null = selectedDeployment,
): Promise<Hash> {
  if (!deployment || deployment.chainId !== chainId) throw new Error("CHAIN_WRONG_NETWORK");
  const client = getPublic(deployment);
  return waitForTransaction({
    stage,
    hash,
    intent,
    wallet,
    chainId,
    onUpdate,
    ...(verifyExisting ? { readTransaction: async (txHash: Hash) => { const tx = await client.getTransaction({ hash: txHash }); return { hash: tx.hash, from: tx.from, to: tx.to, data: tx.input, value: tx.value }; } } : {}),
    waitForReceipt: ({ hash: receiptHash, onReplaced }) => client.waitForTransactionReceipt({
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
  session: WalletSession,
  stage: TransactionStage = "action",
  onUpdate?: TransactionUpdateHandler,
  beforeBroadcast?: () => Promise<void>,
  originatingDeployment: EscrowDeployment | null = selectedDeployment,
): Promise<Hash> {
  const deployment = await requireVerifiedDeployment(originatingDeployment);
  const address = deployment.contract;
  const data = encodeFunctionData({ abi: DEMAND_ABI, functionName, args: args as never });
  const intent: TransactionIntent = { to: address, data, value: 0n };
  await assertWalletSession(session, account, deployment.chainId);
  await beforeBroadcast?.();
  await assertWalletSession(session, account, deployment.chainId);
  const hash = await walletClient(session, deployment).writeContract({
    address,
    abi: DEMAND_ABI,
    functionName,
    args: args as never,
    account,
    chain: chainFor(deployment),
  }) as Hash;
  return wait(hash, intent, stage, account, deployment.chainId, onUpdate, false, deployment);
}

async function verifySubmission(deployment: EscrowDeployment, wallet: Address, id: bigint, url: string, evidence: Hash, attestation: { submissionNonce: bigint; paymentRequirementsHash: Hash; validationPolicyId: Hash }): Promise<void> {
  const client = getPublic(deployment);
  const [demand, nonce, digests] = await Promise.all([readDemandWithClient(client, id, undefined, deployment.contract), client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "submissionNonce", args: [id] }), client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "submissionDigests", args: [id, attestation.submissionNonce] })]);
  if (![1, 2].includes(demand.status) || demand.builder.toLowerCase() !== wallet.toLowerCase() || nonce !== attestation.submissionNonce || demand.serviceUrl !== url || demand.evidenceHash.toLowerCase() !== evidence.toLowerCase() || digests[0] !== attestation.paymentRequirementsHash || digests[1] !== attestation.validationPolicyId) throw new Error("SUBMISSION_READBACK_FAILED");
}

async function ensureAllowance(owner: Address, amount: bigint, session: WalletSession, deployment: EscrowDeployment, onUpdate?: TransactionUpdateHandler): Promise<void> {
  if (amount <= 0n) throw new Error("SUPPORT_TOO_SMALL");
  const client = getPublic(deployment);
  const { contract, escrowToken: { address: token } } = await requireVerifiedDeployment(deployment);
  const current = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, contract] }) as bigint;
  if (current >= amount) return;
  const wallet = walletClient(session, deployment);
  if (current > 0n) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [contract, 0n] });
    await assertWalletSession(session, owner, deployment.chainId);
    const reset = await wallet.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [contract, 0n], account: owner, chain: chainFor(deployment) });
    await wait(reset, { to: token, data, value: 0n }, "approval", owner, deployment.chainId, onUpdate, false, deployment);
  }
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [contract, amount] });
  await assertWalletSession(session, owner, deployment.chainId);
  const approval = await wallet.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [contract, amount], account: owner, chain: chainFor(deployment) });
  await wait(approval, { to: token, data, value: 0n }, "approval", owner, deployment.chainId, onUpdate, false, deployment);
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
}, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const durationSeconds = deadlineDurationSeconds(input.deadlineDays);
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  const capability = normalizeCapability(input.capability);
  const specification = input.specification.trim();
  if (!specification || new TextEncoder().encode(specification).length > 2048) throw new Error("DEMAND_INVALID_SPEC");
  const commitment = parseTokenAmount(input.commitment);
  const maxPrice = parseTokenAmount(input.maxPrice);
  if (commitment <= 0n || commitment > (1n << 96n) - 1n || maxPrice <= 0n || maxPrice > (1n << 96n) - 1n) throw new Error("DEMAND_INVALID_AMOUNT");
  const calls = parsePositiveUint(input.expectedCalls, 64, "DEMAND_INVALID_CALLS");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + durationSeconds);
  const verified = await requireVerifiedDeployment(deployment);
  await ensureAllowance(account, commitment, session, verified, onUpdate);
  return writeDemand(account, "createDemand", [capability, specification, maxPrice, calls, deadline, commitment], session, "demand", onUpdate, undefined, verified);
}

export async function supportDemand(demandId: bigint, amount: string, expectedCalls: string, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  const atomic = parseTokenAmount(amount);
  if (atomic <= 0n || atomic > (1n << 96n) - 1n) throw new Error("SUPPORT_TOO_SMALL");
  const calls = parsePositiveUint(expectedCalls, 64, "DEMAND_INVALID_CALLS");
  const verified = await requireVerifiedDeployment(deployment);
  await ensureAllowance(account, atomic, session, verified, onUpdate);
  return writeDemand(account, "supportDemand", [demandId, atomic, calls], session, "action", onUpdate, undefined, verified);
}

export async function submitService(demandId: bigint, serviceUrl: string, evidence: string, payTo: string, network: string, request: RequestMetadata, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const endpoint = import.meta.env.VITE_VALIDATION_URL;
  if (!endpoint || !validationNetworks.includes(network)) throw new Error("VALIDATION_UNAVAILABLE");
  const endpointUrl = new URL(endpoint, window.location.origin);
  if ((endpointUrl.origin !== window.location.origin && endpointUrl.protocol !== "https:") || endpointUrl.username || endpointUrl.password || endpointUrl.hash || endpointUrl.search || endpointUrl.pathname !== "/v1/x402/validate") throw new Error("VALIDATION_UNAVAILABLE");
  const selected = selectedDeployment;
  const { account, session } = await requireAccount(selected, originatingSession);
  const deployment = await requireVerifiedDeployment(selected);
  let url: URL;
  try { url = new URL(serviceUrl.trim()); } catch { throw new Error("SUBMISSION_INVALID_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) throw new Error("SUBMISSION_INVALID_URL");
  if (!isAddress(payTo) || /^0x0{40}$/i.test(payTo)) throw new Error("VALIDATION_INVALID_PAYTO");
  const evidenceValue = evidence.trim();
  if (!evidenceValue) throw new Error("SUBMISSION_INVALID_EVIDENCE");
  const evidenceHash = (/^0x[0-9a-fA-F]{64}$/.test(evidenceValue) ? evidenceValue.toLowerCase() : keccak256(toBytes(evidenceValue))) as Hash;
  if (/^0x0{64}$/.test(evidenceHash)) throw new Error("SUBMISSION_INVALID_EVIDENCE");
  const client = getPublic(deployment);
  const nonce = await client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "submissionNonce", args: [demandId] }) + 1n;
  const input = { chainId: deployment.chainId, contract: deployment.contract, demandId, builder: account, payTo: getAddress(payTo), serviceUrl: url.href, evidenceHash, network, nonce, request };
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + 300n;
  validateRequest(input, issuedAt, expiresAt);
  await assertWalletSession(session, account);
  const signature = await walletClient(session, deployment).signTypedData({ ...authorization(input, issuedAt, expiresAt), account });
  await assertWalletSession(session, account);
  const requestBody = JSON.stringify({
    schemaVersion: "unmet-x402-validation-v1", escrowChainId: String(deployment.chainId), escrowContract: deployment.contract.toLowerCase(), demandId: String(demandId), submissionNonce: String(nonce), builderWallet: account.toLowerCase(), authorizedPayTo: input.payTo.toLowerCase(), serviceUrl: input.serviceUrl, evidenceHash, paymentNetwork: network, request, builderAuthorization: { issuedAt: String(issuedAt), expiresAt: String(expiresAt), signature: signature.toLowerCase() },
  });
  if (new TextEncoder().encode(requestBody).length > 32768 || !/^0x(?:[0-9a-f]{2}){1,4096}$/.test(signature.toLowerCase())) throw new Error("VALIDATION_INVALID_REQUEST");
  const response = await fetch(endpointUrl, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000), body: requestBody });
  const result: unknown = await response.json();
  if (!response.ok || !result || typeof result !== "object" || !("status" in result) || result.status !== "PASS") throw new Error("VALIDATION_FAILED");
  const verifier = await client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "verifier" });
  const pass = await validatePass(result, input, verifier, BigInt(Math.floor(Date.now() / 1000)), expiresAt);
  await assertWalletSession(session, account);
  if (await client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "submissionNonce", args: [demandId] }) + 1n !== nonce) throw new Error("VALIDATION_NONCE_STALE");
  let confirmedUpdate: Parameters<TransactionUpdateHandler>[0] | undefined;
  const hash = await writeDemand(account, "submitService", [demandId, input.serviceUrl, evidenceHash, pass.attestation, pass.signature], session, "action", update => {
    if (update.state === "confirmed") confirmedUpdate = update;
    else onUpdate?.(update);
  }, async () => {
    if (await client.readContract({ address: deployment.contract, abi: DEMAND_ABI, functionName: "submissionNonce", args: [demandId] }) + 1n !== nonce) throw new Error("VALIDATION_NONCE_STALE");
    if (BigInt(Math.floor(Date.now() / 1000)) >= pass.attestation.expiresAt) throw new Error("VALIDATION_EXPIRED");
  }, deployment);
  try {
    await verifySubmission(deployment, account, demandId, input.serviceUrl, evidenceHash, pass.attestation);
  } catch {
    if (confirmedUpdate) onUpdate?.({ ...confirmedUpdate, state: "unknown" });
    throw new Error("SUBMISSION_READBACK_FAILED");
  }
  if (confirmedUpdate) onUpdate?.(confirmedUpdate);
  return hash;
}

export async function approveService(demandId: bigint, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  return writeDemand(account, "approveService", [demandId], session, "action", onUpdate, undefined, deployment);
}
export async function rejectService(demandId: bigint, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  return writeDemand(account, "rejectService", [demandId], session, "action", onUpdate, undefined, deployment);
}
export async function finalizeDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  return writeDemand(account, "finalize", [demandId], session, "action", onUpdate, undefined, deployment);
}
export async function reopenDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  return writeDemand(account, "reopen", [demandId], session, "action", onUpdate, undefined, deployment);
}
export async function refundDemand(demandId: bigint, onUpdate?: TransactionUpdateHandler, originatingSession?: WalletSession): Promise<Hash> {
  const deployment = selectedDeployment;
  const { account, session } = await requireAccount(deployment, originatingSession);
  return writeDemand(account, "refund", [demandId], session, "action", onUpdate, undefined, deployment);
}

export async function verifyTransaction(
  stage: TransactionStage,
  hash: Hash,
  intent: TransactionIntent,
  expectedWallet: Address,
  expectedChainId: number,
  expectedContract: Address,
  onUpdate?: TransactionUpdateHandler,
  originatingSession?: WalletSession,
): Promise<Hash> {
  const session = await requireWalletSession(originatingSession ?? captureWalletSession(expectedWallet) ?? undefined);
  if (expectedChainId !== CHAIN_ID) throw new Error("CHAIN_WRONG_NETWORK");
  await assertWalletSession({ ...session, account: expectedWallet }, expectedWallet);
  const deployment = await requireVerifiedDeployment();
  if (expectedContract.toLowerCase() !== deployment.contract.toLowerCase()) throw new Error("TRANSACTION_DEPLOYMENT_MISMATCH");
  if (stage === "approval") {
    if (intent.to.toLowerCase() !== deployment.escrowToken.address.toLowerCase()) throw new Error("TRANSACTION_INTENT_MISMATCH");
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: intent.data });
    if (decoded.functionName !== "approve" || decoded.args[0].toLowerCase() !== deployment.contract.toLowerCase()) throw new Error("TRANSACTION_INTENT_MISMATCH");
  } else if (intent.to.toLowerCase() !== deployment.contract.toLowerCase()) throw new Error("TRANSACTION_INTENT_MISMATCH");
  const decoded = stage === "action" ? decodeFunctionData({ abi: DEMAND_ABI, data: intent.data }) : null;
  let confirmedUpdate: Parameters<TransactionUpdateHandler>[0] | undefined;
  const transactionHash = await wait(hash, intent, stage, expectedWallet, expectedChainId, update => {
    if (decoded?.functionName === "submitService" && update.state === "confirmed") confirmedUpdate = update;
    else onUpdate?.(update);
  }, true, deployment);
  if (decoded?.functionName === "submitService") {
    const [id, url, evidence, attestation] = decoded.args;
    try {
      await verifySubmission(deployment, expectedWallet, id, url, evidence, attestation);
    } catch {
      if (confirmedUpdate) onUpdate?.({ ...confirmedUpdate, state: "unknown" });
      throw new Error("SUBMISSION_READBACK_FAILED");
    }
    if (confirmedUpdate) onUpdate?.(confirmedUpdate);
  }
  return transactionHash;
}

export function formatTokenAmount(value: bigint): string { return formatEscrowAmount(value, ESCROW_DECIMALS); }
export function parseTokenAmount(value: string): bigint { return parseEscrowAmount(value, ESCROW_DECIMALS); }
export function explorerTx(hash: string): string { return `${targetChain.blockExplorers.default.url}/tx/${hash}`; }
