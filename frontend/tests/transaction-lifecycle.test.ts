import { afterEach, describe, expect, test } from "bun:test";
import type { Address, Hash, Hex } from "viem";
import { createDemand, setReownWalletProvider, verifyTransaction } from "../contract";
import { errorMessage } from "../errors";
import {
  isTransactionIntentMatch,
  isTransactionSubmissionBlocked,
  TransactionLifecycleError,
  waitForTransaction,
  findPendingTransaction,
  readPendingTransactions,
  readLegacyPendingCreate,
  recoverLegacyPendingCreate,
  removePendingTransaction,
  storePendingTransaction,
  PENDING_TRANSACTION_PREFIX,
  LEGACY_PENDING_CREATE_KEY,
  type LegacyPendingCreate,
  type ObservedTransaction,
  type PendingTransactionRecord,
  type TransactionStorageLike,
  type TransactionIntent,
} from "../transaction-lifecycle";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const otherWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const originalHash = `0x${"1".repeat(64)}` as Hash;
const replacementHash = `0x${"2".repeat(64)}` as Hash;
const receiptHash = `0x${"3".repeat(64)}` as Hash;
const to = "0x1111111111111111111111111111111111111111" as Address;
const otherTo = "0x2222222222222222222222222222222222222222" as Address;
const data = "0x1234" as Hex;
const otherData = "0xabcd" as Hex;
const intent: TransactionIntent = { to, data, value: 0n };

afterEach(() => setReownWalletProvider(null));

function successReceipt(transactionHash: Hash = originalHash) {
  return { transactionHash, status: "success" as const };
}

