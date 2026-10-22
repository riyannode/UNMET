export const ROUTES = {
  landing: { path: "/", href: "/" },
  market: { path: "market", href: "/market" },
  demandDetail: { path: "market/:demandId", href: "/market/:demandId" },
  createDemand: { path: "create-demand", href: "/create-demand" },
  myActivity: { path: "my-activity", href: "/my-activity" },
} as const;

export function demandHref(demandId: bigint): string {
  return ROUTES.market.href + "/" + demandId.toString();
}

export function parseDemandId(value: string | undefined): bigint | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const demandId = BigInt(value);
  return demandId < 1n << 256n ? demandId : null;
}
