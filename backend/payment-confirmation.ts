import { AsyncLocalStorage } from "node:async_hooks";
import { createPublicClient, decodeEventLog, decodeFunctionData, http, type PublicClient } from "viem";
import { eip3009ABI } from "@okxweb3/x402-evm";
import type { PaymentRecord } from "./payment-store.ts";
import { fingerprint } from "./payment-identity.ts";
import { createBoundedFetch, withBoundedFetch } from "./upstream.ts";
import { loadOperationalConfig } from "./config.ts";
import { MAINNET_ASSETS } from "./payment-identity.ts";

const tokens = new Set<string>(MAINNET_ASSETS.map(({ asset }) => asset));
const directTransactionTypes = new Set(["legacy", "eip2930", "eip1559"]);
type ConfirmationReadStage = "chain_id" | "transaction" | "receipt" | "block";
const confirmationSignal = new AsyncLocalStorage<AbortSignal>();

export class PaymentConfirmationUnavailable extends Error {
  constructor(public readonly stage: ConfirmationReadStage) {
    super("PAYMENT_CONFIRMATION_UNAVAILABLE");
    this.name = "PaymentConfirmationUnavailable";
  }
}

export function withPaymentConfirmationSignal<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  return confirmationSignal.run(signal, task);
}

async function read<T>(stage: ConfirmationReadStage, task: () => Promise<T>): Promise<T> {
  try { return await task(); }
  catch { throw new PaymentConfirmationUnavailable(stage); }
}

export class PaymentConfirmationRetryExceeded extends Error {
  readonly code = "CONFIRMATION_RETRY_EXHAUSTED";
  constructor(public readonly attempts: number, public readonly stage: string) {
    super("CONFIRMATION_RETRY_EXHAUSTED");
    this.name = "PaymentConfirmationRetryExceeded";
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function confirmPaymentWithRetry(record: PaymentRecord,
  confirm: (record: PaymentRecord) => Promise<boolean>, budgetMs: number) {
  const controller = new AbortController(), deadline = Date.now() + budgetMs;
  const timeout = setTimeout(() => controller.abort(), budgetMs);
  let attempts = 0, lastStage = "unknown";
  try {
    while (true) {
      if (controller.signal.aborted) throw new PaymentConfirmationRetryExceeded(attempts, lastStage);
      attempts++;
      try {
        const confirmed = await withPaymentConfirmationSignal(controller.signal, () => confirm(record));
        return { confirmed, attempts, lastStage };
      } catch (error) {
        if (!(error instanceof PaymentConfirmationUnavailable)) throw error;
        lastStage = error.stage;
        const remaining = deadline - Date.now();
        if (controller.signal.aborted || remaining <= 0) throw new PaymentConfirmationRetryExceeded(attempts, lastStage);
        await delay(Math.min(50 * 2 ** Math.min(attempts - 1, 4), remaining), controller.signal);
      }
    }
  } finally { clearTimeout(timeout); }
}

const eventAbi = [
  { type: "event", name: "AuthorizationUsed", anonymous: false,
    inputs: [{ name: "authorizer", type: "address", indexed: true }, { name: "nonce", type: "bytes32", indexed: true }] },
  { type: "event", name: "Transfer", anonymous: false,
    inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false }] },
] as const;

