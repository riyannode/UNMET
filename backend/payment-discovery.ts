import openapi from "../frontend/public/openapi.json";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { canonical } from "./payment-identity.ts";
import { opportunityPaymentOptions, type resolveX402PaymentConfig } from "./payment-config.ts";
import { formatUnits6, parseUnits6 } from "./contract.ts";
import type { PaymentRequirements } from "@okxweb3/x402-core/types";

type PaymentConfig = ReturnType<typeof resolveX402PaymentConfig>;
type PaymentAccept = Pick<PaymentRequirements, "scheme" | "network" | "asset" | "amount" | "extra">;

export async function paymentDiscovery(pay: PaymentConfig): Promise<{
  price: { mode: "fixed"; currency: "USD"; amount: string };
  protocols: Array<{ x402: { version: 2; accepts: PaymentAccept[] } }>;
}> {
  const price = pay.price.slice(1);
  const amount = formatUnits6(parseUnits6(price)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const options = opportunityPaymentOptions(pay, "0x0000000000000000000000000000000000000001");
  const parser = new ExactEvmScheme();
  const accepts = await Promise.all(options.map(async (option) => {
    const price = typeof option.price === "string" ? await parser.parsePrice(option.price, option.network) : option.price;
    return {
      scheme: option.scheme,
      network: option.network,
      asset: price.asset,
      amount: price.amount,
      extra: price.extra ?? {},
    };
  }));
  return {
    price: { mode: "fixed", currency: "USD", amount },
    protocols: [{ x402: { version: 2, accepts } }],
  };
}

export async function validatePaymentDiscovery(published: unknown, pay: PaymentConfig) {
  if (canonical(published) !== canonical(await paymentDiscovery(pay))) {
    throw new Error("CONFIG_INVALID: PAYMENT_DISCOVERY");
  }
}

export async function assertPublishedPaymentDiscovery(pay: PaymentConfig) {
  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (path !== "/v1/opportunities" || method !== "post") {
        if ("x-payment-info" in operation) throw new Error("CONFIG_INVALID: PAYMENT_DISCOVERY");
      }
    }
  }
  try {
    await validatePaymentDiscovery(openapi.paths["/v1/opportunities"].post["x-payment-info"], pay);
  } catch {
    throw new Error("CONFIG_INVALID: PAYMENT_DISCOVERY");
  }
}
