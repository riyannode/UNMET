export const ROUTES = {
  landing: { path: "/", href: "/" },
  docs: { href: "/docs" },
  market: { path: "market", href: "/market" },
  demandDetail: { path: "market/:demandId", href: "/market/:demandId" },
  createDemand: { path: "create-demand", href: "/create-demand" },
  analytics: { path: "analytics", href: "/analytics" },
} as const;

export function demandHref(demandId: bigint): string {
  return ROUTES.market.href + "/" + demandId.toString();
}

export function parseDemandId(value: string | undefined): bigint | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const demandId = BigInt(value);
  return demandId < 1n << 256n ? demandId : null;
}
