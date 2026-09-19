import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import type { Network, PaymentPayload, PaymentRequired } from "@okxweb3/x402-core/types";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { concat, createPublicClient, decodeFunctionData, erc20Abi, http, parseAbiItem, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MOCK_URL = "https://www.okx.com/api/v1/pay/mock-merchant/resource";
const EXPECTED_NETWORK = "eip155:1952";
const EXPECTED_PAY_TO = "0x3509655ad99effc7f3f74205482b1cb337ca08f7";

type RawAccept = {
  scheme: string;
  network: string;
  maxAmountRequired?: string;
  amount?: string;
  asset: string;
  payTo: string;
  resource?: string;
  mimeType?: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

type RawChallenge = {
  x402Version: number;
  error?: string;
  accepts: RawAccept[];
};

const domainVersionAbi = [
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const authorizationStateAbi = [
  { type: "function", name: "authorizationState", stateMutability: "view", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

const eip3009TransferAbi = [{
  type: "function",
  name: "transferWithAuthorization",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" },
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
  ],
  outputs: [],
}] as const;

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseNetwork(value: string): Network {
  if (!/^[^:]+:[^:]+$/.test(value)) throw new Error("Mock Merchant returned an invalid CAIP-2 network");
  return value as Network;
}

function normalize(raw: RawChallenge): PaymentRequired {
  const exactAccepts = raw.accepts
    .filter((accept) => accept.scheme === "exact")
    .map((accept) => ({
      scheme: accept.scheme,
      network: parseNetwork(accept.network),
      amount: accept.amount ?? accept.maxAmountRequired ?? "",
      asset: accept.asset,
      payTo: accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra: accept.extra ?? {},
    }));
  const resourcePath = raw.accepts.find((accept) => accept.resource)?.resource;
  const mimeType = raw.accepts.find((accept) => accept.mimeType)?.mimeType;
  if (raw.x402Version !== 2 || !resourcePath || exactAccepts.length === 0) {
    throw new Error("Mock Merchant response is not the expected legacy-shaped x402 v2 challenge");
  }
  return {
    x402Version: 2,
    error: raw.error,
    resource: { url: resourcePath, ...(mimeType ? { mimeType } : {}) },
    accepts: exactAccepts,
  };
}

function readTransactionHash(responseBody: unknown, settlement: unknown): Hex | undefined {
  const settlementRecord = record(settlement);
  const bodyRecord = record(responseBody);
  const paymentRecord = record(bodyRecord?.payment);
  const rawHash = settlementRecord?.transaction ?? paymentRecord?.txHash;
  return typeof rawHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(rawHash)
    ? rawHash as Hex
    : undefined;
}

async function replaySettledAuthorization(txHash: Hex): Promise<void> {
  if (process.env.CHAIN_ID !== "1952") throw new Error("CHAIN_ID must be exactly 1952");
  const rpcUrl = process.env.XLAYER_RPC_URL || "https://testrpc.xlayer.tech/terigon";
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== 1952) throw new Error(`RPC chain ID is ${chainId}, expected 1952`);

  const rawResponse = await fetch(MOCK_URL, { method: "GET" });
  if (rawResponse.status !== 402) throw new Error(`Expected Mock Merchant HTTP 402, received ${rawResponse.status}`);
  const challenge = normalize(JSON.parse(await rawResponse.text()) as RawChallenge);
  const exact = challenge.accepts[0];
  const asset = exact.asset as Address;
  const payTo = exact.payTo as Address;
  const amount = BigInt(exact.amount);
  if (exact.network !== EXPECTED_NETWORK || payTo.toLowerCase() !== EXPECTED_PAY_TO) {
    throw new Error("Mock Merchant network or recipient changed; refusing settled-proof replay");
  }
  if (amount <= 0n) throw new Error("Challenge amount must be positive");

  const [receipt, transaction, tokenVersion, decimals] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: txHash }),
    publicClient.getTransaction({ hash: txHash }),
    publicClient.readContract({ address: asset, abi: domainVersionAbi, functionName: "version" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (BigInt(decimals) < 2n || amount > (10n ** BigInt(decimals)) / 100n) {
    throw new Error("Challenge exceeds the 0.01 token test cap after reading token decimals");
  }
  if (receipt.status !== "success" || transaction.to?.toLowerCase() !== asset.toLowerCase()) {
    throw new Error("Supplied transaction is not a successful settlement to the challenged token");
  }
  const decoded = decodeFunctionData({ abi: eip3009TransferAbi, data: transaction.input });
  if (decoded.functionName !== "transferWithAuthorization") throw new Error("Settlement calldata is not EIP-3009");
  const [from, to, value, validAfter, validBefore, nonce, v, r, s] = decoded.args;
  if (to.toLowerCase() !== payTo.toLowerCase() || value !== amount) {
    throw new Error("Settled authorization does not match the current Mock Merchant amount and recipient");
  }
  const alreadyUsed = await publicClient.readContract({
    address: asset,
    abi: authorizationStateAbi,
    functionName: "authorizationState",
    args: [from, nonce],
  });
  if (!alreadyUsed) throw new Error("EIP-3009 authorization is not marked used on chain; refusing replay");

  const accepted = { ...exact, extra: { ...exact.extra, version: tokenVersion } };
  const payment: PaymentPayload = {
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: {
      authorization: {
        from,
        to,
        value: value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature: concat([r, s, toHex(v, { size: 1 })]),
    },
  };
  const httpClient = new x402HTTPClient(new x402Client());
  const blockBefore = await publicClient.getBlockNumber();
  const payerBefore = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [from] });
  const payToBefore = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] });
  const signedHeaders = httpClient.encodePaymentSignatureHeader(payment);
  const replay = await fetch(MOCK_URL, { method: "GET", headers: signedHeaders });
  const responseText = await replay.text();
  let body: unknown = responseText;
  try {
    body = JSON.parse(responseText) as unknown;
  } catch {
    // Keep non-JSON responses readable.
  }
  const replayLogs = await publicClient.getLogs({
    address: asset,
    event: transferEvent,
    args: { from, to: payTo },
    fromBlock: blockBefore,
    toBlock: "latest",
  });
  const [payerAfter, payToAfter] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [from] }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] }),
  ]);
  console.log(JSON.stringify({
    stage: "replay-already-settled-authorization",
    originalTransactionHash: txHash,
    originalReceiptStatus: receipt.status,
    originalReceiptBlock: String(receipt.blockNumber),
    authorizationUsed: alreadyUsed,
    requestHeaderNames: Object.keys(signedHeaders),
    encodedPaymentHeaderLength: signedHeaders["PAYMENT-SIGNATURE"]?.length ?? null,
    responseStatus: replay.status,
    responseHeaders: Object.fromEntries(["date", "content-type", "content-length", "x-brokerid", "cf-cache-status", "cf-ray", "server", "payment-response"]
      .map((name) => [name, replay.headers.get(name)])),
    body,
    newMatchingTransfers: replayLogs.filter((log) => log.args.value === amount).length,
    payerDeltaRaw: String(payerAfter - payerBefore),
    payToDeltaRaw: String(payToAfter - payToBefore),
  }));
}

