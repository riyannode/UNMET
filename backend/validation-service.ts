import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { decodeFunctionResult, encodeFunctionData, keccak256, stringToHex, toFunctionSelector, type Hex } from "viem";
import { parseValidationConfig, resolvePolicy, type ValidationConfig } from "./validation-config";
import { parseValidationRequest, evaluateChallenge } from "./validation-evaluator";
import { ValidationError } from "./validation-codec";
import { createValidationTransport, ValidationTransportError } from "./validation-transport";
import { authorizationDigest, attestationDigest, signedBy, validTime, type Attestation } from "./validation-crypto";

const walletAbi = [{type:"function",name:"isValidSignature",stateMutability:"view",inputs:[{name:"hash",type:"bytes32"},{name:"signature",type:"bytes"}],outputs:[{name:"magicValue",type:"bytes4"}]}] as const;

export const validationReadAbi = [
  { type: "function", name: "getDemand", stateMutability: "view", inputs: [{ name: "demandId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [
    { name: "creator", type: "address" }, { name: "builder", type: "address" },
    { name: "maxUnitPrice", type: "uint96" }, { name: "committed", type: "uint128" },
    { name: "reviewCommitted", type: "uint128" }, { name: "approvalRequired", type: "uint128" },
    { name: "expectedCalls", type: "uint256" }, { name: "deadline", type: "uint64" },
    { name: "reviewEndsAt", type: "uint64" }, { name: "supporterCount", type: "uint32" },
    { name: "status", type: "uint8" }, { name: "capability", type: "string" },
    { name: "specification", type: "string" }, { name: "serviceUrl", type: "string" },
    { name: "evidenceHash", type: "bytes32" },
  ] }] },
  { type: "function", name: "submissionNonce", stateMutability: "view", inputs: [{ name: "demandId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;
const abi = validationReadAbi;
type RpcBlock = { number: Hex; hash: Hex; timestamp: Hex };
const hex = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value);

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal, redirect: "error",
    });
    if (response.body) reader = response.body.getReader();
    if (!response.ok || !reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) { complete = true; break; }
      size += part.value.length;
      if (size > 65536) throw new Error();
      chunks.push(part.value);
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(Buffer.concat(chunks)));
    if (!body || typeof body !== "object" || !("jsonrpc" in body) || body.jsonrpc !== "2.0" ||
        !("id" in body) || body.id !== 1 || (("result" in body) === ("error" in body))) throw new Error();
    const callRequest = params[0];
    if ("error" in body && (!body.error || typeof body.error !== "object" || !("code" in body.error) || typeof body.error.code !== "number" || !Number.isInteger(body.error.code) || !("message" in body.error) || typeof body.error.message !== "string")) throw new Error();
    if ("error" in body && body.error && typeof body.error === "object" && "code" in body.error &&
        (body.error.code === 3 || ((body.error.code === -32000 || body.error.code === -32603) && "message" in body.error && body.error.message === "execution reverted" && "data" in body.error && typeof body.error.data === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(body.error.data))) &&
        method === "eth_call" && callRequest && typeof callRequest === "object" && "data" in callRequest && typeof callRequest.data === "string" && callRequest.data.startsWith(toFunctionSelector("isValidSignature(bytes32,bytes)"))) throw new ValidationError("FAIL","INVALID_BUILDER_AUTHORIZATION");
    if ("error" in body && body.error && typeof body.error === "object" && "data" in body.error &&
        body.error.data === toFunctionSelector("DemandNotFound()") && method === "eth_call" &&
        callRequest && typeof callRequest === "object" && "data" in callRequest &&
        typeof callRequest.data === "string" && callRequest.data.startsWith(toFunctionSelector("getDemand(uint256)"))) {
      throw new ValidationError("FAIL", "DEMAND_INELIGIBLE");
    }
    if (!body || typeof body !== "object" || !("result" in body) || ("error" in body)) throw new Error();
    return body.result;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("UNAVAILABLE", "RPC_UNAVAILABLE");
  } finally {
    if (reader) {
      if (!complete) {
        try { await reader.cancel(); } catch { /* Preserve the RPC result. */ }
      }
      reader.releaseLock();
    }
    clearTimeout(timer);
  }
}
async function sign(socketPath: string, tokenPath: string, attestation: Attestation, verifier: string): Promise<string> {
  try {
    const token = readFileSync(tokenPath);
    if (token.length < 64 || token.length > 256 || /[^0-9a-f]/.test(token.toString("utf8")) || !Buffer.from(token.toString("utf8")).equals(token)) throw new Error();
    const result = await new Promise<string>((resolve,reject) => {
      const req = httpRequest({socketPath,path:"/sign",method:"POST",headers:{authorization:token.toString(),"content-type":"application/json"}},res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on("data",(chunk:Buffer) => { size += chunk.length; if (size > 4096) res.destroy(); else chunks.push(chunk); });
        res.on("error",reject);
        res.on("end",() => { if (res.statusCode !== 200) reject(new Error()); else resolve(Buffer.concat(chunks).toString()); });
      });
      const timer = setTimeout(() => req.destroy(new Error()),5000);
      req.on("close",() => clearTimeout(timer)); req.on("error",reject);
      req.end(JSON.stringify({schemaVersion:"unmet-validation-sign-v1",attestation}));
    });
    const value: unknown = JSON.parse(result);
    if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "signature,verifier" || !("verifier" in value) || value.verifier !== verifier || !("signature" in value) || typeof value.signature !== "string" || !await signedBy(attestationDigest(attestation),value.signature,verifier)) throw new Error();
    return value.signature;
  } catch { throw new ValidationError("UNAVAILABLE","SIGNER_UNAVAILABLE"); }
}
async function call(url: string, address: string, data: Hex, block: unknown): Promise<Hex> {
  const result = await rpc(url,"eth_call",[{to:address,data},block]);
  if (!hex(result)) throw new ValidationError("UNAVAILABLE","RPC_UNAVAILABLE");
  return result;
}
async function chain(url: string, expected: string) {
  const result = await rpc(url,"eth_chainId",[]);
  if (!hex(result) || BigInt(result) !== BigInt(expected)) throw new ValidationError("UNAVAILABLE","RPC_UNAVAILABLE");
}
async function code(url: string, address: string, block: unknown) {
  const result = await rpc(url,"eth_getCode",[address,block]);
  if (!hex(result) || /^0x0*$/i.test(result)) throw new ValidationError("UNAVAILABLE","RPC_UNAVAILABLE");
}
async function block(url: string, number: string): Promise<RpcBlock> {
  const result = await rpc(url,"eth_getBlockByNumber",[number,false]);
  if (!result || typeof result !== "object" || !("number" in result) || !("hash" in result) ||
      !("timestamp" in result) || !hex(result.number) || !hex(result.hash) ||
      result.hash.length !== 66 || !hex(result.timestamp)) throw new ValidationError("UNAVAILABLE","RPC_UNAVAILABLE");
  return {number:result.number,hash:result.hash,timestamp:result.timestamp};
}
export async function isSnapshotCanonical(url: string, snapshot: RpcBlock): Promise<boolean> {
  const canonical = await block(url,snapshot.number);
  return BigInt(canonical.number) === BigInt(snapshot.number) && canonical.hash.toLowerCase() === snapshot.hash.toLowerCase();
}

