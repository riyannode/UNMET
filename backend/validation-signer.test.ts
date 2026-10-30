import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAddress, type Hex } from "viem";
import fixture from "./fixtures/validation.json";
import { attestationDigest, canonicalSignature, signedBy, validTime } from "./validation-crypto";

test("protected signer authenticates and only signs approved attestations", async () => {
  const dir = mkdtempSync(join(tmpdir(),"unmet-signer-"));
  const socket = join(dir,"s.sock"), tokenPath = join(dir,"token"), keyPath = join(dir,"key"), configPath = join(dir,"config");
  const key = `0x${"11".repeat(32)}` as const, token = "ab".repeat(32);
  const verifier = privateKeyToAccount(key).address.toLowerCase();
  const now = Math.floor(Date.now()/1000);
  const attestation = {...fixture.attestation.message,issuedAt:String(now),expiresAt:String(now+300)};
  writeFileSync(tokenPath,token); writeFileSync(keyPath,key);
  writeFileSync(configPath,JSON.stringify({schemaVersion:"unmet-validation-signer-v1",socketPath:socket,authTokenPath:tokenPath,privateKeyPath:keyPath,verifier,allowedPolicies:[{escrowChainId:attestation.escrowChainId,escrowContract:attestation.verifyingContract,validationPolicyId:attestation.validationPolicyId}]}));
  const child = Bun.spawn([process.execPath,"run",new URL("./validation-signer.ts",import.meta.url).pathname],{env:{...process.env,VALIDATION_SIGNER_CONFIG_PATH:configPath},stdout:"pipe",stderr:"pipe"});
  const send = (body: unknown, authorization = token) => new Promise<{status:number;body:string}>((resolve,reject) => {
    const req = request({socketPath:socket,path:"/sign",method:"POST",headers:{authorization}},res => {
      let text = ""; res.on("data",chunk => text += chunk); res.on("end",() => resolve({status:res.statusCode ?? 0,body:text})); res.on("error",reject);
    }); req.on("error",reject); req.end(JSON.stringify(body));
  });
  try {
    for (let i=0;i<100 && !existsSync(socket);i++) await Bun.sleep(20);
    expect(existsSync(socket)).toBe(true);
    const body = {schemaVersion:"unmet-validation-sign-v1",attestation};
    for (const invalid of [
      {...body,schemaVersion:"wrong"}, {...body,digest:`0x${"11".repeat(32)}`}, {...body,primaryType:"other"}, {...body,domain:{}},
      {...body,attestation:{...attestation,unknown:true}}, {...body,attestation:{...attestation,escrowChainId:"196"}},
      {...body,attestation:{...attestation,verifyingContract:"0x2222222222222222222222222222222222222222"}},
      {...body,attestation:{...attestation,validationPolicyId:`0x${"11".repeat(32)}`}},
      {...body,attestation:{...attestation,issuedAt:String(now+70),expiresAt:String(now+71)}},
      {...body,attestation:{...attestation,expiresAt:String(now)}},
      {...body,attestation:{...attestation,evidenceHash:"0x12"}},
      {...body,attestation:{...attestation,builderWallet:"0x1234"}},
      {...body,attestation:{...attestation,demandId:"01"}},
      {...body,attestation:{...attestation,issuedAt:`0${now}`}},
      ...["issuedAt","expiresAt","demandId"].map(field => ({...body,attestation:{...attestation,[field]:`${attestation[field as keyof typeof attestation]}\n`}})),
      {...body,attestation:{...attestation,builderWallet:`${attestation.builderWallet}\n`}},
      {...body,attestation:{...attestation,validationPolicyId:`${attestation.validationPolicyId}\n`}},
    ]) expect((await send(invalid)).status).toBe(400);
    expect((await send(body,"")).status).toBe(400);
    expect((await send(body,"cd".repeat(32))).status).toBe(400);
    const result = await send(body);
    expect(result.status).toBe(200);
    expect(result.body.includes(token)).toBe(false);
    const parsed = JSON.parse(result.body) as {verifier:string;signature:string};
    expect(Object.keys(parsed).sort()).toEqual(["signature","verifier"]);
    expect(parsed.verifier).toBe(verifier);
    expect(canonicalSignature(parsed.signature)).toBe(true);
    expect(await signedBy(attestationDigest(attestation),parsed.signature,verifier)).toBe(true);
    expect(await signedBy(attestationDigest({...attestation,demandId:"2"}),parsed.signature,verifier)).toBe(false);
  } finally {
    child.kill("SIGTERM"); await child.exited;
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    expect(existsSync(socket)).toBe(false);
    rmSync(dir,{recursive:true,force:true});
    for (const output of [stdout,stderr]) { expect(output.includes(token)).toBe(false); expect(output.includes(key)).toBe(false); }
  }
});

