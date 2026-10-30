import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import responseSchema from "../docs/schemas/validation-response.json";
import { attestationMessage, attestationTypes, domain, validTime, type Attestation } from "./validation-crypto";
import { parseStrictJSON, parseUint256 } from "./validation-codec";

type SignerConfig = { schemaVersion:"unmet-validation-signer-v1"; socketPath:string; authTokenPath:string; privateKeyPath:string; verifier:string; allowedPolicies:{escrowChainId:string;escrowContract:string;validationPolicyId:string}[] };
const address = (v:string) => v.length === 42 && /^0x[0-9a-f]{40}$/.test(v) && v !== `0x${"0".repeat(40)}`;
const hash = (v:string) => v.length === 66 && /^0x[0-9a-f]{64}$/.test(v);
const decimal = (v:string) => v.length > 0 && !/[^0-9]/.test(v) && (v === "0" || v[0] !== "0");
const schema = responseSchema.oneOf[0].properties.attestation!;
const validateAttestation = new Ajv2020({strict:false}).compile<Attestation>(schema);
const exact = (value: object, keys: string[]) => Object.keys(value).sort().join(",") === keys.sort().join(",");
function loadConfig(raw: Uint8Array): SignerConfig {
  const value = parseStrictJSON(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || !exact(value,["schemaVersion","socketPath","authTokenPath","privateKeyPath","verifier","allowedPolicies"]) ||
      value.schemaVersion !== "unmet-validation-signer-v1" || typeof value.socketPath !== "string" || !value.socketPath.startsWith("/") ||
      typeof value.authTokenPath !== "string" || typeof value.privateKeyPath !== "string" || typeof value.verifier !== "string" || !address(value.verifier) ||
      !Array.isArray(value.allowedPolicies) || !value.allowedPolicies.length) throw new Error("INVALID_SIGNER_CONFIG");
  for (const p of value.allowedPolicies) {
    if (!p || typeof p !== "object" || Array.isArray(p) || !exact(p,["escrowChainId","escrowContract","validationPolicyId"]) ||
        typeof p.escrowChainId !== "string" || !decimal(p.escrowChainId) || typeof p.escrowContract !== "string" || !address(p.escrowContract) || typeof p.validationPolicyId !== "string" || !hash(p.validationPolicyId)) throw new Error("INVALID_SIGNER_CONFIG");
    try { if (parseUint256(p.escrowChainId) === 0n) throw new Error(); } catch { throw new Error("INVALID_SIGNER_CONFIG"); }
  }
  return value as SignerConfig;
}

if (import.meta.main) {
  const path = process.env.VALIDATION_SIGNER_CONFIG_PATH;
  if (!path) throw new Error("SIGNER_CONFIG_REQUIRED");
  const config = loadConfig(readFileSync(path));
  const token = readFileSync(config.authTokenPath);
  if (token.length < 64 || token.length > 256 || /[^0-9a-f]/.test(token.toString("utf8")) || !Buffer.from(token.toString("utf8")).equals(token)) throw new Error("INVALID_SIGNER_TOKEN");
  const key = readFileSync(config.privateKeyPath,"utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("INVALID_SIGNER_KEY");
  let account: ReturnType<typeof privateKeyToAccount>;
  try { account = privateKeyToAccount(key as Hex); } catch { throw new Error("INVALID_SIGNER_KEY"); }
  if (account.address.toLowerCase() !== config.verifier) throw new Error("VERIFIER_MISMATCH");
  const server = createServer((req,res) => {
    const reject = () => { if (!res.headersSent) res.writeHead(400); res.end(); };
    const timer = setTimeout(() => req.destroy(),5000);
    req.on("close",() => clearTimeout(timer));
    req.on("error",() => {});
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (req.method !== "POST" || req.url !== "/sign" || supplied.length !== token.length || !timingSafeEqual(supplied,token)) { res.setHeader("connection","close"); reject(); res.on("finish",() => req.socket.destroy()); return; }
    const chunks: Buffer[] = []; let size = 0;
    req.on("data",(chunk: Buffer) => { size += chunk.length; if (size > 8192) req.destroy(); else chunks.push(chunk); });
    req.on("end",async () => {
      try {
        const body = parseStrictJSON(Buffer.concat(chunks));
        if (!body || typeof body !== "object" || Array.isArray(body) || !exact(body,["schemaVersion","attestation"]) || body.schemaVersion !== "unmet-validation-sign-v1" || !validateAttestation(body.attestation)) return reject();
        const a = body.attestation;
        if (![a.escrowChainId,a.demandId,a.submissionNonce,a.issuedAt,a.expiresAt].every(decimal) || !address(a.verifyingContract) || !address(a.builderWallet) || ![a.serviceUrlHash,a.evidenceHash,a.paymentRequirementsHash,a.validationPolicyId].every(hash)) return reject();
        for (const n of [a.escrowChainId,a.demandId,a.submissionNonce,a.issuedAt,a.expiresAt]) parseUint256(n);
        if (BigInt(a.issuedAt) > 2n ** 64n - 1n || BigInt(a.expiresAt) > 2n ** 64n - 1n || !validTime(BigInt(a.issuedAt),BigInt(a.expiresAt),BigInt(Math.floor(Date.now()/1000))) ||
            !config.allowedPolicies.some(p => p.escrowChainId === a.escrowChainId && p.escrowContract === a.verifyingContract && p.validationPolicyId === a.validationPolicyId)) return reject();
        const signature = await account.signTypedData({domain:domain(a.escrowChainId,a.verifyingContract),types:attestationTypes,primaryType:"ValidationAttestation",message:attestationMessage(a)});
        res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({verifier:config.verifier,signature}));
      } catch { reject(); }
    });
  });
  server.listen(config.socketPath);
  for (const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,() => server.close(() => process.exit(0)));
}
