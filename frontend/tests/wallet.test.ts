import { afterEach, describe, expect, test } from "bun:test";
import { currentChainId, currentWallet, setReownWalletProvider, walletClient } from "../contract";
import { reownButtonLabel, resolveReownStatus, runDisconnectRequest } from "../reown-status";

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

describe("Reown initialization state", () => {
  test("distinguishes configured but not-yet-loaded AppKit from unavailable Reown", () => {
    const status = resolveReownStatus(true, false, false);
    expect(status).toBe("initializing");
    expect(reownButtonLabel(status)).toBe("Initializing Reown\u2026");
  });

  test("reports unavailable only without configuration or after load failure", () => {
    expect(resolveReownStatus(false, false, false)).toBe("unavailable");
    expect(resolveReownStatus(true, true, false)).toBe("unavailable");
    expect(reownButtonLabel("unavailable")).toBe("Reown Unavailable");
  });

  test("uses the connect or account label only when AppKit is ready", () => {
    const status = resolveReownStatus(true, true, true);
    expect(status).toBe("ready");
    expect(reownButtonLabel(status)).toBe("Connect wallet");
    expect(reownButtonLabel(status, "0x1234\u2026abcd")).toBe("0x1234\u2026abcd");
  });
});

describe("Reown disconnect request", () => {
  test("shows pending synchronously and ignores duplicate requests", async () => {
    const lock = { current: false };
    const events: string[] = [];
    let requestCount = 0;
    let resolveRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => { resolveRequest = resolve; });

    const first = runDisconnectRequest(
      lock,
      () => events.push("start"),
      () => { requestCount += 1; return request; },
      () => events.push("finish"),
    );

    expect(lock.current).toBe(true);
    expect(events).toEqual(["start"]);
    expect(await runDisconnectRequest(lock, () => events.push("duplicate-start"), async () => {
      requestCount += 1;
    }, () => events.push("duplicate-finish"))).toBe(false);
    expect(requestCount).toBe(1);

    resolveRequest?.();
    expect(await first).toBe(true);
    expect(lock.current).toBe(false);
    expect(events).toEqual(["start", "finish"]);
  });

  test("releases the duplicate-request guard after a failed request", async () => {
    const lock = { current: false };
    const events: string[] = [];

    await expect(runDisconnectRequest(
      lock,
      () => events.push("start"),
      async () => { throw new Error("disconnect failed"); },
      () => events.push("finish"),
    )).rejects.toThrow("disconnect failed");

    expect(lock.current).toBe(false);
    expect(events).toEqual(["start", "finish"]);
  });
});
