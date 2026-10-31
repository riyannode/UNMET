import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionResult, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEMAND_ABI, ERC20_ABI, setReownWalletProvider, submitService } from "../contract";
import { attestationTypes } from "../../shared/validation-types";
import { requestHash } from "../validation";

const contract = "0x3333333333333333333333333333333333333333" as Address;
const token = "0x4444444444444444444444444444444444444444" as Address;
const builder = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
const txHash = `0x${"9".repeat(64)}` as Hex;
const blockHash = `0x${"b".repeat(64)}` as Hex;
const metadata = { method: "GET" as const, query: [] as [string, string][], contentType: null, body: null };
Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://127.0.0.1:18545" } }, configurable: true });
let resultMode = "PASS", sends = 0, signs = 0, requests = 0, nonceReads = 0;
let submittedData: Hex | undefined;
let walletChange = false, changeDuringSign = false, nonceStale = false, badReadback = false;
let walletChain = "0x7a0", changeChainBeforeBroadcast = false;
const evidenceHash = keccak256(stringToHex("evidence"));
const paymentHash = `0x${"2".repeat(64)}` as Hex, policyHash = `0x${"3".repeat(64)}` as Hex;

const server = Bun.serve({ hostname: "127.0.0.1", port: 18545, async fetch(req) {
  if (new URL(req.url).pathname === "/v1/x402/validate") {
    requests++;
    const body = await req.json() as { builderAuthorization: { issuedAt: string }; submissionNonce: string };
    if (walletChange) setReownWalletProvider(null);
    if (!["PASS", "HTTP", "BAD_BINDING", "EXPIRED", "MALFORMED"].includes(resultMode)) return Response.json({ status: resultMode, code: "TEST", message: "test", retryable: false }, { status: 400 });
    if (resultMode === "MALFORMED") return Response.json({ status: "PASS" });
    const now = BigInt(body.builderAuthorization.issuedAt);
    const issued = resultMode === "EXPIRED" ? now - 120n : now;
    const expires = resultMode === "EXPIRED" ? now - 1n : now + 120n;
    const message = { escrowChainId: 1952n, verifyingContract: contract, demandId: 1n, builderWallet: builder, serviceUrlHash: keccak256(stringToHex("https://service.example/api")), evidenceHash, paymentRequirementsHash: paymentHash, submissionNonce: 1n, validationPolicyId: policyHash, issuedAt: issued, expiresAt: expires };
    const signature = await signer.signTypedData({ domain: { name: "UNMET AgentDemand", version: "2", chainId: 1952, verifyingContract: contract }, types: attestationTypes, primaryType: "ValidationAttestation", message });
    const attestation = { ...message, escrowChainId: "1952", demandId: resultMode === "BAD_BINDING" ? "2" : "1", submissionNonce: "1", issuedAt: String(issued), expiresAt: String(expires) };
    return Response.json({ status: "PASS", profileId: "test", selectedOffer: { scheme: "exact", network: "eip155:196", asset: token, amount: "1", payTo: builder, maxTimeoutSeconds: 60, extra: { assetTransferMethod: "eip3009", paymentFlow: "authorization" } }, selectedOfferIndex: 0, requestHash: requestHash("https://service.example/api", metadata), paymentRequirementsHash: paymentHash, validationPolicyId: policyHash, validatedAt: String(issued), expiresAt: String(expires), attestation, signature }, { status: resultMode === "HTTP" ? 503 : 200 });
  }
  const rpc = await req.json() as { id: number; method: string; params: [{ data?: Hex }] };
  let result: unknown = null;
  if (rpc.method === "eth_chainId") result = "0x7a0";
  else if (rpc.method === "eth_getCode") result = "0x01";
  else if (rpc.method === "eth_call") {
    const data = rpc.params[0].data ?? "0x";
    if (data.startsWith("0xfc0c546a")) result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: "token", result: token });
    else if (data.startsWith("0x313ce567")) result = encodeFunctionResult({ abi: ERC20_ABI, functionName: "decimals", result: 6 });
    else {
      const decoded = decodeFunctionData({ abi: DEMAND_ABI, data });
      if (decoded.functionName === "submissionNonce") {
        nonceReads++;
        if (changeChainBeforeBroadcast && nonceReads === 3) walletChain = "0x1";
        result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: "submissionNonce", result: sends || (nonceStale && nonceReads > 1) ? 1n : 0n });
      }
      else if (decoded.functionName === "verifier") result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: "verifier", result: signer.address });
      else if (decoded.functionName === "submissionDigests") result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: "submissionDigests", result: [paymentHash, policyHash] });
      else if (decoded.functionName === "getDemand") result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: "getDemand", result: { creator: builder, builder, maxUnitPrice: 1n, committed: 1n, reviewCommitted: 1n, approvalRequired: 1n, expectedCalls: 1n, deadline: 9999999999n, reviewEndsAt: 9999999999n, supporterCount: 1, status: 1, capability: "test", specification: "test", serviceUrl: badReadback ? "https://wrong.example/" : "https://service.example/api", evidenceHash } });
      else if (decoded.functionName === "approvalProgress" || decoded.functionName === "rejectionProgress") result = encodeFunctionResult({ abi: DEMAND_ABI, functionName: decoded.functionName, result: [0n, 1n, false] });
    }
  } else if (rpc.method === "eth_getTransactionReceipt") result = { transactionHash: txHash, transactionIndex: "0x0", blockHash, blockNumber: "0x1", from: builder, to: contract, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", contractAddress: null, logs: [], logsBloom: `0x${"0".repeat(512)}`, status: "0x1", effectiveGasPrice: "0x1", type: "0x0" };
  else if (rpc.method === "eth_blockNumber") result = "0x1";
  return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
} });
afterAll(() => { server.stop(true); Reflect.deleteProperty(globalThis, "window"); });
afterEach(() => { setReownWalletProvider(null); resultMode = "PASS"; sends = 0; signs = 0; requests = 0; nonceReads = 0; submittedData = undefined; walletChange = false; changeDuringSign = false; nonceStale = false; badReadback = false; walletChain = "0x7a0"; changeChainBeforeBroadcast = false; });
function connect() { setReownWalletProvider({ request: async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
  if (method === "eth_accounts") return [builder];
  if (method === "eth_chainId") return walletChain;
  if (method.startsWith("eth_signTypedData")) { signs++; if (changeDuringSign) setReownWalletProvider(null); return `0x${"11".repeat(64)}1b`; }
  if (method === "eth_sendTransaction") { sends++; if (!params) throw new Error("missing transaction"); submittedData = (params[0] as { data: Hex }).data; return txHash; }
  if (method === "eth_estimateGas") return "0x5208";
  if (method === "eth_gasPrice") return "0x1";
  if (method === "eth_getTransactionCount") return "0x0";
  throw new Error(method);
} }, builder); }
const submit = () => submitService(1n, "https://service.example/api", "evidence", builder, "eip155:196", metadata);
describe("canonical submission", () => {
  test("signs authorization and submits exact tuple after PASS and verifies readback", async () => {
    connect(); expect(await submit()).toBe(txHash); expect(signs).toBe(1); expect(sends).toBe(1); expect(requests).toBe(1);
    const decoded = decodeFunctionData({ abi: DEMAND_ABI, data: submittedData! });
    expect(decoded.functionName).toBe("submitService");
    if (decoded.functionName !== "submitService") throw new Error("wrong function");
    expect(decoded.args).toHaveLength(5); expect(decoded.args[3].paymentRequirementsHash).toBe(paymentHash);
  });
  test.each(["FAIL", "UNAVAILABLE", "HTTP", "BAD_BINDING", "EXPIRED", "MALFORMED"])("%s never broadcasts or retries", async mode => {
    resultMode = mode; connect(); await expect(submit()).rejects.toThrow(); expect(sends).toBe(0); expect(requests).toBe(1);
  });
  test("wallet change during typed signature discards authorization", async () => { changeDuringSign = true; connect(); await expect(submit()).rejects.toThrow("WALLET_CHANGED"); expect(signs).toBe(1); expect(sends).toBe(0); expect(requests).toBe(0); });
  test("chain change immediately before broadcast discards PASS", async () => { changeChainBeforeBroadcast = true; connect(); await expect(submit()).rejects.toThrow("CHAIN_WRONG_NETWORK"); expect(sends).toBe(0); expect(requests).toBe(1); });
  test("wallet change and stale nonce never broadcast", async () => {
    walletChange = true; connect(); await expect(submit()).rejects.toThrow(); expect(sends).toBe(0); expect(requests).toBe(1);
    walletChange = false; nonceStale = true; nonceReads = 0; connect(); await expect(submit()).rejects.toThrow("VALIDATION_NONCE_STALE"); expect(sends).toBe(0); expect(requests).toBe(2);
  });
  test("readback mismatch never reports success", async () => { badReadback = true; connect(); await expect(submit()).rejects.toThrow("SUBMISSION_READBACK_FAILED"); expect(sends).toBe(1); expect(requests).toBe(1); });
});
