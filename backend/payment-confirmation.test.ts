import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { encodeFunctionData, keccak256, toBytes, type PublicClient } from "viem";
import { eip3009ABI } from "@okxweb3/x402-evm";
import { MAINNET_ASSETS } from "./payment-identity.ts";
import { confirmPayment } from "./payment-confirmation.ts";
import { reconcilePayments } from "./durable-payment.ts";
import { PaymentStore } from "./payment-store.ts";
import { fingerprint } from "./payment-identity.ts";
import type { PaymentRecord } from "./payment-store.ts";

const asset = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;
const payer = "0x2222222222222222222222222222222222222222" as const;
const recipient = "0x1111111111111111111111111111111111111111" as const;
const nonce = `0x${"a".repeat(64)}` as const;
const hash = `0x${"b".repeat(64)}` as const;
const blockHash = `0x${"c".repeat(64)}` as const;
const transferTopic = keccak256(toBytes("Transfer(address,address,uint256)"));
const usedTopic = keccak256(toBytes("AuthorizationUsed(address,bytes32)"));

function proof(overrides: { timestamp?: bigint; status?: "success" | "reverted"; asset?: string; payer?: string; recipient?: string;
  amount?: bigint; nonce?: string; validBefore?: bigint; bytesSignature?: boolean } = {}) {
  const from = (overrides.payer || payer) as typeof payer, to = (overrides.recipient || recipient) as typeof recipient;
  const value = overrides.amount ?? 10000n, expires = overrides.validBefore ?? 1500000000n, authNonce = (overrides.nonce || nonce) as typeof nonce;
  const txInput = overrides.bytesSignature ? encodeFunctionData({ abi: eip3009ABI, functionName: "transferWithAuthorization",
    args: [from, to, value, 1n, expires, authNonce, "0x1234"] }) : encodeFunctionData({ abi: eip3009ABI,
    functionName: "transferWithAuthorization", args: [from, to, value, 1n, expires, authNonce, 27, `0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`] });
  const token = (overrides.asset || asset).toLowerCase();
  const logs = [
    { address: token, topics: [usedTopic, `0x${"0".repeat(24)}${from.slice(2)}`, authNonce], data: "0x", blockHash, blockNumber: 100n, transactionHash: hash, transactionIndex: 0, logIndex: 0, removed: false },
    { address: token, topics: [transferTopic, `0x${"0".repeat(24)}${from.slice(2)}`, `0x${"0".repeat(24)}${to.slice(2)}`],
      data: `0x${value.toString(16).padStart(64, "0")}`, blockHash, blockNumber: 100n, transactionHash: hash, transactionIndex: 0, logIndex: 1, removed: false },
  ];
  const tx = { hash, type: "eip1559" as const, chainId: 196, to: token, input: txInput, from: recipient, nonce: 4, blockNumber: 100n, blockHash, transactionIndex: 0 };
  const receipt = { transactionHash: hash, status: overrides.status || "success", blockNumber: 100n, blockHash, transactionIndex: 0, to: token as string, from: recipient as string, logs };
  const block = { number: 100n, hash: blockHash, timestamp: overrides.timestamp ?? 1000n, transactions: [hash] };
  const client = { getChainId: async () => 196, getTransaction: async () => tx,
    getTransactionReceipt: async () => receipt, getBlock: async () => block } as unknown as PublicClient;
  const paymentAsset = MAINNET_ASSETS.some((entry) => entry.asset === token) ? token : asset;
  const record = { id: "row", state: "UNKNOWN", txHash: hash, payment: fingerprint({ network: "eip155:196", asset: paymentAsset,
    from: payer.toLowerCase(), nonce }), network: "eip155:196", recipient,
    amount: "10000", payer: payer.toLowerCase(), validBefore: 1500000000000,
    binding: "a".repeat(64), logicalKey: null, created: 0, updated: 0, error: null } as PaymentRecord;
  return { client, record, tx, receipt, block };
}

test("confirms direct native EIP-3009 inclusion and permits expired-now historical authorization", async () => {
  const { client, record } = proof();
  expect(await confirmPayment(record, client)).toBe(true);
  for (const { asset: token } of MAINNET_ASSETS) {
    for (const bytesSignature of [false, true]) {
      const supported = proof({ asset: token, bytesSignature });
      expect(await confirmPayment(supported.record, supported.client)).toBe(true);
    }
  }
});

test("historical proof uses the stored record when current price and recipient config changes", async () => {
  const { client, record } = proof();
  const priorPrice = process.env.OPPORTUNITY_PRICE, priorRecipient = process.env.OKX_PAY_TO;
  process.env.OPPORTUNITY_PRICE = "9.99";
  process.env.OKX_PAY_TO = "0x3333333333333333333333333333333333333333";
  try { expect(await confirmPayment(record, client)).toBe(true); }
  finally {
    if (priorPrice === undefined) delete process.env.OPPORTUNITY_PRICE; else process.env.OPPORTUNITY_PRICE = priorPrice;
    if (priorRecipient === undefined) delete process.env.OKX_PAY_TO; else process.env.OKX_PAY_TO = priorRecipient;
  }
});

