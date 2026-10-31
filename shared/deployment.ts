type Address = `0x${string}`;

export type EscrowDeployment = {
  chainId: number;
  contract: Address;
  rpcUrl: string;
  deployBlock: bigint;
  chain: {
    name: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  escrowToken: { address: Address; symbol: string; decimals: number };
};

export function deploymentKey(chainId: number, contract: string): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[0-9a-f]{40}$/i.test(contract) || /^0x0{40}$/i.test(contract)) throw new Error("DEPLOYMENT_INVALID");
  return `${chainId}:${contract.toLowerCase()}`;
}

export function validateDeployment(deployment: EscrowDeployment): EscrowDeployment {
  deploymentKey(deployment.chainId, deployment.contract);
  if (!/^0x[0-9a-f]{40}$/i.test(deployment.escrowToken.address) || /^0x0{40}$/i.test(deployment.escrowToken.address)
      || !deployment.escrowToken.symbol.trim() || !Number.isInteger(deployment.escrowToken.decimals)
      || deployment.escrowToken.decimals < 0 || deployment.escrowToken.decimals > 255
      || deployment.deployBlock < 0n || !deployment.chain.name.trim() || !deployment.chain.nativeCurrency.name.trim()
      || !deployment.chain.nativeCurrency.symbol.trim() || !Number.isInteger(deployment.chain.nativeCurrency.decimals)
      || deployment.chain.nativeCurrency.decimals < 0 || deployment.chain.nativeCurrency.decimals > 255) throw new Error("DEPLOYMENT_INVALID");
  for (const value of [deployment.rpcUrl, deployment.chain.explorerUrl]) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("DEPLOYMENT_INVALID"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("DEPLOYMENT_INVALID");
  }
  return deployment;
}

export function parseEscrowAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("AMOUNT_INVALID");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) throw new Error("AMOUNT_INVALID");
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

export function formatEscrowAmount(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("AMOUNT_INVALID");
  const sign = value < 0n ? "-" : "";
  const amount = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  if (decimals === 0) return `${sign}${amount}`;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${amount / scale}${fraction ? `.${fraction}` : ""}`;
}

export async function verifyDeployment(client: {
  getChainId(): Promise<number>;
  getBytecode(address: Address): Promise<`0x${string}` | undefined>;
  getToken(address: Address): Promise<Address>;
  getDecimals(address: Address): Promise<number>;
}, deployment: EscrowDeployment): Promise<void> {
  validateDeployment(deployment);
  if (await client.getChainId() !== deployment.chainId) throw new Error("DEPLOYMENT_CHAIN_MISMATCH");
  const code = await client.getBytecode(deployment.contract);
  if (!code || code === "0x") throw new Error("DEPLOYMENT_NO_CODE");
  const token = await client.getToken(deployment.contract);
  if (token.toLowerCase() !== deployment.escrowToken.address.toLowerCase()) throw new Error("DEPLOYMENT_TOKEN_MISMATCH");
  const decimals = await client.getDecimals(deployment.escrowToken.address);
  if (decimals !== deployment.escrowToken.decimals) throw new Error("DEPLOYMENT_DECIMALS_MISMATCH");
}
