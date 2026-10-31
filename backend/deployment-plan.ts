import { getAddress, type Address } from "viem";

type Env = Record<string, string | undefined>;
export type DeploymentPlan = { token: Address; treasury: Address; feeBps: bigint; quorumBps: bigint; minCommitment: bigint; reviewPeriod: bigint; verifier: Address; verifierAdmin: Address };

export function deploymentPlan(env: Env): DeploymentPlan {
  const address = (key: string): Address => {
    try { const value = getAddress(env[key] || ""); if (/^0x0{40}$/i.test(value)) throw new Error(); return value; }
    catch { throw new Error(`CONFIG_INVALID: ${key}`); }
  };
  const integer = (key: string, min: bigint, max: bigint): bigint => {
    const value = env[key];
    if (!value || !/^\d+$/.test(value)) throw new Error(`CONFIG_INVALID: ${key}`);
    const parsed = BigInt(value);
    if (parsed < min || parsed > max) throw new Error(`CONFIG_INVALID: ${key}`);
    return parsed;
  };
  return { token: address("PAYMENT_TOKEN"), treasury: address("DEMAND_TREASURY"), feeBps: integer("DEMAND_FEE_BPS", 0n, 1000n), quorumBps: integer("DEMAND_QUORUM_BPS", 5001n, 10000n), minCommitment: integer("DEMAND_MIN_COMMITMENT", 1n, (1n << 96n) - 1n), reviewPeriod: integer("DEMAND_REVIEW_PERIOD", 3600n, 604800n), verifier: address("DEMAND_VERIFIER"), verifierAdmin: address("DEMAND_VERIFIER_ADMIN") };
}
