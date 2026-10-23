import { getAddress, isAddress } from "viem";
import type { Address, Hash, Hex } from "viem";
import type { CreatedDemandVerification } from "./create-demand-chat-model";

export type TransactionStage = "approval" | "demand" | "action";
export type TransactionState = "broadcast" | "confirmed" | "reverted" | "cancelled" | "unknown";
type TransactionFailureState = Extract<TransactionState, "reverted" | "cancelled" | "unknown">;
type PendingTransactionState = Extract<TransactionState, "broadcast" | "unknown">;

export type TransactionIntent = {
  to: Address;
  data: Hex;
  value: bigint;
};

type TransactionUpdate = {
  stage: TransactionStage;
  state: TransactionState;
  hash: Hash;
  intent: TransactionIntent;
  wallet: Address;
  chainId: number;
};

export type TransactionUpdateHandler = (update: TransactionUpdate) => void;

export type ObservedTransaction = {
  hash: Hash;
  from: Address;
  to: Address | null;
  data: Hex;
  value: bigint;
};

export type PendingTransactionRecord = {
  wallet: Address;
  chainId: number;
  actionId: string;
  actionLabel: string;
  stage: TransactionStage;
  state: PendingTransactionState;
  hash: Hash;
  intent: TransactionIntent;
  verification?: CreatedDemandVerification;
};

export type TransactionStorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

type TransactionReceipt = {
  transactionHash: Hash;
  status: "success" | "reverted";
};

type Replacement = {
  reason: "repriced" | "cancelled" | "replaced";
  transaction: ObservedTransaction;
  transactionReceipt: TransactionReceipt;
};

type WaitForTransactionOptions = {
  stage: TransactionStage;
  hash: Hash;
  intent: TransactionIntent;
  wallet: Address;
  chainId: number;
  onUpdate?: TransactionUpdateHandler;
  readTransaction?: (hash: Hash) => Promise<ObservedTransaction | null>;
  waitForReceipt: (options: {
    hash: Hash;
    onReplaced?: (replacement: Replacement) => void;
  }) => Promise<TransactionReceipt>;
};

export type LegacyPendingCreate = {
  stage: "approval" | "demand";
  hash: Hash;
  intent: TransactionIntent;
};

export const PENDING_TRANSACTION_PREFIX = "unmet.pending-transaction.v1:";
export const LEGACY_PENDING_CREATE_KEY = "unmet.pending-create-transaction";
export const CREATE_DEMAND_ACTION_ID = "create-demand";

export class TransactionLifecycleError extends Error {
  constructor(
    readonly stage: TransactionStage,
    readonly state: TransactionFailureState,
    readonly hash: Hash,
    readonly intent: TransactionIntent,
    readonly wallet: Address,
    readonly chainId: number,
    message: string,
  ) {
    super(message);
    this.name = "TransactionLifecycleError";
  }
}

export type TransactionFailureOutcome = {
  kind: TransactionFailureState;
  stage: TransactionStage;
  hash: Hash;
  intent: TransactionIntent;
  wallet: Address;
  chainId: number;
  actionId: string;
  message: string;
};

export function transactionFailureOutcome(
  error: TransactionLifecycleError,
  actionId: string,
): TransactionFailureOutcome {
  return {
    kind: error.state,
    stage: error.stage,
    hash: error.hash,
    intent: error.intent,
    wallet: error.wallet,
    chainId: error.chainId,
    actionId,
    message: error.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  return getAddress(value);
}

function parseHash(value: unknown): Hash | null {
  return typeof value === "string" && /^0x[\da-f]{64}$/i.test(value) ? value as Hash : null;
}

function parseIntent(value: unknown): TransactionIntent | null {
  if (!isRecord(value)) return null;
  const to = parseAddress(value.to);
  if (!to || typeof value.data !== "string" || !/^0x(?:[\da-f]{2})*$/i.test(value.data)) return null;
  if (typeof value.value !== "string" || !/^\d+$/.test(value.value)) return null;
  return { to, data: value.data as Hex, value: BigInt(value.value) };
}

function parseVerification(value: unknown): CreatedDemandVerification | undefined {
  if (!isRecord(value) || !Array.isArray(value.before) || !isRecord(value.expected)) return undefined;
  const before: Array<{ demandId: bigint }> = [];
  for (const item of value.before) {
    if (!isRecord(item) || typeof item.demandId !== "string" || !/^\d+$/.test(item.demandId)) return undefined;
    before.push({ demandId: BigInt(item.demandId) });
  }

  const expected = value.expected;
  const creator = parseAddress(expected.creator);
  if (!creator || typeof expected.capability !== "string" || typeof expected.specification !== "string") return undefined;
  if (typeof expected.maxPrice !== "string" || !/^\d+$/.test(expected.maxPrice)) return undefined;
  if (typeof expected.expectedCalls !== "string" || !/^\d+$/.test(expected.expectedCalls)) return undefined;
  if (typeof expected.initialCommitment !== "string" || !/^\d+$/.test(expected.initialCommitment)) return undefined;
  return {
    before,
    expected: {
      creator,
      capability: expected.capability,
      specification: expected.specification,
      maxPrice: BigInt(expected.maxPrice),
      expectedCalls: BigInt(expected.expectedCalls),
      initialCommitment: BigInt(expected.initialCommitment),
    },
  };
}

function parsePendingTransaction(value: unknown): PendingTransactionRecord | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const wallet = parseAddress(value.wallet);
  const hash = parseHash(value.hash);
  const intent = parseIntent(value.intent);
  if (!wallet || !hash || !intent) return null;
  if (typeof value.chainId !== "number" || !Number.isSafeInteger(value.chainId) || value.chainId <= 0) return null;
  if (typeof value.actionId !== "string" || !value.actionId || value.actionId.length > 160) return null;
  if (typeof value.actionLabel !== "string" || !value.actionLabel || value.actionLabel.length > 80) return null;
  if (value.stage !== "approval" && value.stage !== "demand" && value.stage !== "action") return null;
  if (value.state !== "broadcast" && value.state !== "unknown") return null;
  const verification = parseVerification(value.verification);
  return {
    wallet,
    chainId: value.chainId,
    actionId: value.actionId,
    actionLabel: value.actionLabel,
    stage: value.stage,
    state: value.state,
    hash,
    intent,
    ...(verification ? { verification } : {}),
  };
}

