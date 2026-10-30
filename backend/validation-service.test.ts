import { expect, test } from "bun:test";
import { encodeFunctionResult, toFunctionSelector } from "viem";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import fixture from "./fixtures/validation.json";
import { parseValidationConfig } from "./validation-config";
import { initializeValidationService, isSnapshotCanonical, validationReadAbi } from "./validation-service";
import { privateKeyToAccount } from "viem/accounts";
import { parseValidationRequest } from "./validation-evaluator";
import { authorizationDigest } from "./validation-crypto";
import { attestationDigest, attestationMessage, attestationTypes, domain, signedBy, type Attestation } from "./validation-crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import responseSchema from "../docs/schemas/validation-response.json";

test("admission precedes body reading and releases after completion", async () => {
  const handler = await initializeValidationService({ maxInFlight: 1, managementAddresses: [], deployments: [], signerSocketPath:"/tmp/unused", signerAuthTokenPath:"/tmp/unused" });
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  const request = new Request("http://localhost/v1/x402/validate", {method:"POST",headers:{"content-type":"application/json"},body});
  const first = handler(request);
  const rejected = new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  Object.defineProperty(rejected,"body",{get() { throw new Error("body read before admission"); }});
  const second = await handler(rejected);
  expect(second.status).toBe(503);
  expect((await second.json()).code).toBe("CAPACITY_EXHAUSTED");
  stream!.enqueue(new TextEncoder().encode("{}"));
  stream!.close();
  expect((await first).status).toBe(400);
  const third = await handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  expect(third.status).toBe(400);
});

test("ingress rejects oversized and non-JSON bodies", async () => {
  const handler = await initializeValidationService({ maxInFlight: 1, managementAddresses: [], deployments: [], signerSocketPath:"/tmp/unused", signerAuthTokenPath:"/tmp/unused" });
  const request = (body: string, contentType: string) => new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":contentType},body});
  expect((await handler(request("a".repeat(32769),"application/json"))).status).toBe(400);
  expect((await handler(request("{}","text/plain"))).status).toBe(400);
  expect((await handler(new Request("http://localhost/other"))).status).toBe(404);
});

test("timed out upload retains capacity until cancellation finishes", async () => {
  const handler = await initializeValidationService({ maxInFlight: 1, managementAddresses: [], deployments: [], signerSocketPath:"/tmp/unused", signerAuthTokenPath:"/tmp/unused" });
  let release!: () => void;
  let cancelled!: () => void;
  const started = new Promise<void>(resolve => { cancelled = resolve; });
  const cancellation = new Promise<void>(resolve => { release = resolve; });
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled(); return cancellation; } });
  const pending = handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body}));
  await started;
  try {
    const saturated = await handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
    expect((await saturated.json()).code).toBe("CAPACITY_EXHAUSTED");
  } finally { release(); }
  const result = await pending;
  expect(result.status).toBe(503);
  expect((await result.json()).code).toBe("REQUEST_TIMEOUT");
}, 7000);

test("aborted upload cancels its stream before releasing capacity", async () => {
  const handler = await initializeValidationService({ maxInFlight: 1, managementAddresses: [], deployments: [], signerSocketPath:"/tmp/unused", signerAuthTokenPath:"/tmp/unused" });
  let release!: () => void;
  const cancellation = new Promise<void>(resolve => { release = resolve; });
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { return cancellation; } });
  const pending = handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body,signal:abort.signal}));
  abort.abort();
  try {
    const saturated = await handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
    expect((await saturated.json()).code).toBe("CAPACITY_EXHAUSTED");
  } finally { release(); }
  expect((await (await pending).json()).code).toBe("REQUEST_ABORTED");
});

test("canonical recheck uses snapshot height even when the head advances", async () => {
  const original = globalThis.fetch;
  const hash = `0x${"a".repeat(64)}` as const;
  const snapshot = { number:"0x1" as const, hash, timestamp:"0x1" as const };
  let seen = "";
  let currentHash: string = hash;
  const mock: typeof fetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    seen = body.params[0];
    return Response.json({jsonrpc:"2.0",id:1,result:{number:"0x1",hash:currentHash,timestamp:"0x1"}});
  }, {preconnect: original.preconnect});
  globalThis.fetch = mock;
  try {
    expect(await isSnapshotCanonical("https://rpc.example",snapshot)).toBe(true);
    expect(seen).toBe("0x1");
    currentHash = `0x${"b".repeat(64)}`;
    expect(await isSnapshotCanonical("https://rpc.example",snapshot)).toBe(false);
  } finally { globalThis.fetch = original; }
});

