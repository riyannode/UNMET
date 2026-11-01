import { expect, test } from "bun:test";
import { formatEscrowAmount, parseEscrowAmount } from "../../shared/deployment";
import { SERVICE_PRICE_ASSET, SERVICE_PRICE_SYMBOL, formatServicePrice, parseServicePrice } from "../../shared/service-price";

test("Mainnet USDC service price keeps its own asset identity and precision", () => {
  expect(SERVICE_PRICE_ASSET).toEqual({ network: "eip155:196", asset: "0xb6ceceab302e2e4948951ee7843fc24e92933061", decimals: 6 });
  expect(SERVICE_PRICE_SYMBOL).toBe("USDC");
  expect(SERVICE_PRICE_ASSET.asset).not.toBe("0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d");
  expect(parseServicePrice("0.000001")).toBe(1n);
  expect(formatServicePrice(1234567n)).toBe("1.234567");
  expect(() => parseServicePrice("0.0000001")).toThrow();
});

test("service-price arithmetic is independent of a differently scaled escrow token", () => {
  expect(parseEscrowAmount("1.23", 2)).toBe(123n);
  expect(parseServicePrice("1.23")).toBe(1230000n);
  expect(formatEscrowAmount(123n, 2)).toBe("1.23");
  expect(formatServicePrice(123n)).toBe("0.000123");
});

test("create prompts parse service prices independently from escrow precision", () => {
  const module = new URL("../create-demand-chat-model.ts", import.meta.url).pathname;
  const code = `const {parseMaximumPriceAnswer,parseCommitmentAnswer,formatPriceUsage}=await import(${JSON.stringify(module)});if(parseMaximumPriceAnswer('0.000001 USDC')!=='0.000001'||formatPriceUsage('0.000001','1')!=='0.000001 USDC per call; 1 calls total')process.exit(1);try{parseCommitmentAnswer('0.000001');process.exit(2)}catch{}`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, VITE_PAYMENT_TOKEN_DECIMALS: "2", VITE_PAYMENT_TOKEN_SYMBOL: "ESCROW" }, stdout: "pipe", stderr: "pipe" });
  expect(child.exitCode).toBe(0);
});
