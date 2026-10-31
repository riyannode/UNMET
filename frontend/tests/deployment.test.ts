import { describe, expect, test } from "bun:test";
import { deploymentKey, formatEscrowAmount, parseEscrowAmount, verifyDeployment, type EscrowDeployment } from "../../shared/deployment";

const deployment: EscrowDeployment = {
  chainId: 1952, contract: "0x1111111111111111111111111111111111111111", rpcUrl: "https://example.test", deployBlock: 0n,
  chain: { name: "Test", explorerUrl: "https://example.test", nativeCurrency: { name: "Test", symbol: "T", decimals: 18 } },
  escrowToken: { address: "0x2222222222222222222222222222222222222222", symbol: "USDC", decimals: 6 },
};
const client = {
  getChainId: async () => 1952,
  getBytecode: async () => "0x01" as const,
  getToken: async () => deployment.escrowToken.address,
  getDecimals: async () => 6,
};

describe("deployment primitives", () => {
  test("keys isolate same-chain contracts and reject invalid identities", () => {
    expect(deploymentKey(1952, deployment.contract)).not.toBe(deploymentKey(1952, deployment.escrowToken.address));
    expect(() => deploymentKey(1952, `0x${"0".repeat(40)}`)).toThrow();
    expect(() => deploymentKey(0, deployment.contract)).toThrow();
  });
  test("uses exact configured decimals without rounding", () => {
    expect(parseEscrowAmount("1.234567", 6)).toBe(1234567n);
    expect(formatEscrowAmount(1234567n, 6)).toBe("1.234567");
    expect(parseEscrowAmount("1.23456789", 8)).toBe(123456789n);
    expect(formatEscrowAmount(123456789n, 8)).toBe("1.23456789");
    expect(() => parseEscrowAmount("1.0000001", 6)).toThrow();
  });
  test("rejects chain, bytecode, token and decimals mismatches", async () => {
    await verifyDeployment(client, deployment);
    await expect(verifyDeployment({ ...client, getChainId: async () => 196 }, deployment)).rejects.toThrow("DEPLOYMENT_CHAIN_MISMATCH");
    await expect(verifyDeployment({ ...client, getBytecode: async () => "0x" }, deployment)).rejects.toThrow("DEPLOYMENT_NO_CODE");
    await expect(verifyDeployment({ ...client, getToken: async () => deployment.contract }, deployment)).rejects.toThrow("DEPLOYMENT_TOKEN_MISMATCH");
    await expect(verifyDeployment({ ...client, getDecimals: async () => 18 }, deployment)).rejects.toThrow("DEPLOYMENT_DECIMALS_MISMATCH");
  });
});