test("pinned demand reads, failure paths and public attestation boundary", async () => {
  const dir = mkdtempSync(join(tmpdir(),"unmet-service-"));
  const socket = join(dir,"signer.sock"), token = join(dir,"token"), keyPath = join(dir,"key"), signerConfig = join(dir,"config");
  const key = `0x${"22".repeat(32)}` as const;
  const verifier = privateKeyToAccount(key).address.toLowerCase();
  writeFileSync(token,"ab".repeat(32)); writeFileSync(keyPath,key);
  writeFileSync(signerConfig,JSON.stringify({schemaVersion:"unmet-validation-signer-v1",socketPath:socket,authTokenPath:token,privateKeyPath:keyPath,verifier,allowedPolicies:[{escrowChainId:fixture.policy.escrowChainId,escrowContract:fixture.policy.escrowContract,validationPolicyId:fixture.expected.validationPolicyId}]}));
  const signer = Bun.spawn([process.execPath,"run",new URL("./validation-signer.ts",import.meta.url).pathname],{env:{...process.env,VALIDATION_SIGNER_CONFIG_PATH:signerConfig},stdout:"pipe",stderr:"pipe"});
  const config = parseValidationConfig(Buffer.from(JSON.stringify({
    maxInFlight: 1, managementAddresses: [], signerSocketPath:socket, signerAuthTokenPath:token, deployments: [{
      escrowChainId: fixture.policy.escrowChainId, escrowContract: fixture.policy.escrowContract,
      escrowRpcUrl: "https://escrow.example", verifier, demandPriceAsset: fixture.policy.demandPriceAsset,
      paymentProfiles: [{...fixture.policy.profile, paymentRpcUrl:"https://payment.example"}],
    }],
  })));
  const input = {
    schemaVersion:"unmet-x402-validation-v1", escrowChainId:"1952", escrowContract:fixture.policy.escrowContract,
    demandId:"1", submissionNonce:"1", builderWallet:fixture.authorization.message.builderWallet,
    authorizedPayTo:fixture.authorization.message.authorizedPayTo, serviceUrl:"https://example.com/weather",
    evidenceHash:fixture.authorization.message.evidenceHash, paymentNetwork:"eip155:196",
    request:{method:"POST",query:[],contentType:"application/json",body:{city:"Jakarta"}},
    builderAuthorization:{issuedAt:"1792886400",expiresAt:"1792887300",signature:"0x12"},
  };
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  input.builderWallet = account.address.toLowerCase();
  input.builderAuthorization.issuedAt = String(Math.floor(Date.now()/1000));
  input.builderAuthorization.expiresAt = String(Number(input.builderAuthorization.issuedAt) + 900);
  input.builderAuthorization.signature = await account.sign({hash:authorizationDigest(parseValidationRequest(Buffer.from(JSON.stringify(input))))});
  const snapshotHash = `0x${"a".repeat(64)}` as const;
  const otherHash = `0x${"b".repeat(64)}` as const;
  const original = globalThis.fetch;
  let scenario = "eligible";
  let calls: {method: string; params: unknown[]}[] = [];
  let inspections = 0;
  const realNow = Date.now;
  let cancelStarted!: () => void;
  let releaseCancel!: () => void;
  const cancellationStarted = new Promise<void>(resolve => { cancelStarted = resolve; });
  const cancellation = new Promise<void>(resolve => { releaseCancel = resolve; });
  const mock: typeof fetch = Object.assign(async (target: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    expect(init?.headers).toEqual({"content-type":"application/json"});
    const payload = JSON.parse(String(init?.body)) as {method:string;params:unknown[]};
    calls.push(payload);
    if (scenario === "rpc-non2xx") return new Response(new ReadableStream({cancel() { cancelStarted(); return cancellation; }}),{status:500});
    const payment = String(target).includes("payment.example");
    let result: unknown;
    if (payload.method === "eth_chainId") result = payment ? "0xc4" : scenario === "wrong-chain" ? "0x1" : "0x7a0";
    else if (payload.method === "eth_getCode") result = scenario === "no-code" && !payment ? "0x" : "0x01";
    else if (payload.method === "eth_getBlockByNumber") result = {number:"0x1",hash:scenario === "reorg" && payload.params[0] !== "latest" ? otherHash : snapshotHash,timestamp:"0x64"};
    else if (payload.method === "eth_call") {
      const call = payload.params[0] as {data:string};
      if (call.data.startsWith(toFunctionSelector("decimals()"))) result = encodeFunctionResult({abi:validationReadAbi,functionName:"decimals",result:scenario === "decimals" ? 18 : 6});
      else if (call.data.startsWith(toFunctionSelector("submissionNonce(uint256)"))) result = encodeFunctionResult({abi:validationReadAbi,functionName:"submissionNonce",result:scenario === "overflow" ? (1n << 256n) - 1n : scenario === "stale" ? 1n : 0n});
      else if (call.data.startsWith(toFunctionSelector("isValidSignature(bytes32,bytes)"))) {
        if (scenario === "wallet-revert") return Response.json({jsonrpc:"2.0",id:1,error:{code:-32000,message:"execution reverted",data:"0x"}});
        if (scenario === "wallet-outage") return Response.json({jsonrpc:"2.0",id:1,error:{code:-32000,message:"upstream unavailable"}});
        if (scenario === "wallet-malformed-rpc") return Response.json({jsonrpc:"2.0",id:1,error:{code:3}});
        result = scenario === "wallet-valid" ? `0x1626ba7e${"0".repeat(56)}` : scenario === "wallet-wrong" ? `0xffffffff${"0".repeat(56)}` : "0x";
      }
      else {
        if (scenario === "missing") return Response.json({jsonrpc:"2.0",id:1,error:{code:3,message:"execution reverted",data:toFunctionSelector("DemandNotFound()")}});
        result = encodeFunctionResult({abi:validationReadAbi,functionName:"getDemand",result:{creator:"0x1111111111111111111111111111111111111111",builder:"0x0000000000000000000000000000000000000000",maxUnitPrice:10000n,committed:0n,reviewCommitted:0n,approvalRequired:0n,expectedCalls:1n,deadline:scenario === "deadline" ? 100n : 1000n,reviewEndsAt:0n,supporterCount:0,status:scenario === "status" ? 1 : 0,capability:"",specification:"",serviceUrl:"",evidenceHash:`0x${"0".repeat(64)}`}});
      }
    }
    if (scenario === "rpc-error") return Response.json({jsonrpc:"2.0",id:1,error:{code:-32000}});
    return Response.json({jsonrpc:"2.0",id:1,result});
  }, {preconnect: original.preconnect});
  globalThis.fetch = mock;
  const inspect = async (_url: string, request: {method:"GET" | "POST";query:[string,string][];contentType:"application/json" | null;body:string | null}) => {
    inspections++;
    if (scenario === "expire") Date.now = () => realNow() + 901000;
    if (scenario === "endpoint-failure") return {status:500,paymentRequired:null};
    expect(Object.keys(request).sort()).toEqual(["body","contentType","method","query"]);
    return {status:402,paymentRequired:Buffer.from(JSON.stringify({x402Version:2,resource:fixture.payment.resource,accepts:[fixture.payment.selected]})).toString("base64")};
  };
  try {
    for (let i=0;i<100 && !existsSync(socket);i++) await Bun.sleep(20);
    expect(existsSync(socket)).toBe(true);
    const handler = await initializeValidationService(config,inspect);
    const run = async () => handler(new Request("http://localhost/v1/x402/validate",{method:"POST",headers:{"content-type":"application/json","authorization":"secret","payment-signature":"secret"},body:JSON.stringify(input)}));
    calls = [];
    const eligible = await run();
    expect(eligible.status).toBe(200);
    const pass = await eligible.json();
    expect(new Ajv2020({strict:false}).compile(responseSchema)(pass)).toBe(true);
    expect(pass.profileId).toBe(fixture.policy.profile.id);
    expect(pass.selectedOffer).toEqual(fixture.payment.selected);
    expect(pass.selectedOfferIndex).toBe(0);
    expect(pass.requestHash).toBe(fixture.expected.requestHash);
    expect(pass.paymentRequirementsHash).toBe(fixture.expected.paymentRequirementsHash);
    expect(pass.validationPolicyId).toBe(fixture.expected.validationPolicyId);
    expect(pass.attestation.expiresAt).toBe(input.builderAuthorization.expiresAt);
    expect(pass.attestation).toEqual({escrowChainId:input.escrowChainId,verifyingContract:input.escrowContract,demandId:input.demandId,builderWallet:input.builderWallet,serviceUrlHash:fixture.authorization.message.serviceUrlHash,evidenceHash:input.evidenceHash,paymentRequirementsHash:pass.paymentRequirementsHash,submissionNonce:input.submissionNonce,validationPolicyId:pass.validationPolicyId,issuedAt:pass.validatedAt,expiresAt:pass.expiresAt});
    expect(await signedBy(attestationDigest(pass.attestation),pass.signature,verifier)).toBe(true);
    const pointReads = calls.filter(c => c.method === "eth_call");
    expect(pointReads).toHaveLength(2);
    for (const read of pointReads) expect(read.params[1]).toEqual({blockHash:snapshotHash,requireCanonical:true});
    expect(calls.filter(c => c.method === "eth_getBlockByNumber").map(c => c.params[0])).toEqual(["latest","0x1"]);
    config.deployments[0].verifier = "0x1111111111111111111111111111111111111111";
    expect((await (await run()).json()).code).toBe("SIGNER_UNAVAILABLE");
    config.deployments[0].verifier = verifier;
    config.signerSocketPath = join(dir,"absent.sock");
    expect((await (await run()).json()).code).toBe("SIGNER_UNAVAILABLE");
    const fakeSocket = join(dir,"fake.sock");
    let mode = "uppercase", signerCalls = 0;
    const fake = createServer((req,res) => {
      signerCalls++; const chunks:Buffer[] = []; req.on("data",(chunk:Buffer) => chunks.push(chunk));
      req.on("end",async () => {
        if (mode === "slow") { res.writeHead(200); const timer = setInterval(() => res.write(" "),100); res.on("close",() => clearInterval(timer)); return; }
        if (mode === "malformed") { res.end("{"); return; }
        if (mode === "extra") { res.end(JSON.stringify({verifier,signature:pass.signature,extra:true})); return; }
        if (mode === "oversized") { res.end("x".repeat(4097)); return; }
        if (mode === "wrong") { res.end(JSON.stringify({verifier,signature:`0x${"11".repeat(64)}1b`})); return; }
        if (mode === "stale") {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {attestation:Attestation};
          const signature = await privateKeyToAccount(key).signTypedData({domain:domain(body.attestation.escrowChainId,body.attestation.verifyingContract),types:attestationTypes,primaryType:"ValidationAttestation",message:attestationMessage(body.attestation)});
          Date.now = () => realNow() + 901000; res.end(JSON.stringify({verifier,signature})); return;
        }
        res.end(JSON.stringify({verifier,signature:`0x${pass.signature.slice(2,-2).toUpperCase()}${pass.signature.slice(-2)}`}));
      });
    });
    await new Promise<void>(resolve => fake.listen(fakeSocket,resolve));
    try {
      config.signerSocketPath = fakeSocket;
      for (mode of ["uppercase","malformed","extra","oversized","wrong","slow"]) {
        const result = await (await run()).json(); expect(result.code).toBe("SIGNER_UNAVAILABLE"); expect(result.attestation).toBeUndefined(); expect(result.signature).toBeUndefined();
      }
      mode = "stale"; expect((await (await run()).json()).code).toBe("INVALID_BUILDER_AUTHORIZATION"); Date.now = realNow;
      const before = signerCalls;
      scenario = "endpoint-failure"; expect((await (await run()).json()).code).toBe("ENDPOINT_UNAVAILABLE");
      scenario = "wallet-empty"; const signature = input.builderAuthorization.signature; input.builderAuthorization.signature = "0x12";
      const failed = await (await run()).json(); expect(failed.code).toBe("INVALID_BUILDER_AUTHORIZATION"); expect(failed.attestation).toBeUndefined(); expect(failed.signature).toBeUndefined();
      input.builderAuthorization.signature = signature; scenario = "eligible"; expect(signerCalls).toBe(before);
    }
    finally { await new Promise<void>(resolve => fake.close(() => resolve())); }
    config.signerSocketPath = socket;
    scenario = "endpoint-failure"; expect((await (await run()).json()).code).toBe("ENDPOINT_UNAVAILABLE");
    scenario = "expire"; expect((await (await run()).json()).code).toBe("INVALID_BUILDER_AUTHORIZATION");
    Date.now = realNow; scenario = "eligible";
    const originalSignature = input.builderAuthorization.signature;
    input.builderAuthorization.signature = "0x1234";
    for (const [walletScenario,status,code] of [["wallet-empty",400,"INVALID_BUILDER_AUTHORIZATION"],["wallet-wrong",400,"INVALID_BUILDER_AUTHORIZATION"],["wallet-revert",400,"INVALID_BUILDER_AUTHORIZATION"],["wallet-outage",503,"RPC_UNAVAILABLE"],["wallet-malformed-rpc",503,"RPC_UNAVAILABLE"]] as const) {
      scenario = walletScenario; const before = inspections; const response = await run();
      expect(response.status).toBe(status); expect((await response.json()).code).toBe(code); expect(inspections).toBe(before);
      const walletRead = calls.filter(c => c.method === "eth_call" && String((c.params[0] as {data:string}).data).startsWith(toFunctionSelector("isValidSignature(bytes32,bytes)"))).at(-1);
      expect(walletRead?.params[1]).toEqual({blockHash:snapshotHash,requireCanonical:true});
    }
    scenario = "wallet-valid"; expect((await run()).status).toBe(200);
    input.builderAuthorization.signature = originalSignature;
    scenario = "rpc-non2xx";
    const pending = run();
    await cancellationStarted;
    try {
      expect((await (await run()).json()).code).toBe("CAPACITY_EXHAUSTED");
    } finally { releaseCancel(); }
    expect((await (await pending).json()).code).toBe("RPC_UNAVAILABLE");
    for (const failure of ["missing","status","deadline","stale","overflow"]) {
      scenario = failure;
      const response = await run();
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("DEMAND_INELIGIBLE");
    }
    for (const failure of ["wrong-chain","no-code","rpc-error","reorg"]) {
      scenario = failure;
      expect((await run()).status).toBe(503);
    }
    input.submissionNonce = "2";
    scenario = "eligible";
    expect((await run()).status).toBe(400);
    input.submissionNonce = "1";
    scenario = "decimals";
    await expect(initializeValidationService(config,inspect)).rejects.toThrow("INVALID_ASSET_DECIMALS");
    scenario = "rpc-error";
    await expect(initializeValidationService(config,inspect)).rejects.toThrow("RPC_UNAVAILABLE");
    expect(inspections).toBeGreaterThan(0);
  } finally { Date.now = realNow; globalThis.fetch = original; signer.kill("SIGTERM"); await signer.exited; expect(existsSync(socket)).toBe(false); rmSync(dir,{recursive:true,force:true}); }
}, 15000);