export async function confirmPayment(record: PaymentRecord, client: PublicClient): Promise<boolean> {
  if (!record.txHash || record.network !== "eip155:196") return false;
  if (await read("chain_id", () => client.getChainId()) !== 196) return false;
  const hash = record.txHash as `0x${string}`;
  const [txRead, receiptRead] = await Promise.allSettled([
    read("transaction", () => client.getTransaction({ hash })),
    read("receipt", () => client.getTransactionReceipt({ hash })),
  ]);
  if (txRead.status === "rejected") throw txRead.reason;
  if (receiptRead.status === "rejected") throw receiptRead.reason;
  const tx = txRead.value, receipt = receiptRead.value;
  if (!tx) throw new PaymentConfirmationUnavailable("transaction");
  if (!receipt) throw new PaymentConfirmationUnavailable("receipt");
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    tx.hash.toLowerCase() !== hash.toLowerCase() || !directTransactionTypes.has(tx.type) ||
    tx.chainId !== undefined && tx.chainId !== 196 || tx.blockNumber === null || tx.blockHash === null ||
    receipt.blockNumber !== tx.blockNumber || receipt.blockHash?.toLowerCase() !== tx.blockHash.toLowerCase() ||
    receipt.transactionIndex !== tx.transactionIndex || receipt.to?.toLowerCase() !== tx.to?.toLowerCase() ||
    receipt.from.toLowerCase() !== tx.from.toLowerCase() || !tx.to || !tokens.has(tx.to.toLowerCase())) return false;
  const block = await read("block", () => client.getBlock({ blockNumber: receipt.blockNumber }));
  if (block.number !== receipt.blockNumber || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    block.transactions[receipt.transactionIndex]?.toLowerCase() !== hash.toLowerCase() ||
    new Set(receipt.logs.map((log) => log.logIndex)).size !== receipt.logs.length ||
    receipt.logs.some((log) => log.removed || log.logIndex === null || log.blockHash?.toLowerCase() !== receipt.blockHash!.toLowerCase() ||
      log.blockNumber !== receipt.blockNumber || log.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      log.transactionIndex !== receipt.transactionIndex)) return false;
  let decoded;
  try { decoded = decodeFunctionData({ abi: eip3009ABI, data: tx.input }); }
  catch { return false; }
  if (decoded.functionName !== "transferWithAuthorization") return false;
  const [from, to, value, validAfter, validBefore, nonce] = decoded.args;
  if (from.toLowerCase() !== record.payer || to.toLowerCase() !== record.recipient || value.toString() !== record.amount ||
    validBefore * 1000n !== BigInt(record.validBefore) || block.timestamp <= validAfter || block.timestamp >= validBefore) return false;
  if (fingerprint({ network: record.network, asset: tx.to.toLowerCase(), from: from.toLowerCase(), nonce: nonce.toLowerCase() }) !== record.payment) return false;
  const candidates = receipt.logs.filter((log) => log.address.toLowerCase() === tx.to!.toLowerCase());
  let authorizationCount = 0, transferCount = 0, invalidTokenEvent = false;
  for (const log of candidates) {
    try {
      const event = decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics, strict: true });
      if (event.eventName === "AuthorizationUsed") {
        if (event.args.authorizer.toLowerCase() === from.toLowerCase() && event.args.nonce.toLowerCase() === nonce.toLowerCase()) authorizationCount++;
        else invalidTokenEvent = true;
      } else if (event.eventName === "Transfer") {
        if (event.args.from.toLowerCase() === from.toLowerCase() && event.args.to.toLowerCase() === to.toLowerCase() && event.args.value === value) transferCount++;
        else invalidTokenEvent = true;
      } else invalidTokenEvent = true;
    } catch { invalidTokenEvent = true; }
  }
  return !invalidTokenEvent && candidates.length === 2 && authorizationCount === 1 && transferCount === 1;
}

export function createMainnetPaymentClient(): PublicClient {
  const config = loadOperationalConfig();
  const fetch = createBoundedFetch({ maxInFlight: config.rpcMaxInFlight, timeoutMs: config.rpcTimeoutMs, maxBytes: config.upstreamMaxBytes });
  const client = createPublicClient({ transport: http(config.x402RpcUrl, { timeout: config.rpcTimeoutMs, retryCount: 0,
    fetchFn: (input, init) => {
      const signals = [init?.signal, input instanceof Request ? input.signal : undefined, confirmationSignal.getStore()]
        .filter((signal): signal is AbortSignal => signal !== undefined && signal !== null);
      const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
      return withBoundedFetch(fetch, () => fetch(input, signal ? { ...init, signal } : init));
    } }) });
  return client;
}
