import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { encodeFunctionData, type Address, type Hash, type Hex } from "viem";
import { approveService, captureWalletSession, createDemand, ERC20_ABI, setReownWalletProvider, supportDemand, verifyTransaction } from "../contract";
import { errorMessage } from "../errors";
import {
  isTransactionIntentMatch,
  isTransactionSubmissionBlocked,
  TransactionLifecycleError,
  transactionFailureOutcome,
  waitForTransaction,
  findPendingTransaction,
  readPendingTransactions,
  readLegacyPendingCreate,
  removePendingTransaction,
  storePendingTransaction,
  PENDING_TRANSACTION_PREFIX,
  LEGACY_PENDING_CREATE_KEY,
  type LegacyPendingCreate,
  type PendingTransactionRecord,
  type TransactionStorageLike,
  type TransactionIntent,
} from "../transaction-lifecycle";

type Gate<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const transactionHash = `0x${"9".repeat(64)}` as Hash;
let allowanceValue = 0n;
let allowanceGate: Gate<void> | null = null;
let receiptGate: Gate<void> | null = null;
let receiptRequested: (() => void) | null = null;
let allowanceRequested: (() => void) | null = null;
let receiptReads = 0;
const mockBlockHash = `0x${"b".repeat(64)}`;
const rpcServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 18545,
  async fetch(request) {
    const rpc = await request.json() as { id: number; method: string; params?: unknown[] };
    let result: unknown = null;
    if (rpc.method === "eth_chainId") result = "0x7a0";
    else if (rpc.method === "eth_getCode") result = "0x01";
    else if (rpc.method === "eth_call") {
      const call = rpc.params?.[0] as { data: string };
      if (call.data.startsWith("0xfc0c546a")) result = `0x${"0".repeat(24)}${"4".repeat(40)}`;
      else if (call.data.startsWith("0x313ce567")) result = `0x${"0".repeat(63)}6`;
      else {
      allowanceRequested?.();
      if (allowanceGate) await allowanceGate.promise;
      result = `0x${allowanceValue.toString(16).padStart(64, "0")}`;
      }
    } else if (rpc.method === "eth_getTransactionReceipt") {
      receiptReads += 1;
      receiptRequested?.();
      if (receiptGate) await receiptGate.promise;
      result = {
        transactionHash,
        transactionIndex: "0x0",
        blockHash: mockBlockHash,
        blockNumber: "0x1",
        from: wallet,
        to,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: [],
        logsBloom: `0x${"0".repeat(512)}`,
        status: "0x1",
        effectiveGasPrice: "0x1",
        type: "0x0",
      };
    } else if (rpc.method === "eth_blockNumber") {
      result = "0x1";
    } else if (rpc.method === "eth_getBlockByHash" || rpc.method === "eth_getBlockByNumber") {
      result = {
        hash: mockBlockHash,
        parentHash: `0x${"0".repeat(64)}`,
        number: "0x1",
        timestamp: "0x1",
        nonce: `0x${"0".repeat(16)}`,
        sha3Uncles: `0x${"0".repeat(64)}`,
        logsBloom: `0x${"0".repeat(512)}`,
        transactionsRoot: `0x${"0".repeat(64)}`,
        stateRoot: `0x${"0".repeat(64)}`,
        receiptsRoot: `0x${"0".repeat(64)}`,
        miner: to,
        difficulty: "0x0",
        totalDifficulty: "0x0",
        extraData: "0x",
        size: "0x1",
        gasLimit: "0x100000",
        gasUsed: "0x5208",
        transactions: [],
        uncles: [],
        baseFeePerGas: "0x1",
      };
    }
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  },
});
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

afterEach(() => {
  allowanceGate?.resolve();
  receiptGate?.resolve();
  setReownWalletProvider(null);
  allowanceValue = 0n;
  allowanceGate = null;
  receiptGate = null;
  receiptRequested = null;
  allowanceRequested = null;
  receiptReads = 0;
});
afterAll(() => rpcServer.stop(true));

function successReceipt(transactionHash: Hash = originalHash) {
  return { transactionHash, status: "success" as const };
}