test("Bun HTTP ingress enforces body bounds and admission", async () => {
  const handler = await initializeValidationService({maxInFlight:1,managementAddresses:[],deployments:[],signerSocketPath:"/tmp/unused",signerAuthTokenPath:"/tmp/unused"});
  let admitted!: () => void;
  const accepted = new Promise<void>(resolve => { admitted = resolve; });
  let signalAdmission = false;
  const server = Bun.serve({
    hostname:"127.0.0.1",port:0,maxRequestBodySize:32769,idleTimeout:10,
    fetch(request) {
      const response = handler(request);
      if (signalAdmission) admitted();
      return response;
    },
  });
  const port = server.port;
  if (!port) throw new Error("missing fixture port");
  const url = `http://127.0.0.1:${port}/v1/x402/validate`;
  try {
    const input = JSON.stringify({
      schemaVersion:"unmet-x402-validation-v1", escrowChainId:"1952", escrowContract:fixture.policy.escrowContract,
      demandId:"1", submissionNonce:"1", builderWallet:fixture.authorization.message.builderWallet,
      authorizedPayTo:fixture.authorization.message.authorizedPayTo, serviceUrl:"https://example.com/weather",
      evidenceHash:fixture.authorization.message.evidenceHash, paymentNetwork:"eip155:196",
      request:{method:"POST",query:[],contentType:"application/json",body:{city:"Jakarta"}},
      builderAuthorization:{issuedAt:"1792886400",expiresAt:"1792887300",signature:"0x12"},
    });
    const exact = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:input.padEnd(32768," ")});
    expect(exact.status).toBe(400);
    expect((await exact.json()).code).toBe("UNSUPPORTED_POLICY");
    const over = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:" ".repeat(32769)});
    expect(over.status).toBe(400);
    expect((await over.json()).code).toBe("INVALID_REQUEST");
    const hardLimit = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:" ".repeat(32770)});
    expect(hardLimit.status).toBe(413);
    signalAdmission = true;
    const ongoing = httpRequest(url,{method:"POST",headers:{"content-type":"application/json","transfer-encoding":"chunked"}});
    const ended = new Promise<void>((resolve,reject) => {
      ongoing.on("response",response => { response.resume(); response.on("end",resolve); });
      ongoing.on("error",reject);
    });
    ongoing.write("{");
    await accepted;
    const rejected = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    expect(rejected.status).toBe(503);
    expect((await rejected.json()).code).toBe("CAPACITY_EXHAUSTED");
    ongoing.end("}");
    await ended;
  } finally {
    await server.stop(true);
  }
  const closed = await new Promise<boolean>(resolve => {
    const socket = connect(port,"127.0.0.1");
    socket.once("connect",() => { socket.destroy(); resolve(false); });
    socket.once("error",() => resolve(true));
  });
  expect(closed).toBe(true);
});

