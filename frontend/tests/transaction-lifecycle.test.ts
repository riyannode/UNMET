import { afterEach, describe, expect, test } from "bun:test";
import type { Address, Hash, Hex } from "viem";
import { createDemand, setReownWalletProvider } from "../contract";
import {
  isTransactionIntentMatch,
  isTransactionSubmissionBlocked,
  TransactionLifecycleError,
  waitForTransaction,
  type TransactionIntent,
} from "../transaction-lifecycle";

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
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async () => { throw new Error(failure); },
    })).rejects.toMatchObject({ state: "unknown", stage: "demand", hash: originalHash });
  });

  test("keeps allowance approval timeout distinct from demand creation", async () => {
    await expect(waitForTransaction({
      stage: "approval",
      hash: originalHash,
      intent,
      waitForReceipt: async () => { throw new Error("timeout"); },
    })).rejects.toMatchObject({ state: "unknown", stage: "approval", hash: originalHash });
  });

  test("confirms a repriced replacement using its receipt hash", async () => {
    const updates: Array<{ state: string; hash: Hash }> = [];
    const result = await waitForTransaction({
      stage: "demand",
      hash: originalHash,
      intent,
      onUpdate: ({ state, hash }) => updates.push({ state, hash }),
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, ...intent },
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
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "cancelled",
          transaction: { hash: replacementHash, to: otherTo, data: "0x" as Hex, value: 0n },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "cancelled", hash: replacementHash });
  });

  test("does not confirm a replacement with changed calldata", async () => {
    await expect(waitForTransaction({
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(replacementHash);
        onReplaced?.({
          reason: "replaced",
          transaction: { hash: replacementHash, to, data: otherData, value: 0n },
          transactionReceipt: receipt,
        });
        return receipt;
      },
    })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
  });

  test("does not confirm a rechecked hash whose mined transaction changed calldata", async () => {
    let receiptReads = 0;
    await expect(waitForTransaction({
      stage: "demand",
      hash: replacementHash,
      intent,
      readTransaction: async (hash) => ({ hash, to, data: otherData, value: 0n }),
      waitForReceipt: async () => {
        receiptReads += 1;
        return successReceipt(replacementHash);
      },
    })).rejects.toMatchObject({ state: "unknown", hash: replacementHash });
    expect(receiptReads).toBe(0);
  });

  test("keeps a transaction unknown when its existing hash cannot be read", async () => {
    await expect(waitForTransaction({
      stage: "demand",
      hash: replacementHash,
      intent,
      readTransaction: async () => { throw new Error("RPC unavailable"); },
      waitForReceipt: async () => successReceipt(replacementHash),
    })).rejects.toMatchObject({ state: "unknown", message: "RPC unavailable" });
  });

  test("keeps a mismatched replacement receipt hash unknown and uses the receipt hash", async () => {
    await expect(waitForTransaction({
      stage: "demand",
      hash: originalHash,
      intent,
      waitForReceipt: async ({ onReplaced }) => {
        const receipt = successReceipt(receiptHash);
        onReplaced?.({
          reason: "repriced",
          transaction: { hash: replacementHash, ...intent },
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