function transactionStorageKey(wallet: Address, chainId: number, actionId: string): string {
  return PENDING_TRANSACTION_PREFIX + chainId + ":" + wallet.toLowerCase() + ":" + encodeURIComponent(actionId);
}

function serializePendingTransaction(record: PendingTransactionRecord): string {
  const verification = record.verification
    ? {
      before: record.verification.before.map(({ demandId }) => ({ demandId: demandId.toString() })),
      expected: {
        ...record.verification.expected,
        maxPrice: record.verification.expected.maxPrice.toString(),
        expectedCalls: record.verification.expected.expectedCalls.toString(),
        initialCommitment: record.verification.expected.initialCommitment.toString(),
      },
    }
    : undefined;
  return JSON.stringify({
    version: 1,
    wallet: record.wallet,
    chainId: record.chainId,
    actionId: record.actionId,
    actionLabel: record.actionLabel,
    stage: record.stage,
    state: record.state,
    hash: record.hash,
    intent: { ...record.intent, value: record.intent.value.toString() },
    ...(verification ? { verification } : {}),
  });
}

export function readPendingTransactions(storage: TransactionStorageLike | null): {
  available: boolean;
  invalidRecords: number;
  records: PendingTransactionRecord[];
} {
  if (!storage) return { available: false, invalidRecords: 0, records: [] };
  const records: PendingTransactionRecord[] = [];
  let invalidRecords = 0;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(PENDING_TRANSACTION_PREFIX)) continue;
      const raw = storage.getItem(key);
      let record: PendingTransactionRecord | null = null;
      try {
        record = raw === null ? null : parsePendingTransaction(JSON.parse(raw));
      } catch {
        record = null;
      }
      if (!record || key !== transactionStorageKey(record.wallet, record.chainId, record.actionId)) {
        invalidRecords += 1;
        continue;
      }
      records.push({ ...record, state: record.state === "broadcast" ? "unknown" : record.state });
    }
    return { available: true, invalidRecords, records };
  } catch {
    return { available: false, invalidRecords, records };
  }
}

export function storePendingTransaction(storage: TransactionStorageLike | null, record: PendingTransactionRecord): boolean {
  if (!storage) return false;
  try {
    storage.setItem(transactionStorageKey(record.wallet, record.chainId, record.actionId), serializePendingTransaction(record));
    return true;
  } catch {
    return false;
  }
}

export function removePendingTransaction(storage: TransactionStorageLike | null, record: PendingTransactionRecord): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(transactionStorageKey(record.wallet, record.chainId, record.actionId));
    return true;
  } catch {
    return false;
  }
}

export function findPendingTransaction(
  records: readonly PendingTransactionRecord[],
  wallet: Address,
  chainId: number,
  actionId: string,
): PendingTransactionRecord | null {
  return records.find((record) =>
    record.wallet.toLowerCase() === wallet.toLowerCase()
    && record.chainId === chainId
    && record.actionId === actionId,
  ) ?? null;
}

export function readLegacyPendingCreate(storage: TransactionStorageLike | null): {
  available: boolean;
  invalid: boolean;
  record: LegacyPendingCreate | null;
} {
  if (!storage) return { available: false, invalid: false, record: null };
  try {
    const raw = storage.getItem(LEGACY_PENDING_CREATE_KEY);
    if (raw === null) return { available: true, invalid: false, record: null };
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.kind !== "unknown" || (value.stage !== "approval" && value.stage !== "demand")) {
      return { available: true, invalid: true, record: null };
    }
    const hash = parseHash(value.hash);
    const intent = parseIntent(value.intent);
    if (!hash || !intent) return { available: true, invalid: true, record: null };
    return { available: true, invalid: false, record: { stage: value.stage, hash, intent } };
  } catch {
    return { available: false, invalid: false, record: null };
  }
}

