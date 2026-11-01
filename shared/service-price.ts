import { formatEscrowAmount, parseEscrowAmount } from "./deployment";

export type ServicePriceAsset = { network: string; asset: string; decimals: number };

export const SERVICE_PRICE_ASSET = {
  network: "eip155:196",
  asset: "0xb6ceceab302e2e4948951ee7843fc24e92933061",
  decimals: 6,
} as const satisfies ServicePriceAsset;
export const SERVICE_PRICE_SYMBOL = "USDC";

export function formatServicePrice(value: bigint): string {
  return formatEscrowAmount(value, SERVICE_PRICE_ASSET.decimals);
}

export function parseServicePrice(value: string): bigint {
  return parseEscrowAmount(value, SERVICE_PRICE_ASSET.decimals);
}
