import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveX402PaymentConfig } from "./payment-config.ts";
import { paymentDiscovery, validatePaymentDiscovery } from "./payment-discovery.ts";

const specPath = fileURLToPath(new URL("../frontend/public/openapi.json", import.meta.url));
const env: Record<string, string | undefined> = { ...process.env, X402_CHAIN_ID: process.env.X402_CHAIN_ID ?? "196" };
const pay = resolveX402PaymentConfig(env, Number(process.env.CHAIN_ID ?? "1952"));
const openapi = JSON.parse(await readFile(specPath, "utf8")) as { paths: Record<string, { post?: Record<string, unknown> }> };
const operation = openapi.paths["/v1/opportunities"]?.post;
if (!operation) throw new Error("OpenAPI POST /v1/opportunities is missing");
if (process.argv.includes("--write")) {
  const source = await readFile(specPath, "utf8");
  const line = /^        "x-payment-info": .*,$/m;
  if (!line.test(source)) throw new Error("OpenAPI x-payment-info line is missing");
  const next = source.replace(line, `        "x-payment-info": ${JSON.stringify(await paymentDiscovery(pay))},`);
  await writeFile(specPath, next);
  console.log(`Updated ${specPath}`);
} else {
  await validatePaymentDiscovery(operation["x-payment-info"], pay);
  console.log(`OpenAPI payment discovery matches ${pay.network} at ${pay.price}.`);
}