test("RPC rejects malformed envelopes and bounded oversized bodies", async () => {
  const original = globalThis.fetch;
  const snapshot = {number:"0x1" as const,hash:`0x${"a".repeat(64)}` as const,timestamp:"0x1" as const};
  let body = "";
  globalThis.fetch = Object.assign(async () => new Response(body),{preconnect:original.preconnect});
  try {
    for (const invalid of [
      {jsonrpc:"1.0",id:1,result:{}}, {jsonrpc:"2.0",id:2,result:{}},
      {jsonrpc:"2.0",id:1,result:{},error:{}}, {jsonrpc:"2.0",id:1},
    ]) {
      body = JSON.stringify(invalid);
      await expect(isSnapshotCanonical("https://rpc.example",snapshot)).rejects.toThrow("RPC_UNAVAILABLE");
    }
    let malformedClosed = false;
    globalThis.fetch = Object.assign(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); controller.close(); malformedClosed = true; },
    })),{preconnect:original.preconnect});
    await expect(isSnapshotCanonical("https://rpc.example",snapshot)).rejects.toThrow("RPC_UNAVAILABLE");
    expect(malformedClosed).toBe(true);
    let cancelled = false;
    globalThis.fetch = Object.assign(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled = true; },
    })),{preconnect:original.preconnect});
    await expect(isSnapshotCanonical("https://rpc.example",snapshot)).rejects.toThrow("RPC_UNAVAILABLE");
    expect(cancelled).toBe(true);
  } finally { globalThis.fetch = original; }
});

