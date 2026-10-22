import { describe, expect, test } from "bun:test";
import { afterConfirmedTransaction, readSupportForIdentity, settleBoardRead, settleSupportRead } from "../app-state";

describe("board read status", () => {
  test("clears only the board error after a successful retry", () => {
    const failed = settleBoardRead(
      { actionStatus: "Support success", boardError: "RPC offline" },
      { kind: "error", message: "RPC offline" },
    );
    expect(settleBoardRead(failed, { kind: "success" })).toEqual({
      actionStatus: "Support success",
      boardError: "",
    });
  });
});

describe("support read identity", () => {
  test("clears only support errors after loading or a successful retry", () => {
    const failed = settleSupportRead(
      { actionStatus: "Support success", boardError: "Board RPC offline", supportError: "Position RPC offline" },
      { kind: "error", message: "Position RPC offline" },
    );
    expect(settleSupportRead(failed, { kind: "loading" })).toEqual({
      actionStatus: "Support success",
      boardError: "Board RPC offline",
      supportError: "",
    });
    const retryFailed = settleSupportRead(failed, { kind: "loading" });
    expect(settleSupportRead(retryFailed, { kind: "success" })).toEqual({
      actionStatus: "Support success",
      boardError: "Board RPC offline",
      supportError: "",
    });
  });

  test("returns current data and surfaces current read failures", async () => {
    await expect(readSupportForIdentity("alice:1", async () => "position", (key) => key === "alice:1"))
      .resolves.toEqual({ kind: "ready", value: "position" });
    await expect(readSupportForIdentity("alice:1", async () => { throw new Error("RPC offline"); }, (key) => key === "alice:1"))
      .resolves.toMatchObject({ kind: "error", error: new Error("RPC offline") });
  });

  test("discards success or failure from an old demand/account identity", async () => {
    let currentIdentity = "alice:1";
    let resolveRead!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveRead = resolve; });
    const staleSuccess = readSupportForIdentity("alice:1", () => pending, (key) => key === currentIdentity);
    currentIdentity = "bob:2";
    resolveRead("stale position");
    await expect(staleSuccess).resolves.toEqual({ kind: "stale" });

    currentIdentity = "alice:1";
    const staleFailure = readSupportForIdentity("alice:1", async () => { throw new Error("old RPC error"); }, (key) => key === currentIdentity);
    currentIdentity = "bob:2";
    await expect(staleFailure).resolves.toEqual({ kind: "stale" });
  });
});

describe("confirmed transaction readback", () => {
  test("refreshes board and support once after receipt, even when board readback fails", async () => {
    let receipt: string | null = null;
    let boardReads = 0;
    let supportReads = 0;
    const result = await afterConfirmedTransaction(
      async () => "0xconfirmed",
      (hash) => { receipt = hash; },
      async () => { boardReads += 1; return false; },
      async () => { supportReads += 1; return { kind: "ready" as const, value: "position" }; },
    );

    expect(receipt).toBe("0xconfirmed");
    expect(boardReads).toBe(1);
    expect(supportReads).toBe(1);
    expect(result).toEqual({ boardReadbackSucceeded: false, supportReadback: { kind: "ready", value: "position" } });
  });

  test("does not read state when the transaction fails before a successful receipt", async () => {
    let boardReads = 0;
    let supportReads = 0;
    await expect(afterConfirmedTransaction(
      async () => { throw new Error("CHAIN_RECEIPT_FAILED"); },
      () => undefined,
      async () => { boardReads += 1; return true; },
      async () => { supportReads += 1; return null; },
    )).rejects.toThrow("CHAIN_RECEIPT_FAILED");
    expect(boardReads).toBe(0);
    expect(supportReads).toBe(0);
  });
});