export function recoverLegacyPendingCreate(
  legacy: LegacyPendingCreate,
  observed: ObservedTransaction,
  wallet: Address,
  chainId: number,
): PendingTransactionRecord | null {
  if (observed.hash.toLowerCase() !== legacy.hash.toLowerCase() || !isTransactionIntentMatch(legacy.intent, observed, wallet)) return null;
  return {
    wallet,
    chainId,
    actionId: CREATE_DEMAND_ACTION_ID,
    actionLabel: "Create Demand",
    stage: legacy.stage,
    state: "unknown",
    hash: legacy.hash,
    intent: legacy.intent,
  };
}

export function isTransactionIntentMatch(
  intent: TransactionIntent,
  transaction: ObservedTransaction,
  expectedWallet?: Address,
): boolean {
  return transaction.to?.toLowerCase() === intent.to.toLowerCase()
    && transaction.data.toLowerCase() === intent.data.toLowerCase()
    && transaction.value === intent.value
    && (!expectedWallet || transaction.from.toLowerCase() === expectedWallet.toLowerCase());
}

export function isTransactionSubmissionBlocked(state: TransactionState | null): boolean {
  return state === "broadcast" || state === "unknown";
}

export async function waitForTransaction({
  stage,
  hash,
  intent,
  wallet,
  chainId,
  onUpdate,
  readTransaction,
  waitForReceipt,
}: WaitForTransactionOptions): Promise<Hash> {
  const update = (state: TransactionState, transactionHash = hash) => {
    onUpdate?.({ stage, state, hash: transactionHash, intent, wallet, chainId });
  };
  const fail = (state: TransactionFailureState, transactionHash: Hash, message: string): never => {
    update(state, transactionHash);
    throw new TransactionLifecycleError(stage, state, transactionHash, intent, wallet, chainId, message);
  };

  update("broadcast");
  let observed: ObservedTransaction | null = null;
  if (readTransaction) {
    try {
      observed = await readTransaction(hash);
    } catch {
      observed = null;
    }
    if (observed && (observed.hash.toLowerCase() !== hash.toLowerCase() || !isTransactionIntentMatch(intent, observed, wallet))) {
      return fail("unknown", hash, "This transaction does not match the original wallet and action");
    }
  }

  const replacementState: { value: Replacement | null } = { value: null };
  let receipt: TransactionReceipt;
  try {
    receipt = await waitForReceipt({
      hash,
      onReplaced: (next) => {
        replacementState.value = next;
        update("broadcast", next.transaction.hash);
      },
    });
  } catch (error) {
    const replacement = replacementState.value;
    const cancelledReplacement = replacement?.reason === "cancelled"
      && replacement.transaction.from.toLowerCase() === wallet.toLowerCase()
      && replacement.transaction.hash.toLowerCase() === replacement.transactionReceipt.transactionHash.toLowerCase();
    const failedHash = replacement?.transactionReceipt.transactionHash ?? hash;
    return fail(
      cancelledReplacement ? "cancelled" : "unknown",
      failedHash,
      cancelledReplacement
        ? "The transaction was cancelled by a wallet replacement"
        : error instanceof Error ? error.message : "The transaction receipt could not be verified",
    );
  }

  const replacement = replacementState.value;
  const receiptHash = receipt.transactionHash;
  if (replacement?.reason === "cancelled") {
    if (replacement.transaction.hash.toLowerCase() !== receiptHash.toLowerCase()
      || replacement.transaction.from.toLowerCase() !== wallet.toLowerCase()) {
      return fail("unknown", receiptHash, "The replacement cancellation could not be matched to this wallet");
    }
    return fail("cancelled", receiptHash, "The transaction was cancelled by a wallet replacement");
  }

  if (replacement && replacement.transaction.hash.toLowerCase() !== receiptHash.toLowerCase()) {
    return fail("unknown", receiptHash, "The replacement hash did not match its receipt");
  }

  if (replacement && !isTransactionIntentMatch(intent, replacement.transaction, wallet)) {
    return fail("unknown", receiptHash, "A replacement transaction was found, but its action could not be verified");
  }

  if (!replacement && receiptHash.toLowerCase() !== hash.toLowerCase()) {
    return fail("unknown", receiptHash, "The receipt hash did not match the submitted transaction");
  }

  if (readTransaction && !observed && !replacement) {
    return fail("unknown", receiptHash, "The existing transaction could not be matched to the original wallet and action");
  }

  if (receipt.status !== "success") {
    return fail("reverted", receiptHash, "The transaction reverted on X Layer");
  }

  update("confirmed", receiptHash);
  return receiptHash;
}