function testProvider(
  accounts: () => Promise<unknown> | unknown = () => [wallet],
  chain: () => Promise<unknown> | unknown = () => "0x7a0",
  signRequests: string[] = [],
) {
  return {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return accounts();
      if (method === "eth_chainId") return chain();
      if (method === "eth_sendTransaction") {
        signRequests.push(method);
        return transactionHash;
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice") return "0x1";
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected wallet request: ${method}`);
    },
  };
}

function validCreateInput() {
  return {
    capability: "vendor-kyb-api",
    specification: "Verify a business.",
    maxPrice: "0.02",
    expectedCalls: "1000",
    deadlineDays: "14",
    commitment: "20",
  };
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
    await expect(verifyTransaction("demand", originalHash, intent, wallet, 1952, "0x3333333333333333333333333333333333333333")).rejects.toThrow("WALLET_CHANGED");
    expect(requested).toEqual(["eth_accounts"]);
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
    await expect(verifyTransaction("demand", originalHash, intent, wallet, 1952, "0x3333333333333333333333333333333333333333")).rejects.toThrow("CHAIN_WRONG_NETWORK");
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
    })).rejects.toMatchObject({ state: "unknown", message: "The existing transaction could not be matched to the original wallet and action" });
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

  test("rejects a deferred account read when its provider session changes before signing", async () => {
    const accountRead = deferred<unknown>();
    const accountRequestStarted = deferred<void>();
    const reads: string[] = [];
    const signingRequests: string[] = [];
    const providerA = {
      request: async ({ method }: { method: string }) => {
        reads.push(method);
        if (method === "eth_accounts") { accountRequestStarted.resolve(); return accountRead.promise; }
        if (method === "eth_chainId") return "0x7a0";
        if (method === "eth_sendTransaction") { signingRequests.push(method); return transactionHash; }
        return null;
      },
    };
    setReownWalletProvider(providerA);
    const session = captureWalletSession(wallet);
    const pending = createDemand(validCreateInput(), undefined, session ?? undefined);
    await accountRequestStarted.promise;
    setReownWalletProvider(testProvider());
    accountRead.resolve([wallet]);

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(reads).toEqual(["eth_accounts"]);
    expect(signingRequests).toEqual([]);
  });

  test("rejects a deferred chain read after the provider session changes", async () => {
    const chainRead = deferred<unknown>();
    const chainRequestStarted = deferred<void>();
    const reads: string[] = [];
    const signingRequests: string[] = [];
    const providerA = {
      request: async ({ method }: { method: string }) => {
        reads.push(method);
        if (method === "eth_accounts") return [wallet];
        if (method === "eth_chainId") { chainRequestStarted.resolve(); return chainRead.promise; }
        if (method === "eth_sendTransaction") { signingRequests.push(method); return transactionHash; }
        return null;
      },
    };
    setReownWalletProvider(providerA);
    const session = captureWalletSession(wallet);
    const pending = createDemand(validCreateInput(), undefined, session ?? undefined);
    await chainRequestStarted.promise;
    setReownWalletProvider(testProvider());
    chainRead.resolve("0x7a0");

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(reads).toEqual(["eth_accounts", "eth_accounts", "eth_chainId"]);
    expect(signingRequests).toEqual([]);
  });

  test("does not sign after the allowance read resolves for a replaced provider", async () => {
    const allowanceRead = deferred<void>();
    const signingRequests: string[] = [];
    allowanceGate = deferred<void>();
    allowanceRequested = () => allowanceRead.resolve();
    const providerA = testProvider(() => [wallet], () => "0x7a0", signingRequests);
    setReownWalletProvider(providerA);
    const session = captureWalletSession(wallet);
    const pending = supportDemand(1n, "1", "1", undefined, session ?? undefined);
    await allowanceRead.promise;
    setReownWalletProvider(testProvider());
    allowanceGate.resolve();

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(signingRequests).toEqual([]);
  });

  test("does not sign after the allowance read when the same wallet changes chain", async () => {
    const allowanceRead = deferred<void>();
    const signingRequests: string[] = [];
    let chainId = "0x7a0";
    allowanceRequested = () => allowanceRead.resolve();
    allowanceGate = deferred<void>();
    const provider = testProvider(() => [wallet], () => chainId, signingRequests);
    setReownWalletProvider(provider);
    const session = captureWalletSession(wallet);
    const pending = supportDemand(1n, "1", "1", undefined, session ?? undefined);
    await allowanceRead.promise;
    chainId = "0x1";
    allowanceGate.resolve();

    await expect(pending).rejects.toThrow("CHAIN_WRONG_NETWORK");
    expect(signingRequests).toEqual([]);
  });

  test.each(["switch", "disconnect"])("invalidates an old session after same-provider A to %s to A", async (transition) => {
    const allowanceRead = deferred<void>();
    const signingRequests: string[] = [];
    allowanceRequested = () => allowanceRead.resolve();
    allowanceGate = deferred<void>();
    const provider = testProvider(() => [wallet], () => "0x7a0", signingRequests);
    setReownWalletProvider(provider, wallet);
    const pending = supportDemand(1n, "1", "1");
    await allowanceRead.promise;
    if (transition === "disconnect") setReownWalletProvider(null);
    else setReownWalletProvider(provider, otherWallet);
    setReownWalletProvider(provider, wallet);
    allowanceGate.resolve();

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(signingRequests).toEqual([]);
  });

  test("checks the session again after a reset approval receipt before sending the amount approval", async () => {
    allowanceValue = 1n;
    const allowanceRead = deferred<void>();
    const receiptRead = deferred<void>();
    const signingRequests: string[] = [];
    const updates: Array<{ stage: string; state: string }> = [];
    allowanceRequested = () => allowanceRead.resolve();
    receiptRequested = () => receiptRead.resolve();
    receiptGate = deferred<void>();
    const providerA = testProvider(() => [wallet], () => "0x7a0", signingRequests);
    setReownWalletProvider(providerA);
    const session = captureWalletSession(wallet);
    const pending = supportDemand(1n, "1", "1", ({ stage, state }) => updates.push({ stage, state }), session ?? undefined);
    await allowanceRead.promise;
    await receiptRead.promise;
    setReownWalletProvider(testProvider());
    receiptGate.resolve();

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(signingRequests).toEqual(["eth_sendTransaction"]);
    expect(updates).toEqual([
      { stage: "approval", state: "broadcast" },
      { stage: "approval", state: "confirmed" },
    ]);
  });

  test("continues monitoring and records an already-broadcast transaction after wallet changes", async () => {
    const signingRequests: string[] = [];
    const updates: Array<{ state: string; hash: Hash }> = [];
    const providerB = testProvider(() => [otherWallet]);
    const providerA = testProvider(() => [wallet], () => "0x7a0", signingRequests);
    setReownWalletProvider(providerA);
    const session = captureWalletSession(wallet);
    const result = await approveService(1n, ({ state, hash }) => {
      updates.push({ state, hash });
      if (state === "broadcast") setReownWalletProvider(providerB);
    }, session ?? undefined);

    expect(result).toBe(transactionHash);
    expect(signingRequests).toEqual(["eth_sendTransaction"]);
    expect(receiptReads).toBeGreaterThan(0);
    expect(updates).toEqual([
      { state: "broadcast", hash: transactionHash },
      { state: "confirmed", hash: transactionHash },
    ]);
  });

  test("does not sign if the session changes during viem's final chain check", async () => {
    const chainRead = deferred<unknown>();
    const chainStarted = deferred<void>();
    const signingRequests: string[] = [];
    let chainReads = 0;
    const provider = testProvider(() => [wallet], () => {
      if (++chainReads === 4) { chainStarted.resolve(); return chainRead.promise; }
      return "0x7a0";
    }, signingRequests);
    setReownWalletProvider(provider);
    const pending = approveService(1n);
    await chainStarted.promise;
    setReownWalletProvider(testProvider(() => [otherWallet]));
    chainRead.resolve("0x7a0");
    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(signingRequests).toEqual([]);
  });

  test("uses the same session for a successful approval and support action", async () => {
    const signingRequests: string[] = [];
    const updates: Array<{ stage: string; state: string }> = [];
    setReownWalletProvider(testProvider(() => [wallet], () => "0x7a0", signingRequests));
    const session = captureWalletSession(wallet);
    const result = await supportDemand(1n, "1", "1", ({ stage, state }) => updates.push({ stage, state }), session ?? undefined);

    expect(result).toBe(transactionHash);
    expect(signingRequests).toEqual(["eth_sendTransaction", "eth_sendTransaction"]);
    expect(updates).toEqual([
      { stage: "approval", state: "broadcast" },
      { stage: "approval", state: "confirmed" },
      { stage: "action", state: "broadcast" },
      { stage: "action", state: "confirmed" },
    ]);
  });

  test("does not use viem's alternate send method after the originating session changes", async () => {
    const signingRequests: string[] = [];
    const fallbackStarted = deferred<void>();
    const fallbackGate = deferred<void>();
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return [wallet];
        if (method === "eth_chainId") return "0x7a0";
        if (method === "eth_sendTransaction") {
          signingRequests.push(method);
          fallbackStarted.resolve();
          await fallbackGate.promise;
          throw Object.assign(new Error("Unsupported method"), { code: -32601 });
        }
        if (method === "wallet_sendTransaction") { signingRequests.push(method); return transactionHash; }
        return null;
      },
    };
    setReownWalletProvider(provider, wallet);
    const pending = approveService(1n);
    await fallbackStarted.promise;
    setReownWalletProvider(testProvider(), otherWallet);
    fallbackGate.resolve();

    await expect(pending).rejects.toThrow("WALLET_CHANGED");
    expect(signingRequests).toEqual(["eth_sendTransaction"]);
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
    contract: "0x3333333333333333333333333333333333333333",
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
    expect(findPendingTransaction(restored.records, wallet, 1952, pending.contract, "support:1")?.hash).toBe(originalHash);
    expect(findPendingTransaction(restored.records, otherWallet, 1952, pending.contract, "support:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 196, pending.contract, "support:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 1952, "0x5555555555555555555555555555555555555555", "support:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 1952, pending.contract, "refund:1")).toBeNull();
    expect(findPendingTransaction(restored.records, wallet, 1952, pending.contract, "support:2")).toBeNull();
    const otherContract = { ...pending, contract: "0x5555555555555555555555555555555555555555" as const };
    expect(storePendingTransaction(storage, otherContract)).toBe(true);
    expect(readPendingTransactions(storage).records).toHaveLength(2);
  });

  test("removes a resolved record so the same action can be submitted again", () => {
    const storage = new MemoryTransactionStorage();
    storePendingTransaction(storage, pending);

    expect(removePendingTransaction(storage, pending)).toBe(true);
    const restored = readPendingTransactions(storage);
    expect(restored.records).toEqual([]);
    expect(findPendingTransaction(restored.records, wallet, 1952, pending.contract, "support:1")).toBeNull();
  });

  test("rejects recovery of approval to a different escrow spender", async () => {
    setReownWalletProvider(testProvider(), wallet);
    const badIntent = { to: "0x4444444444444444444444444444444444444444" as Address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: ["0x5555555555555555555555555555555555555555", 1n] }), value: 0n };
    await expect(verifyTransaction("approval", originalHash, badIntent, wallet, 1952, pending.contract)).rejects.toThrow("TRANSACTION_INTENT_MISMATCH");
    expect(receiptReads).toBe(0);
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

  test("preserves ambiguous v1 records without assigning a contract", () => {
    const storage = new MemoryTransactionStorage();
    const key = `unmet.pending-transaction.v1:1952:${wallet}:support:1`;
    const raw = JSON.stringify({ version: 1, wallet, chainId: 1952, actionId: "support:1" });
    storage.setItem(key, raw);
    const result = readPendingTransactions(storage);
    expect(result.invalidRecords).toBe(1);
    expect(result.records).toEqual([]);
    expect(storage.getItem(key)).toBe(raw);
  });

  test("reports unavailable storage without throwing", () => {
    expect(readPendingTransactions(null)).toEqual({ available: false, invalidRecords: 0, records: [] });
  });

  test("preserves a legacy create record without guessing its deployment", () => {
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

    expect(readPendingTransactions(storage).records).toEqual([]);
  });
});

describe("transaction error classification regression coverage", () => {
  test("preserves lifecycle state and transaction scope for approval and action failures", () => {
    for (const stage of ["approval", "action"] as const) {
      for (const state of ["reverted", "cancelled", "unknown"] as const) {
        const error = new TransactionLifecycleError(
          stage,
          state,
          replacementHash,
          intent,
          wallet,
          1952,
          "Receipt status could not be verified.",
        );

        expect(transactionFailureOutcome(error, "support:1")).toEqual({
          kind: state,
          stage,
          hash: replacementHash,
          intent,
          wallet,
          chainId: 1952,
          actionId: "support:1",
          message: "Receipt status could not be verified.",
        });
      }
    }
  });

  test("keeps the action id attached to every non-create action failure", () => {
    const error = new TransactionLifecycleError(
      "action",
      "unknown",
      originalHash,
      intent,
      wallet,
      1952,
      "RPC timed out after broadcast.",
    );

    for (const actionId of ["support:1", "refund:1", "submit:1", "approve:1", "reject:1", "finalize:1", "reopen:1"]) {
      expect(transactionFailureOutcome(error, actionId)).toMatchObject({ kind: "unknown", actionId });
    }
  });

  test("preserves useful RPC, application, and fallback error messages", () => {
    expect(errorMessage({ shortMessage: "RPC request failed", message: "underlying RPC rejection" })).toBe("RPC request failed");
    expect(errorMessage("RPC offline")).toBe("RPC offline");
    expect(errorMessage({ shortMessage: "  ", message: "RPC rejected" })).toBe("RPC rejected");
    expect(errorMessage(new Error("WALLET_NOT_CONNECTED"))).toBe("WALLET_NOT_CONNECTED");
    expect(errorMessage(new Error("DEMAND_INVALID_CAPABILITY"))).toBe("Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max)");
    expect(errorMessage({ code: -1 })).toBe("INTERNAL_ERROR (-1)");
    expect(errorMessage(null)).toBe("INTERNAL_ERROR");
  });
});