test("RPC timeout aborts a stalled fetch", async () => {
  const original = globalThis.fetch;
  const snapshot = {number:"0x1" as const,hash:`0x${"a".repeat(64)}` as const,timestamp:"0x1" as const};
  let aborted = false;
  globalThis.fetch = Object.assign((_target: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve,reject) => {
    init?.signal?.addEventListener("abort",() => { aborted = true; reject(new Error("aborted")); },{once:true});
  }),{preconnect:original.preconnect});
  try {
    await expect(isSnapshotCanonical("https://rpc.example",snapshot)).rejects.toThrow("RPC_UNAVAILABLE");
    expect(aborted).toBe(true);
  } finally { globalThis.fetch = original; }
},7000);

test("isolated import does not mutate globals or require payment credentials", () => {
  const env = {...process.env};
  for (const key of ["OKX_API_KEY","OKX_SECRET_KEY","OKX_PASSPHRASE","OKX_PAY_TO","PAYMENT_DB_PATH"]) delete env[key];
  const result = Bun.spawnSync([process.execPath,"-e",`const f=globalThis.fetch, l=console.log, w=console.warn, e=console.error; await import(${JSON.stringify(new URL("./validation-service.ts",import.meta.url).href)}); if(f!==globalThis.fetch || l!==console.log || w!==console.warn || e!==console.error) process.exit(2)`],{env,stdout:"pipe",stderr:"pipe"});
  expect(result.exitCode).toBe(0);
});