async function main(): Promise<void> {
  if (process.env.CHAIN_ID !== "1952") throw new Error("CHAIN_ID must be exactly 1952");
  const rpcUrl = process.env.XLAYER_RPC_URL || "https://testrpc.xlayer.tech/terigon";
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== 1952) throw new Error(`RPC chain ID is ${chainId}, expected 1952`);

  const account = privateKeyToAccount(requiredEnv("DEPLOYER_PRIVATE_KEY") as Hex);
  const rawResponse = await fetch(MOCK_URL, { method: "GET" });
  const rawBody = await rawResponse.text();
  if (rawResponse.status !== 402) {
    console.log(JSON.stringify({ stage: "challenge", status: rawResponse.status, body: rawBody }));
    return;
  }

  const challenge = normalize(JSON.parse(rawBody) as RawChallenge);
  const exact = challenge.accepts[0];
  const asset = exact.asset as Address;
  const payTo = exact.payTo as Address;
  const amount = BigInt(exact.amount);
  if (exact.network !== EXPECTED_NETWORK) throw new Error(`Unexpected challenge network: ${exact.network}`);
  if (payTo.toLowerCase() !== EXPECTED_PAY_TO) throw new Error("Mock Merchant payTo changed; refusing to sign");
  if (amount <= 0n) throw new Error("Challenge amount must be positive");

  const [chainCode, tokenName, tokenSymbol, decimals, tokenVersion, payerBalance, payToBalance, nativeBalance] = await Promise.all([
    publicClient.getBytecode({ address: asset }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: asset, abi: domainVersionAbi, functionName: "version" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] }),
    publicClient.getBalance({ address: account.address }),
  ]);
  if (!chainCode || chainCode === "0x") throw new Error("Challenge token has no contract bytecode on X Layer Testnet");
  if (BigInt(decimals) < 2n || amount > (10n ** BigInt(decimals)) / 100n) {
    throw new Error("Challenge exceeds the 0.01 token cap after reading token decimals");
  }
  if (typeof exact.extra?.name !== "string" || exact.extra.name !== tokenName) {
    throw new Error("Challenge EIP-712 name does not match the on-chain token name");
  }
  if (payerBalance < amount) throw new Error("The configured testnet payer lacks the challenged token amount");
  if (nativeBalance === 0n) throw new Error("The configured testnet payer has no native gas balance");

  const facilitator = new OKXFacilitatorClient({
    apiKey: requiredEnv("OKX_API_KEY"),
    secretKey: requiredEnv("OKX_SECRET_KEY"),
    passphrase: requiredEnv("OKX_PASSPHRASE"),
    syncSettle: true,
  });
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account, networks: [EXPECTED_NETWORK] });
  const httpClient = new x402HTTPClient(client);

  const challengePayload = await httpClient.createPaymentPayload(challenge);
  const challengeVerification = await facilitator.verify(challengePayload, challengePayload.accepted);
  console.log(JSON.stringify({
    stage: "faithful-challenge-verification",
    chainId,
    scheme: exact.scheme,
    network: exact.network,
    asset,
    tokenName,
    tokenSymbol,
    decimals,
    challengeVersion: exact.extra?.version,
    onChainVersion: tokenVersion,
    amountRaw: exact.amount,
    payerBalanceRaw: String(payerBalance),
    nativeBalanceWei: String(nativeBalance),
    payToBalanceRaw: String(payToBalance),
    verification: challengeVerification,
  }));

  let selectedPayload: PaymentPayload = challengePayload;
  if (!challengeVerification.isValid) {
    const correctedChallenge: PaymentRequired = {
      ...challenge,
      accepts: [{
        ...exact,
        extra: { ...exact.extra, version: tokenVersion },
      }],
    };
    const correctedPayload = await httpClient.createPaymentPayload(correctedChallenge);
    const correctedVerification = await facilitator.verify(correctedPayload, correctedPayload.accepted);
    console.log(JSON.stringify({
      stage: "on-chain-domain-corrected-verification",
      challengeVersion: exact.extra?.version,
      onChainVersion: tokenVersion,
      payerBalanceRaw: String(payerBalance),
      payToBalanceRaw: String(payToBalance),
      verification: correctedVerification,
    }));
    if (!correctedVerification.isValid) return;
    selectedPayload = correctedPayload;
  }

  const blockBefore = await publicClient.getBlockNumber();
  const balanceBefore = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const recipientBefore = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] });
  const signedHeaders = httpClient.encodePaymentSignatureHeader(selectedPayload);
  const replay = await fetch(MOCK_URL, { method: "GET", headers: signedHeaders });
  const replayBodyText = await replay.text();
  let replayBody: unknown = replayBodyText;
  try {
    replayBody = JSON.parse(replayBodyText) as unknown;
  } catch {
    // Keep non-JSON seller responses intact for diagnosis.
  }

  let settlement: unknown;
  const settlementHeader = replay.headers.get("PAYMENT-RESPONSE");
  if (settlementHeader) {
    try {
      settlement = httpClient.getPaymentSettleResponse((name) =>
        name.toLowerCase() === "payment-response" ? settlementHeader : null);
    } catch {
      settlement = { decodeError: true };
    }
  }
  let txHash = readTransactionHash(replayBody, settlement);
  if (!txHash) {
    const transferLogs = await publicClient.getLogs({
      address: asset,
      event: transferEvent,
      args: { from: account.address, to: payTo },
      fromBlock: blockBefore,
      toBlock: "latest",
    });
    const paymentLogs = transferLogs.filter((log) => log.args.value === amount);
    if (paymentLogs.length === 1) txHash = paymentLogs[0].transactionHash;
  }
  console.log(JSON.stringify({
    stage: "mock-replay",
    requestUrl: replay.url,
    requestHeaderNames: Object.keys(signedHeaders),
    encodedPaymentHeaderLength: signedHeaders["PAYMENT-SIGNATURE"]?.length ?? null,
    status: replay.status,
    responseHeaders: Object.fromEntries(["date", "content-type", "content-length", "x-brokerid", "cf-cache-status", "cf-ray", "server", "payment-response"]
      .map((name) => [name, replay.headers.get(name)])),
    body: replayBody,
    settlement,
    transactionHash: txHash ?? null,
  }));

  if (txHash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    const [payerAfter, recipientAfter] = await Promise.all([
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] }),
    ]);
    console.log(JSON.stringify({
      stage: "receipt-and-readback",
      status: receipt.status,
      blockNumber: String(receipt.blockNumber),
      transactionHash: receipt.transactionHash,
      payerDeltaRaw: String(payerAfter - balanceBefore),
      payToDeltaRaw: String(recipientAfter - recipientBefore),
      expectedAmountRaw: exact.amount,
      scanFromBlock: String(blockBefore),
    }));
    if (receipt.status !== "success") throw new Error("Payment transaction receipt was not successful");
  } else {
    const [payerAfter, recipientAfter] = await Promise.all([
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo] }),
    ]);
    console.log(JSON.stringify({
      stage: "no-settlement-hash-found",
      payerDeltaRaw: String(payerAfter - balanceBefore),
      payToDeltaRaw: String(recipientAfter - recipientBefore),
      scanFromBlock: String(blockBefore),
    }));
    if (process.argv.includes("--settle-facilitator")) {
      if (payerAfter !== balanceBefore || recipientAfter !== recipientBefore) {
        throw new Error("Balances changed during Mock replay; refusing another settlement attempt");
      }
      const directSettlement = await facilitator.settle(selectedPayload, selectedPayload.accepted);
      const directTxHash = /^0x[0-9a-fA-F]{64}$/.test(directSettlement.transaction)
        ? directSettlement.transaction as Hex
        : undefined;
      console.log(JSON.stringify({
        stage: "official-facilitator-settle",
        success: directSettlement.success,
        status: directSettlement.status,
        errorReason: directSettlement.errorReason,
        errorMessage: directSettlement.errorMessage,
        network: directSettlement.network,
        amount: directSettlement.amount,
        transactionHash: directTxHash ?? null,
      }));
      if (!directTxHash) return;
      const receipt = await publicClient.waitForTransactionReceipt({ hash: directTxHash, timeout: 120_000 });
      const [payerBeforeAtBlock, recipientBeforeAtBlock, payerSettledAtReceipt, recipientSettledAtReceipt] = await Promise.all([
        publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address], blockNumber: blockBefore }),
        publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo], blockNumber: blockBefore }),
        publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address], blockNumber: receipt.blockNumber }),
        publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [payTo], blockNumber: receipt.blockNumber }),
      ]);
      const settlementTransfers = await publicClient.getLogs({
        address: asset,
        event: transferEvent,
        args: { from: account.address, to: payTo },
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      const matchingSettlementTransfers = settlementTransfers.filter((log) => log.args.value === amount).length;
      let brokerStatus = await facilitator.getSettleStatus(directTxHash);
      for (let attempt = 0; attempt < 10 && brokerStatus.status === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        brokerStatus = await facilitator.getSettleStatus(directTxHash);
      }
      console.log(JSON.stringify({
        stage: "facilitator-receipt-and-readback",
        receiptStatus: receipt.status,
        blockNumber: String(receipt.blockNumber),
        transactionHash: receipt.transactionHash,
        brokerStatus,
        payerBeforeAtBlock: String(payerBeforeAtBlock),
        payerAtReceiptBlock: String(payerSettledAtReceipt),
        payerDeltaRaw: String(payerSettledAtReceipt - payerBeforeAtBlock),
        payToBeforeAtBlock: String(recipientBeforeAtBlock),
        payToAtReceiptBlock: String(recipientSettledAtReceipt),
        payToDeltaRaw: String(recipientSettledAtReceipt - recipientBeforeAtBlock),
        matchingSettlementTransfers,
        expectedAmountRaw: exact.amount,
      }));
      if (receipt.status !== "success") throw new Error("Facilitator-settled payment receipt was not successful");
      if (payerSettledAtReceipt - payerBeforeAtBlock !== -amount
        || recipientSettledAtReceipt - recipientBeforeAtBlock !== amount
        || matchingSettlementTransfers !== 1) {
        throw new Error("Receipt-block transfer logs or token balance deltas do not match the exact challenge amount");
      }
    }
  }
}

const settledReplayArg = process.argv.find((arg) => arg.startsWith("--replay-settled="));
if (settledReplayArg) {
  const hash = settledReplayArg.slice("--replay-settled=".length);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("--replay-settled requires a transaction hash");
  await replaySettledAuthorization(hash as Hex);
} else {
  await main();
}
