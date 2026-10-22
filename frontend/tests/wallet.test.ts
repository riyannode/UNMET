import { afterEach, describe, expect, test } from "bun:test";
import { currentChainId, currentWallet, setReownWalletProvider, walletClient } from "../contract";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  setReownWalletProvider(null);
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("Reown wallet source", () => {
  test("does not fall back to window.ethereum when Reown has no provider", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        ethereum: {
          request: async ({ method }: { method: string }) =>
            method === "eth_accounts" ? ["0x0000000000000000000000000000000000000001"] : "0x7a0",
        },
      },
    });

    expect(await currentWallet()).toBeNull();
    expect(await currentChainId()).toBeNull();
    expect(() => walletClient()).toThrow("WALLET_NOT_FOUND");
  });

  test("uses the provider supplied by Reown", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    const requested: string[] = [];
    setReownWalletProvider({
      request: async ({ method }: { method: string }) => {
        requested.push(method);
        if (method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0x7a0";
        return null;
      },
    });

    expect(await currentWallet()).toBe(address);
    expect(await currentChainId()).toBe(1952);
    expect(requested).toEqual(["eth_accounts", "eth_chainId"]);
  });
});
