import type { Address, Hash, Hex } from "viem";

export type TransactionStage = "approval" | "demand" | "action";
export type TransactionState = "broadcast" | "confirmed" | "reverted" | "cancelled" | "unknown";
export type TransactionFailureState = Extract<TransactionState, "reverted" | "cancelled" | "unknown">;

export type TransactionIntent = {
  to: Address;
  data: Hex;
  value: bigint;
};

export type TransactionUpdate = {
  stage: TransactionStage;
  state: TransactionState;
  hash: Hash;
  intent: TransactionIntent;
};

export type TransactionUpdateHandler = (update: TransactionUpdate) => void;

export type ObservedTransaction = {
  hash: Hash;
  to: Address | null;
  data: Hex;
  value: bigint;
};

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
  onUpdate?: TransactionUpdateHandler;
  readTransaction?: (hash: Hash) => Promise<ObservedTransaction | null>;
  waitForReceipt: (options: {
    hash: Hash;
    onReplaced?: (replacement: Replacement) => void;
  }) => Promise<TransactionReceipt>;
};

export class TransactionLifecycleError extends Error {
  constructor(
    readonly stage: TransactionStage,
    readonly state: TransactionFailureState,
    readonly hash: Hash,
    readonly intent: TransactionIntent,
    message: string,
  ) {
    super(message);
    this.name = "TransactionLifecycleError";
  }
}

export function isTransactionIntentMatch(
  intent: TransactionIntent,
  transaction: ObservedTransaction,
): boolean {
  return transaction.to?.toLowerCase() === intent.to.toLowerCase()
    && transaction.data.toLowerCase() === intent.data.toLowerCase()
    && transaction.value === intent.value;
}

export function isTransactionSubmissionBlocked(state: TransactionState | null): boolean {
  return state === "broadcast" || state === "unknown";
}

export async function waitForTransaction({
  stage,
  hash,
  intent,
  onUpdate,
  readTransaction,
  waitForReceipt,
}: WaitForTransactionOptions): Promise<Hash> {
  onUpdate?.({ stage, state: "broadcast", hash, intent });
  if (readTransaction) {
    let observed: ObservedTransaction | null;
    try {
      observed = await readTransaction(hash);
    } catch (error) {
      onUpdate?.({ stage, state: "unknown", hash, intent });
      throw new TransactionLifecycleError(
        stage,
        "unknown",
        hash,
        intent,
        error instanceof Error ? error.message : "The submitted transaction could not be read.",
      );
    }
    if (!observed || !isTransactionIntentMatch(intent, observed)) {
      onUpdate?.({ stage, state: "unknown", hash, intent });
      throw new TransactionLifecycleError(
        stage,
        "unknown",
        hash,
        intent,
        "This transaction does not match the original action and cannot be confirmed as its result.",
      );
    }
  }
  const replacementState: { value: Replacement | null } = { value: null };
  let receipt: TransactionReceipt;

  try {
    receipt = await waitForReceipt({
      hash,
      onReplaced: (observed) => {
        replacementState.value = observed;
        onUpdate?.({ stage, state: "broadcast", hash: observed.transaction.hash, intent });
      },
    });
  } catch (error) {
    const replacement = replacementState.value;
    const replacementReceipt = replacement?.transactionReceipt;
    const failureState = replacement?.reason === "cancelled" ? "cancelled" : "unknown";
    const failureHash = replacementReceipt?.transactionHash ?? hash;
    onUpdate?.({ stage, state: failureState, hash: failureHash, intent });
    throw new TransactionLifecycleError(
      stage,
      failureState,
      failureHash,
      intent,
      failureState === "cancelled"
        ? "The transaction was cancelled by a wallet replacement."
        : error instanceof Error ? error.message : "The transaction receipt could not be verified.",
    );
  }

  const replacement = replacementState.value;
  const receiptHash = receipt.transactionHash;
  if (replacement?.reason === "cancelled") {
    onUpdate?.({ stage, state: "cancelled", hash: receiptHash, intent });
    throw new TransactionLifecycleError(stage, "cancelled", receiptHash, intent, "The transaction was cancelled by a wallet replacement.");
  }

  if (replacement && replacement.transaction.hash.toLowerCase() !== receiptHash.toLowerCase()) {
    onUpdate?.({ stage, state: "unknown", hash: receiptHash, intent });
    throw new TransactionLifecycleError(stage, "unknown", receiptHash, intent, "The replacement hash did not match its receipt.");
  }

  if (replacement && !isTransactionIntentMatch(intent, replacement.transaction)) {
    onUpdate?.({ stage, state: "unknown", hash: receiptHash, intent });
    throw new TransactionLifecycleError(
      stage,
      "unknown",
      receiptHash,
      intent,
      "A replacement transaction was found, but its action could not be verified.",
    );
  }

  if (!replacement && receiptHash.toLowerCase() !== hash.toLowerCase()) {
    onUpdate?.({ stage, state: "unknown", hash: receiptHash, intent });
    throw new TransactionLifecycleError(stage, "unknown", receiptHash, intent, "The receipt hash did not match the submitted transaction.");
  }

  if (receipt.status !== "success") {
    onUpdate?.({ stage, state: "reverted", hash: receiptHash, intent });
    throw new TransactionLifecycleError(stage, "reverted", receiptHash, intent, "The transaction reverted on X Layer.");
  }

  onUpdate?.({ stage, state: "confirmed", hash: receiptHash, intent });
  return receiptHash;
}