describe("transaction lifecycle", () => {
  test("reports broadcast before receipt and confirms with the receipt hash", async () => {
    const updates: Array<{ state: string; hash: Hash }> = [];
    const result = await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      onUpdate: ({ state, hash }) => updates.push({ state, hash }),
      waitForReceipt: async () => successReceipt(originalHash),
    });

    expect(result).toBe(originalHash);
    expect(updates).toEqual([
      { state: "broadcast", hash: originalHash },
      { state: "confirmed", hash: originalHash },
    ]);
  });

  test("marks a reverted receipt as reverted", async () => {
    const updates: string[] = [];
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      onUpdate: ({ state }) => updates.push(state),
      waitForReceipt: async () => ({ transactionHash: originalHash, status: "reverted" }),
    })).rejects.toMatchObject<TransactionLifecycleError>({ state: "reverted", hash: originalHash });
    expect(updates).toEqual(["broadcast", "reverted"]);
  });

  test.each(["timeout", "RPC error"] as const)("marks a post-broadcast %s as unknown", async (failure) => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async () => { throw new Error(failure); },
    })).rejects.toMatchObject({ state: "unknown", stage: "demand", hash: originalHash });
  });

  test("keeps allowance approval timeout distinct from demand creation", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "approval",
      hash: originalHash,
      intent,
      waitForReceipt: async () => { throw new Error("timeout"); },
    })).rejects.toMatchObject({ state: "unknown", stage: "approval", hash: originalHash });
  });

  test("keeps a confirmed allowance approval distinct from the application action", async () => {
    const updates: Array<{ stage: string; state: string }> = [];
    const result = await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "approval",
      hash: originalHash,
      intent,
      onUpdate: ({ stage, state }) => updates.push({ stage, state }),
      waitForReceipt: async () => successReceipt(originalHash),
    });
    expect(result).toBe(originalHash);
    expect(updates).toEqual([
      { stage: "approval", state: "broadcast" },
      { stage: "approval", state: "confirmed" },
    ]);
  });

  test("confirms a repriced replacement using its receipt hash", async () => {
    const updates: Array<{ state: string; hash: Hash }> = [];
    const result = await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      onUpdate: ({ state, hash }) => updates.push({ state, hash }),
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, from: wallet, ...intent },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    });

    expect(result).toBe(replacementHash);
    expect(updates).toEqual([
      { state: "broadcast", hash: originalHash },
      { state: "broadcast", hash: replacementHash },
      { state: "confirmed", hash: replacementHash },
    ]);
  });

  test("does not treat a cancelled replacement as a successful demand", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "cancelled",
          transaction: { hash: replacementHash, from: wallet, to: otherTo, data: "0x" as Hex, value: 0n },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "cancelled", hash: replacementHash });
  });

  test("does not confirm a replacement with changed calldata", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "replaced",
          transaction: { hash: replacementHash, from: wallet, to, data: otherData, value: 0n },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
  });

  test("does not confirm a rechecked hash whose mined transaction changed calldata", async () => {
    let receiptReads = 0;
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: replacementHash,
      intent,
      readTransaction: async (hash) => ({ hash, from: wallet, to, data: otherData, value: 0n }),
      waitForReceipt: async () => {
        receiptReads += 1;
        return successReceipt(replacementHash);
      },
    })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
    expect(receiptReads).toBe(0);
  });

  test("verifies an existing hash only when its wallet and original intent match", async () => {
    const result = await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      readTransaction: async (hash) => ({ hash, from: wallet, ...intent }),
      waitForReceipt: async () => successReceipt(originalHash),
    });
    expect(result).toBe(originalHash);
  });

  test("keeps an existing-hash read failure unknown unless a matching replacement is verified", async () => {
    const result = await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      readTransaction: async () => null,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, from: wallet, ...intent },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    });
    expect(result).toBe(replacementHash);
  });

  test("does not confirm replacements with a changed recipient or value", async () => {
    for (const transaction of [
      { hash: replacementHash, from: wallet, to: otherTo, data, value: 0n },
      { hash: replacementHash, from: wallet, to, data, value: 1n },
    ]) {
      await expect(waitForTransaction({
        wallet,
        chainId: 1952,
        stage: "demand",
        hash: originalHash,
        intent,
        waitForReceipt: async ({ onReplaced }) => {
          const receipt = successReceipt(replacementHash);
          onReplaced?.({ reason: "replaced", transaction, transactionReceipt: receipt });
          return receipt;
        },
      })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
    }
  });

  test("does not confirm a replacement submitted by another wallet", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, from: otherWallet, ...intent },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
  });

  test("verification rejects a changed wallet or chain before signing or querying a receipt", async () => {
    const requested: string[] = [];
    setReownWalletProvider({
      request: async ({ method }: { method: string }) => {
        requested.push(method);
        if (method === "eth_accounts") return [otherWallet];
        if (method === "eth_chainId") return "0x7a0";
        return null;
      },
    });
    await expect(verifyTransaction("demand", originalHash, intent, wallet, 1952)).rejects.toThrow("WALLET_CHANGED");
    expect(requested).toEqual(["eth_accounts", "eth_chainId"]);
    expect(requested).not.toContain("eth_sendTransaction");

    requested.length = 0;
    setReownWalletProvider({
      request: async ({ method }: { method: string }) => {
        requested.push(method);
        if (method === "eth_accounts") return [wallet];
        if (method === "eth_chainId") return "0x1";
        return null;
      },
    });
    await expect(verifyTransaction("demand", originalHash, intent, wallet, 1952)).rejects.toThrow("CHAIN_WRONG_NETWORK");
    expect(requested).toEqual(["eth_accounts", "eth_chainId"]);
    expect(requested).not.toContain("eth_sendTransaction");
  });

  test("includes the submitting wallet and target chain in lifecycle updates", async () => {
    const updates: Array<{ wallet: Address; chainId: number }> = [];
    await waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "action",
      hash: originalHash,
      intent,
      onUpdate: ({ wallet: sender, chainId }) => updates.push({ wallet: sender, chainId }),
      waitForReceipt: async () => successReceipt(originalHash),
    });
    expect(updates).toEqual([
      { wallet, chainId: 1952 },
      { wallet, chainId: 1952 },
    ]);
  });

  test("keeps a transaction unknown when its existing hash cannot be read", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: replacementHash,
      intent,
      readTransaction: async () => { throw new Error("RPC unavailable"); },
      waitForReceipt: async () => successReceipt(replacementHash),
    })).rejects.toMatchObject({ state: "unknown", message: "The existing transaction could not be matched to the original wallet and action." });
  });

  test("keeps a mismatched replacement receipt hash unknown and uses the receipt hash", async () => {
    await expect(waitForTransaction({
      wallet,
      chainId: 1952,
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(receiptHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, from: wallet, ...intent },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "unknown", hash: receiptHash });
  });

  test("checks recipient, calldata, and value before accepting replacement intent", () => {
    expect(isTransactionIntentMatch(intent, { to, data, value: 0n })).toBe(true);
    expect(isTransactionIntentMatch(intent, { to: otherTo, data, value: 0n })).toBe(false);
    expect(isTransactionIntentMatch(intent, { to, data: otherData, value: 0n })).toBe(false);
    expect(isTransactionIntentMatch(intent, { to, data, value: 1n })).toBe(false);
  });

  test("blocks duplicate submissions while a transaction result is pending or unknown", () => {
    expect(isTransactionSubmissionBlocked("broadcast")).toBe(true);
    expect(isTransactionSubmissionBlocked("unknown")).toBe(true);
    expect(isTransactionSubmissionBlocked("confirmed")).toBe(false);
    expect(isTransactionSubmissionBlocked("reverted")).toBe(false);
    expect(isTransactionSubmissionBlocked("cancelled")).toBe(false);
  });

  test("validates a too-short deadline before reading the connected wallet", async () => {
    let walletRequests = 0;
    setReownWalletProvider({
      request: async () => {
        walletRequests += 1;
        return [to];
      },
    });

    await expect(createDemand({
      capability: "vendor-kyb-api",
      specification: "Verify a business.",
      maxPrice: "0.02",
      expectedCalls: "1000",
      deadlineDays: "0.041655",
      commitment: "20",
    })).rejects.toThrow("DEMAND_DEADLINE_TOO_SHORT");
    expect(walletRequests).toBe(0);
  });
});