export async function initializeValidationService(config: ValidationConfig, inspectOverride?: ReturnType<typeof createValidationTransport>, allowedOrigins: string[] = []) {
  const origins = new Set(allowedOrigins.map((origin) => {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("CONFIG_INVALID: VALIDATION_ALLOWED_ORIGINS"); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("CONFIG_INVALID: VALIDATION_ALLOWED_ORIGINS");
    return origin;
  }));
  for (const deployment of config.deployments) for (const profile of deployment.paymentProfiles) {
    if (!profile.enabled) continue;
    await chain(profile.paymentRpcUrl, profile.network.slice(7));
    for (const asset of profile.assets) {
      if (!asset.enabled) continue;
      await code(profile.paymentRpcUrl,asset.asset,"latest");
      const result = await call(profile.paymentRpcUrl,asset.asset,encodeFunctionData({abi,functionName:"decimals"}),"latest");
      if (decodeFunctionResult({abi,functionName:"decimals",data:result}) !== asset.decimals) throw new Error("INVALID_ASSET_DECIMALS");
    }
  }
  const inspect = inspectOverride ?? createValidationTransport({managementAddresses:config.managementAddresses});
  let active = 0;
  const handle = async (request: Request): Promise<Response> => {
    const respond = (status: "FAIL" | "UNAVAILABLE", code: string) => Response.json({
      status, code,
      message: status === "FAIL" ? "Validation failed" : "Validation service unavailable",
      retryable: status === "UNAVAILABLE",
    }, {status:status === "FAIL" ? 400 : 503});
    if (new URL(request.url).pathname !== "/v1/x402/validate" || request.method !== "POST") return new Response(null,{status:404});
    if (active >= config.maxInFlight) return respond("UNAVAILABLE","CAPACITY_EXHAUSTED");
    active++;
    try {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return respond("FAIL","INVALID_REQUEST");
      const contentLength = request.headers.get("content-length");
      if (contentLength && /^\d+$/.test(contentLength) && BigInt(contentLength) > 32768n) return respond("FAIL","INVALID_REQUEST");
      const reader = request.body?.getReader();
      if (!reader) return respond("FAIL","INVALID_REQUEST");
      const chunks: Uint8Array[] = []; let size = 0;
      let timedOut = false;
      let cancellation: Promise<void> | undefined;
      const cancel = () => { cancellation ??= reader.cancel(); };
      const timer = setTimeout(() => { timedOut = true; cancel(); },5000);
      request.signal.addEventListener("abort",cancel,{once:true});
      if (request.signal.aborted) cancel();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 32768) { await reader.cancel(); return respond("FAIL","INVALID_REQUEST"); }
          chunks.push(part.value);
        }
      } finally { clearTimeout(timer); request.signal.removeEventListener("abort",cancel); if (cancellation) await cancellation; }
      if (timedOut || request.signal.aborted) return respond("UNAVAILABLE",timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
      const parsed = parseValidationRequest(Buffer.concat(chunks));
      const input = parsed.input;
      const selected = resolvePolicy(config,input.escrowChainId,input.escrowContract,input.paymentNetwork);
      if (!selected) return respond("FAIL","UNSUPPORTED_POLICY");
      await chain(selected.escrowRpcUrl,input.escrowChainId);
      const snapshot = await block(selected.escrowRpcUrl,"latest");
      const pin = {blockHash:snapshot.hash,requireCanonical:true};
      await code(selected.escrowRpcUrl,input.escrowContract,pin);
      const id = BigInt(input.demandId);
      const demandData = await call(selected.escrowRpcUrl,input.escrowContract,encodeFunctionData({abi,functionName:"getDemand",args:[id]}),pin);
      const nonceData = await call(selected.escrowRpcUrl,input.escrowContract,encodeFunctionData({abi,functionName:"submissionNonce",args:[id]}),pin);
      const demand = decodeFunctionResult({abi,functionName:"getDemand",data:demandData});
      const nonce = decodeFunctionResult({abi,functionName:"submissionNonce",data:nonceData});
      if (demand.creator === "0x0000000000000000000000000000000000000000" || demand.status !== 0 || demand.deadline <= BigInt(snapshot.timestamp) || nonce === (1n << 256n) - 1n || nonce + 1n !== BigInt(input.submissionNonce)) return respond("FAIL","DEMAND_INELIGIBLE");
      const auth = input.builderAuthorization;
      const authValid = () => validTime(BigInt(auth.issuedAt),BigInt(auth.expiresAt),BigInt(Math.floor(Date.now()/1000)));
      if (!authValid()) return respond("FAIL","INVALID_BUILDER_AUTHORIZATION");
      const digest = authorizationDigest(parsed);
      if (!await signedBy(digest,auth.signature,input.builderWallet)) {
        const result = await rpc(selected.escrowRpcUrl,"eth_call",[{to:input.builderWallet,data:encodeFunctionData({abi:walletAbi,functionName:"isValidSignature",args:[digest,auth.signature as Hex]})},pin]);
        if (typeof result !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) return respond("UNAVAILABLE","RPC_UNAVAILABLE");
        try {
          if (decodeFunctionResult({abi:walletAbi,functionName:"isValidSignature",data:result as Hex}) !== "0x1626ba7e") return respond("FAIL","INVALID_BUILDER_AUTHORIZATION");
        } catch { return respond("FAIL","INVALID_BUILDER_AUTHORIZATION"); }
      }
      const observation = await inspect(input.serviceUrl,{method:input.request.method,query:input.request.query,contentType:input.request.contentType,body:parsed.postBody});
      const priceAsset = selected.policy.demandPriceAsset;
      const decimals = selected.policy.profile.assets.find((asset) => asset.asset === priceAsset.asset)?.decimals;
      if (decimals === undefined) return respond("FAIL","UNSUPPORTED_PRICE_COMPARISON");
      const evaluation = evaluateChallenge(parsed,observation,selected.policy,demand.maxUnitPrice,decimals);
      if (!await isSnapshotCanonical(selected.escrowRpcUrl,snapshot)) return respond("UNAVAILABLE","RPC_UNAVAILABLE");
      if (!authValid()) return respond("FAIL","INVALID_BUILDER_AUTHORIZATION");
      const now = BigInt(Math.floor(Date.now()/1000));
      const expires = now + 900n < BigInt(auth.expiresAt) ? now + 900n : BigInt(auth.expiresAt);
      const attestation: Attestation = {escrowChainId:input.escrowChainId,verifyingContract:input.escrowContract,demandId:input.demandId,builderWallet:input.builderWallet,serviceUrlHash:keccak256(stringToHex(input.serviceUrl)),evidenceHash:input.evidenceHash,paymentRequirementsHash:evaluation.paymentRequirementsHash,submissionNonce:input.submissionNonce,validationPolicyId:evaluation.validationPolicyId,issuedAt:now.toString(),expiresAt:expires.toString()};
      if (!config.signerSocketPath || !config.signerAuthTokenPath) return respond("UNAVAILABLE","SIGNER_UNAVAILABLE");
      const signature = await sign(config.signerSocketPath,config.signerAuthTokenPath,attestation,selected.verifier);
      if (!authValid() || BigInt(Math.floor(Date.now()/1000)) >= expires) return respond("FAIL","INVALID_BUILDER_AUTHORIZATION");
      return Response.json({status:"PASS",profileId:selected.policy.profile.id,selectedOffer:evaluation.selectedOffer,selectedOfferIndex:evaluation.selectedOfferIndex,requestHash:evaluation.requestHash,validationPolicyId:evaluation.validationPolicyId,paymentRequirementsHash:evaluation.paymentRequirementsHash,validatedAt:attestation.issuedAt,expiresAt:attestation.expiresAt,attestation,signature});
    } catch (error) {
      if (error instanceof ValidationError) return respond(error.status,error.code);
      if (error instanceof ValidationTransportError) return respond(error.code === "INVALID_TARGET" || error.code === "UNSAFE_ADDRESS" || error.code === "INVALID_RESPONSE" ? "FAIL" : "UNAVAILABLE",error.code);
      return respond("UNAVAILABLE","INTERNAL_UNAVAILABLE");
    } finally { active--; }
  };
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowed = origin !== null && origins.has(origin);
    if (request.method === "OPTIONS" && new URL(request.url).pathname === "/v1/x402/validate") {
      if (!allowed || request.headers.get("access-control-request-method") !== "POST" ||
          (request.headers.get("access-control-request-headers") || "").split(",").some((header) => header.trim() && header.trim().toLowerCase() !== "content-type")) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", vary: "Origin" } });
    }
    const response = await handle(request);
    if (allowed) { response.headers.set("access-control-allow-origin", origin); response.headers.append("vary", "Origin"); }
    return response;
  };
}

if (import.meta.main) {
  const path = process.env.VALIDATION_CONFIG_PATH;
  if (!path) throw new Error("VALIDATION_CONFIG_PATH_REQUIRED");
  const config = parseValidationConfig(readFileSync(path));
  const handler = await initializeValidationService(config, undefined, (process.env.VALIDATION_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean));
  Bun.serve({hostname:"127.0.0.1",port:3001,maxRequestBodySize:32769,idleTimeout:10,fetch:handler});
}
