import { MAINNET_ASSETS } from "./payment-identity.ts";
import { parseUnits6 } from "./contract.ts";
import type { Address } from "viem";

type X402PaymentEnv = {
  NODE_ENV?: string;
  X402_CHAIN_ID?: string;
  OPPORTUNITY_PRICE?: string;
};

export function resolveX402PaymentConfig(env: X402PaymentEnv = process.env, coreChainId = 1952) {
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && env.X402_CHAIN_ID !== "196") {
    throw new Error("X402_CHAIN_ID must be explicitly set to 196 in production");
  }
  const x402ChainId = env.X402_CHAIN_ID ?? String(coreChainId);
  if (x402ChainId !== "1952" && x402ChainId !== "196") throw new Error("X402_CHAIN_ID must be 1952 or 196");
  const priceRaw = env.OPPORTUNITY_PRICE || "0.01";
  if (!/^\d+(\.\d{1,6})?$/.test(priceRaw)) throw new Error("OPPORTUNITY_PRICE must be a decimal amount with <=6 decimals");
  const priceAmount = parseUnits6(priceRaw);
  if (x402ChainId === "196" && priceAmount !== parseUnits6("0.01")) throw new Error("CONFIG_INVALID: OPPORTUNITY_PRICE");
  return {
    network: `eip155:${x402ChainId}` as `eip155:${number}`,
    assets: x402ChainId === "196" ? MAINNET_ASSETS.map(({ asset, name, version }) => ({ asset, extra: { name, version } })) : null,
    price: `$${priceRaw}`,
  };
}

export function opportunityPaymentOptions(pay: ReturnType<typeof resolveX402PaymentConfig>, payTo: Address) {
  return pay.assets ? pay.assets.map(({ asset, extra }) => ({
    scheme: "exact" as const, network: pay.network, payTo,
    price: { asset, amount: parseUnits6(pay.price.slice(1)).toString(), extra },
  })) : [{ scheme: "exact" as const, network: pay.network, payTo, price: pay.price }];
}
