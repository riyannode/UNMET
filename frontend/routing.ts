export const ROUTES = {
  landing: { path: "/", href: "/" },
  docs: { href: "/docs" },
  market: { path: "market", href: "/market" },
  demandDetail: { path: "market/:chainId/:contract/:demandId", href: "/market/:chainId/:contract/:demandId" },
  createDemand: { path: "create-demand", href: "/create-demand" },
  analytics: { path: "analytics", href: "/analytics" },
} as const;

export function demandHref(chainId: number, contract: string, demandId: bigint): string {
  const identity = parseDemandRoute(String(chainId), contract, demandId.toString());
  if (!identity) throw new Error("DEMAND_ROUTE_INVALID");
  return `${ROUTES.market.href}/${identity.chainId}/${identity.contract}/${identity.demandId}`;
}

export function parseDemandRoute(chain: string | undefined, contract: string | undefined, id: string | undefined) {
  if (!chain || !/^[1-9][0-9]*$/.test(chain) || !Number.isSafeInteger(Number(chain))) return null;
  if (!contract || !/^0x[0-9a-f]{40}$/i.test(contract) || /^0x0{40}$/i.test(contract)) return null;
  const demandId = parseDemandId(id);
  return demandId === null ? null : { chainId: Number(chain), contract: contract.toLowerCase(), demandId };
}

export function parseDemandId(value: string | undefined): bigint | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const demandId = BigInt(value);
  return demandId < 1n << 256n ? demandId : null;
}
