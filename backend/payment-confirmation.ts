import { createPublicClient, decodeEventLog, decodeFunctionData, http, type PublicClient } from "viem";
import { eip3009ABI } from "@okxweb3/x402-evm";
import type { PaymentRecord } from "./payment-store.ts";
import { fingerprint } from "./payment-identity.ts";
import { createBoundedFetch, withBoundedFetch } from "./upstream.ts";
import { loadOperationalConfig } from "./config.ts";
import { MAINNET_ASSETS } from "./payment-identity.ts";

const tokens = new Set<string>(MAINNET_ASSETS.map(({ asset }) => asset));
const directTransactionTypes = new Set(["legacy", "eip2930", "eip1559"]);
const eventAbi = [
  { type: "event", name: "AuthorizationUsed", anonymous: false,
    inputs: [{ name: "authorizer", type: "address", indexed: true }, { name: "nonce", type: "bytes32", indexed: true }] },
  { type: "event", name: "Transfer", anonymous: false,
    inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false }] },
] as const;

export async function confirmPayment(record: PaymentRecord, client: PublicClient): Promise<boolean> {
  if (!record.txHash || record.network !== "eip155:196" || await client.getChainId() !== 196) return false;
  const hash = record.txHash as `0x${string}`;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (!tx || !receipt || receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    tx.hash.toLowerCase() !== hash.toLowerCase() || !directTransactionTypes.has(tx.type) ||
    tx.chainId !== undefined && tx.chainId !== 196 || tx.blockNumber === null || tx.blockHash === null ||
    receipt.blockNumber !== tx.blockNumber || receipt.blockHash?.toLowerCase() !== tx.blockHash.toLowerCase() ||
    receipt.transactionIndex !== tx.transactionIndex || receipt.to?.toLowerCase() !== tx.to?.toLowerCase() ||
    receipt.from.toLowerCase() !== tx.from.toLowerCase() || !tx.to || !tokens.has(tx.to.toLowerCase())) return false;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.number !== receipt.blockNumber || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    block.transactions[receipt.transactionIndex]?.toLowerCase() !== hash.toLowerCase() ||
    new Set(receipt.logs.map((log) => log.logIndex)).size !== receipt.logs.length ||
    receipt.logs.some((log) => log.removed || log.logIndex === null || log.blockHash?.toLowerCase() !== receipt.blockHash!.toLowerCase() ||
      log.blockNumber !== receipt.blockNumber || log.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      log.transactionIndex !== receipt.transactionIndex)) return false;
  const decoded = decodeFunctionData({ abi: eip3009ABI, data: tx.input });
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
    fetchFn: (input, init) => withBoundedFetch(fetch, () => fetch(input, init)) }) });
  return client;
}
