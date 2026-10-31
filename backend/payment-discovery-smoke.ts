import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import openapi from "../frontend/public/openapi.json";

assert.equal(process.getuid?.() === 0, false, "API smoke must run as a non-root user");
assert.equal(execFileSync("id", ["-un"], { encoding: "utf8" }).trim(), "bun");
if (["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"].some((name) => process.env[name])) {
  throw new Error("API payment discovery smoke must not receive facilitator credentials");
}

process.env.NODE_ENV = "production";
process.env.XLAYER_RPC_URL = "http://127.0.0.1:8545";
process.env.CHAIN_ID = "1952";
process.env.DEMAND_CONTRACT = "0x3333333333333333333333333333333333333333";
process.env.PAYMENT_TOKEN = "0x4444444444444444444444444444444444444444";
process.env.PAYMENT_TOKEN_DECIMALS = "6";
process.env.X402_CHAIN_ID = "196";
const storageDirectory = mkdtempSync(join(tmpdir(), "payment-discovery-smoke-"));
const databasePath = join(storageDirectory, "payments.sqlite");
process.env.PAYMENT_DB_PATH = databasePath;

const originalFetch = globalThis.fetch;
let facilitatorContacts = 0;
Reflect.set(globalThis, "fetch", async (..._args: Parameters<typeof fetch>) => {
  facilitatorContacts++;
  throw new Error("Unexpected facilitator network call in offline API smoke");
});

const noStorageSideEffect = () => assert.deepEqual(readdirSync(storageDirectory), []);
const operation = openapi.paths["/v1/opportunities"].post;
const original = structuredClone(operation["x-payment-info"]);

try {
  noStorageSideEffect();
  const { assertPublishedPaymentDiscovery, paymentDiscovery, validatePaymentDiscovery } = await import("./payment-discovery.ts");
  const { createPaymentMiddleware, resolveX402PaymentConfig } = await import("./server.ts");
  const profile = resolveX402PaymentConfig(process.env, 1952);
  const packaged = JSON.parse(readFileSync("/app/frontend/public/openapi.json", "utf8"));
  assert.deepEqual(packaged, openapi, "packaged OpenAPI file must match the imported discovery document");
  await validatePaymentDiscovery(openapi.paths["/v1/opportunities"].post["x-payment-info"], profile);
  await assertPublishedPaymentDiscovery(profile);
  assert.deepEqual(openapi.paths["/v1/opportunities"].post["x-payment-info"], await paymentDiscovery(profile));

  const mismatches: Array<(metadata: typeof original) => void> = [
    (metadata) => { Reflect.set(metadata.protocols[0].x402.accepts[0], "network", "eip155:1"); },
    (metadata) => { Reflect.set(metadata.protocols[0].x402.accepts[0], "scheme", "transfer"); },
    (metadata) => { Reflect.set(metadata.protocols[0].x402.accepts[0], "asset", "0x0000000000000000000000000000000000000001"); },
    (metadata) => { Reflect.set(metadata.price, "amount", "0.02"); },
  ];
  for (const mutate of mismatches) {
    const metadata = structuredClone(original);
    mutate(metadata);
    Reflect.set(operation, "x-payment-info", metadata);
    await assert.rejects(createPaymentMiddleware(), { message: "CONFIG_INVALID: PAYMENT_DISCOVERY" });
    assert.equal(facilitatorContacts, 0);
    noStorageSideEffect();
  }
  Reflect.set(operation, "x-payment-info", original);

  process.env.X402_CHAIN_ID = "1";
  await assert.rejects(createPaymentMiddleware(), { message: "X402_CHAIN_ID must be explicitly set to 196 in production" });
  assert.equal(facilitatorContacts, 0);
  noStorageSideEffect();

  process.env.NODE_ENV = "test";
  await assert.rejects(createPaymentMiddleware(), { message: "X402_CHAIN_ID must be 1952 or 196" });
  assert.equal(facilitatorContacts, 0);
  noStorageSideEffect();
} finally {
  Reflect.set(operation, "x-payment-info", original);
  Reflect.set(globalThis, "fetch", originalFetch);
  rmSync(storageDirectory, { recursive: true });
}

console.log("Packaged API payment discovery is readable and mismatches fail closed without storage writes or facilitator calls.");