class MemoryTransactionStorage implements TransactionStorageLike {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("pending transaction storage", () => {
  const pending: PendingTransactionRecord = {
    wallet,
    chainId: 1952,
    actionId: "support:1",
    actionLabel: "Support Demand",
    stage: "approval",
    state: "broadcast",
    hash: originalHash,
    intent,
  };

  test("restores only the matching wallet, chain, and action after reload", () => {
    const storage = new MemoryTransactionStorage();
    expect(storePendingTransaction(storage, pending)).toBe(true);

    const restored = readPendingTransactions(storage);
    expect(restored.available).toBe(true);
    expect(restored.records).toHaveLength(1);
    expect(restored.records[0]).toMatchObject({ chainId: 1952, actionId: "support:1", state: "unknown", hash: originalHash });
    expect(restored.records[0]?.wallet.toLowerCase()).toBe(wallet.toLowerCase());
    expect(findPendingTransaction(restored.records, wallet, 1952, "support:1")?.hash).toBe(originalHash);
    expect(findPendingTransaction(restored.records, otherWallet, 1952, "support:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 196, "support:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 1952, "refund:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 1952, "support:2")).toBeNull();
  });

  test("removes a resolved record so the same action can be submitted again", () => {
    const storage = new MemoryTransactionStorage();
    storePendingTransaction(storage, pending);

    expect(removePendingTransaction(storage, pending)).toBe(true);
    const restored = readPendingTransactions(storage);
    expect(restored.records).toEqual([]);
    expect(findPendingTransaction(restored.records, wallet, 1952, "support:1")).toBeNull();
  });

  test("preserves malformed records in storage and reports them without crashing", () => {
    const storage = new MemoryTransactionStorage();
    const key = PENDING_TRANSACTION_PREFIX + "unparseable";
    storage.setItem(key, "{");

    const result = readPendingTransactions(storage);
    expect(result.available).toBe(true);
    expect(result.invalidRecords).toBe(1);
    expect(storage.getItem(key)).toBe("{");
    expect(result.records).toEqual([]);
  });

  test("reports unavailable storage without throwing", () => {
    expect(readPendingTransactions(null)).toEqual({ available: false, invalidRecords: 0, records: [] });
  });

  test("recovers a legacy create record only after the transaction sender and intent match", () => {
    const storage = new MemoryTransactionStorage();
    const legacy: LegacyPendingCreate = { stage: "demand", hash: originalHash, intent };
    storage.setItem(LEGACY_PENDING_CREATE_KEY, JSON.stringify({
      kind: "unknown",
      stage: legacy.stage,
      hash: legacy.hash,
      intent: { ...legacy.intent, value: legacy.intent.value.toString() },
    }));

    const read = readLegacyPendingCreate(storage);
    expect(read.record).toEqual(legacy);
    expect(storage.getItem(LEGACY_PENDING_CREATE_KEY)).not.toBeNull();

    const observed: ObservedTransaction = { hash: originalHash, from: wallet, ...intent };
    expect(recoverLegacyPendingCreate(legacy, observed, wallet, 1952)).toMatchObject({
      wallet,
      chainId: 1952,
      actionId: "create-demand",
      stage: "demand",
      state: "unknown",
      hash: originalHash,
    });
    expect(recoverLegacyPendingCreate(legacy, observed, otherWallet, 1952)).toBeNull();
    expect(recoverLegacyPendingCreate(legacy, { ...observed, data: otherData }, wallet, 1952)).toBeNull();
  });
});

describe("transaction error classification regression coverage", () => {
  test("preserves useful RPC, application, and fallback error messages", () => {
    expect(errorMessage({ shortMessage: "RPC request failed", message: "underlying RPC rejection" })).toBe("RPC request failed");
    expect(errorMessage("RPC offline")).toBe("RPC offline");
    expect(errorMessage({ shortMessage: "  ", message: "RPC rejected" })).toBe("RPC rejected");
    expect(errorMessage(new Error("WALLET_NOT_CONNECTED"))).toBe("WALLET_NOT_CONNECTED");
    expect(errorMessage(new Error("DEMAND_INVALID_CAPABILITY"))).toBe("Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max).");
    expect(errorMessage({ code: -1 })).toBe("INTERNAL_ERROR (-1)");
    expect(errorMessage(null)).toBe("INTERNAL_ERROR");
  });
});