test("signer import is isolated and key mismatch fails startup", () => {
  const env = {...process.env};
  for (const name of ["OKX_API_KEY","OKX_SECRET_KEY","OKX_PASSPHRASE","PAYMENT_DB_PATH","VALIDATION_SIGNER_CONFIG_PATH"]) delete env[name];
  const url = new URL("./validation-signer.ts",import.meta.url);
  const imported = Bun.spawnSync([process.execPath,"-e",`const f=fetch, l=console.log, w=console.warn, e=console.error; await import(${JSON.stringify(url.href)}); if(f!==fetch || l!==console.log || w!==console.warn || e!==console.error) process.exit(2)`],{env,stdout:"pipe",stderr:"pipe"});
  expect(imported.exitCode).toBe(0);
  const dir = mkdtempSync(join(tmpdir(),"unmet-mismatch-"));
  try {
    const token = join(dir,"token"), key = join(dir,"key"), config = join(dir,"config");
    writeFileSync(token,"ab".repeat(32)); writeFileSync(key,`0x${"11".repeat(32)}`);
    writeFileSync(config,JSON.stringify({schemaVersion:"unmet-validation-signer-v1",socketPath:join(dir,"s.sock"),authTokenPath:token,privateKeyPath:key,verifier:"0x1111111111111111111111111111111111111111",allowedPolicies:[{escrowChainId:"1952",escrowContract:fixture.attestation.message.verifyingContract,validationPolicyId:fixture.attestation.message.validationPolicyId}]}));
    const result = Bun.spawnSync([process.execPath,"run",url.pathname],{env:{...env,VALIDATION_SIGNER_CONFIG_PATH:config},stdout:"pipe",stderr:"pipe"});
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("VERIFIER_MISMATCH");
    expect(existsSync(join(dir,"s.sock"))).toBe(false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("authorization time boundaries", () => {
  expect(validTime(1060n, 1061n, 1000n)).toBe(true);
  expect(validTime(1061n, 1062n, 1000n)).toBe(false);
  expect(validTime(1000n, 1000n, 1000n)).toBe(false);
  expect(validTime(1001n, 1000n, 999n)).toBe(false);
  expect(validTime(1000n, 1900n, 1000n)).toBe(true);
  expect(validTime(1000n, 1901n, 1000n)).toBe(false);
  expect(validTime(1000n, 1900n, 1900n)).toBe(false);
});

test("EOA recovery rejects wrong signer and noncanonical signatures", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const digest = attestationDigest(fixture.attestation.message);
  const signature = await account.sign({hash:digest});
  expect(await signedBy(digest,signature,account.address.toLowerCase())).toBe(true);
  expect(await signedBy(digest,signature,"0x1111111111111111111111111111111111111111")).toBe(false);
  expect(await signedBy(digest,"0x12",account.address.toLowerCase())).toBe(false);
  expect(await signedBy(digest,`${signature.slice(0,-2)}1d`,account.address.toLowerCase())).toBe(false);
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (order - BigInt(`0x${signature.slice(66,130)}`)).toString(16).padStart(64,"0");
  const malleated: Hex = `${signature.slice(0,66)}${highS}${signature.endsWith("1b") ? "1c" : "1b"}` as Hex;
  expect((await recoverAddress({hash:digest,signature:malleated})).toLowerCase()).toBe(account.address.toLowerCase());
  expect(await signedBy(digest,malleated,account.address.toLowerCase())).toBe(false);
});

test("startup rejects newline token and leaves an existing socket intact", async () => {
  const dir = mkdtempSync(join(tmpdir(),"unmet-collision-"));
  const socket = join(dir,"s.sock"), token = join(dir,"token"), keyPath = join(dir,"key"), config = join(dir,"config");
  const key = `0x${"11".repeat(32)}` as const;
  writeFileSync(keyPath,key); writeFileSync(token,`${"ab".repeat(32)}\n`);
  writeFileSync(config,JSON.stringify({schemaVersion:"unmet-validation-signer-v1",socketPath:socket,authTokenPath:token,privateKeyPath:keyPath,verifier:privateKeyToAccount(key).address.toLowerCase(),allowedPolicies:[{escrowChainId:"1952",escrowContract:fixture.attestation.message.verifyingContract,validationPolicyId:fixture.attestation.message.validationPolicyId}]}));
  const url = new URL("./validation-signer.ts",import.meta.url);
  const env = {...process.env,VALIDATION_SIGNER_CONFIG_PATH:config};
  const server = createServer((_req,res) => res.end("original"));
  try {
    const invalid = Bun.spawnSync([process.execPath,"run",url.pathname],{env,stdout:"pipe",stderr:"pipe"});
    expect(invalid.exitCode).not.toBe(0); expect(invalid.stderr.toString()).toContain("INVALID_SIGNER_TOKEN");
    writeFileSync(token,"ab".repeat(32));
    await new Promise<void>(resolve => server.listen(socket,resolve));
    const child = Bun.spawn([process.execPath,"run",url.pathname],{env,stdout:"pipe",stderr:"pipe"});
    try {
      const exit = await Promise.race([child.exited,Bun.sleep(3000).then(() => null)]);
      expect(exit).not.toBeNull(); expect(exit).not.toBe(0); expect(existsSync(socket)).toBe(true);
      const response = await new Promise<string>((resolve,reject) => { const req = request({socketPath:socket,path:"/"},res => { let body=""; res.on("data",chunk => body += chunk); res.on("end",() => resolve(body)); }); req.on("error",reject); req.end(); });
      expect(response).toBe("original");
    } finally { if (child.exitCode === null) child.kill("SIGTERM"); await child.exited; }
  } finally { if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir,{recursive:true,force:true}); }
});