test("reopened UNKNOWN payment reconciles from stored proof after live terms change", async () => {
  const { client, record } = proof();
  const dir = mkdtempSync(tmpdir() + "/unmet-confirmation-");
  const path = dir + "/payments.sqlite";
  const initial = new PaymentStore(path);
  const reserved = initial.reserve({ payment: record.payment, binding: record.binding, logicalKey: null,
    network: record.network, recipient: record.recipient, amount: record.amount, payer: record.payer,
    validBefore: record.validBefore });
  initial.transition(reserved.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
  initial.transition(reserved.id, "SETTLEMENT_IN_FLIGHT", "UNKNOWN", record.txHash);
  initial.close();
  const reopened = new PaymentStore(path);
  const priorPrice = process.env.OPPORTUNITY_PRICE, priorRecipient = process.env.OKX_PAY_TO;
  process.env.OPPORTUNITY_PRICE = "9.99";
  process.env.OKX_PAY_TO = "0x3333333333333333333333333333333333333333";
  try {
    const counts = await reconcilePayments(reopened, { getSettleStatus: async (txHash) => ({
      success: true, status: "success", transaction: txHash, network: "eip155:196", payer,
    }) }, 20, 30_000, (saved) => confirmPayment(saved, client));
    expect(counts.settled).toBe(1);
    expect(reopened.get(reserved.id)?.state).toBe("SETTLED");
  } finally {
    if (priorPrice === undefined) delete process.env.OPPORTUNITY_PRICE; else process.env.OPPORTUNITY_PRICE = priorPrice;
    if (priorRecipient === undefined) delete process.env.OKX_PAY_TO; else process.env.OKX_PAY_TO = priorRecipient;
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects reverted, out-of-window, mismatched identity, amount and unsupported token evidence", async () => {
  for (const fixture of [proof({ status: "reverted" }), proof({ timestamp: 1n }), proof({ timestamp: 1500000000n }),
    proof({ payer: recipient }), proof({ recipient: payer }), proof({ amount: 1n }), proof({ asset: "0x0000000000000000000000000000000000000001" })]) {
    expect(await confirmPayment(fixture.record, fixture.client)).toBe(false);
  }
});

test("rejects non-Mainnet records before querying transaction evidence", async () => {
  const { client, record } = proof();
  let calls = 0;
  const wrong = { ...client, getChainId: async () => { calls++; return 1952; } } as PublicClient;
  expect(await confirmPayment({ ...record, network: "eip155:1952" }, wrong)).toBe(false);
  expect(calls).toBe(0);
});

test("rejects missing receipt, altered tx/receipt/block references, nonce, expiry and ambiguous logs", async () => {
  const altered = [proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof(), proof()];
  altered[0].tx.chainId = 1;
  altered[1].receipt.transactionHash = `0x${"d".repeat(64)}`;
  altered[2].receipt.to = recipient;
  altered[3].receipt.transactionIndex = 1;
  altered[4].block.number = 101n;
  altered[5].block.transactions[0] = `0x${"d".repeat(64)}`;
  altered[6].receipt.logs[0].removed = true;
  altered[7].receipt.logs[1].logIndex = 0;
  altered[8].tx.blockHash = `0x${"d".repeat(64)}`;
  altered[9].receipt.logs[0].blockHash = `0x${"d".repeat(64)}`;
  altered[10].receipt.logs[0].transactionHash = `0x${"d".repeat(64)}`;
  altered[11].receipt.from = payer;
  altered[12].block.hash = `0x${"d".repeat(64)}`;
  altered[13].receipt.logs[0].transactionIndex = 1;
  const wrongNonce = proof({ nonce: `0x${"d".repeat(64)}` });
  const wrongExpiry = proof({ validBefore: 1500000001n });
  const ambiguous = proof();
  ambiguous.receipt.logs.push({ ...ambiguous.receipt.logs[1] });
  ambiguous.receipt.logs[2] = { ...ambiguous.receipt.logs[2], logIndex: 2 };
  const supportedWrongTokenCommitment = proof({ asset: MAINNET_ASSETS[1]!.asset });
  supportedWrongTokenCommitment.record.payment = proof().record.payment;
  for (const fixture of [...altered, wrongNonce, wrongExpiry, ambiguous, supportedWrongTokenCommitment]) {
    expect(await confirmPayment(fixture.record, fixture.client)).toBe(false);
  }
  const blobTransaction = proof();
  const unsupportedType = { ...blobTransaction.client, getTransaction: async () => ({ ...blobTransaction.tx, type: "eip4844" }) } as unknown as PublicClient;
  expect(await confirmPayment(blobTransaction.record, unsupportedType)).toBe(false);
  const base = proof();
  const missingTx = { ...base.client, getTransaction: async () => null } as unknown as PublicClient;
  expect(await confirmPayment(base.record, missingTx)).toBe(false);
  const missing = { ...base.client, getTransactionReceipt: async () => null } as unknown as PublicClient;
  expect(await confirmPayment(base.record, missing)).toBe(false);
  const brokenRpc = { ...base.client, getTransaction: async () => { throw new Error("rpc unavailable"); } } as unknown as PublicClient;
  await expect(confirmPayment(base.record, brokenRpc)).rejects.toThrow("rpc unavailable");
  const unsupportedCall = { ...base, tx: { ...base.tx, input: "0x12345678" } };
  const unsupportedClient = { ...base.client, getTransaction: async () => unsupportedCall.tx } as unknown as PublicClient;
  await expect(confirmPayment(base.record, unsupportedClient)).rejects.toThrow();
});
