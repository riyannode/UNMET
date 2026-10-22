import { describe, expect, test } from "bun:test";
import { afterConfirmedTransaction, deriveMarketRequests, readSupportForIdentity, settleBoardRead, settleSupportRead } from "../app-state";
import { effectiveStatus, type DemandView } from "../contract";

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

describe("Market request derivation", () => {
  test("searches trimmed capability text case-insensitively and matches exact IDs with an optional hash", () => {
    const board = [
      { demandId: 12n, committed: 1n, capability: "Oracle Adapter", status: "READY" },
      { demandId: 123n, committed: 1n, capability: "Kernel Service", status: "OPEN" },
      { demandId: 5n, committed: 1n, capability: "Payment Router", status: "READY" },
    ];
    const derive = (search: string) => deriveMarketRequests(
      board,
      { search, status: "ALL", sort: "most-funded" },
      (demand) => demand.status,
    ).requests.map((demand) => demand.demandId);

    expect(derive("  oRaClE  ")).toEqual([12n]);
    expect(derive("#12")).toEqual([12n]);
    expect(derive("12")).toEqual([12n]);
    expect(derive(" ")).toEqual([123n, 12n, 5n]);
    expect(derive("#1")).toEqual([]);
  });

  test("combines effective status and search while counting the full board", () => {
    const makeDemand = (demandId: bigint, overrides: Partial<DemandView> = {}): DemandView => ({
      demandId,
      creator: "0x0000000000000000000000000000000000000001",
      builder: "0x0000000000000000000000000000000000000002",
      maxUnitPrice: 2_000_000n,
      committed: 5_000_000n,
      reviewCommitted: 0n,
      approvalRequired: 0n,
      expectedCalls: 1000n,
      deadline: 2_000n,
      reviewEndsAt: 3_000n,
      supporterCount: 2,
      status: 0,
      capability: "Oracle Adapter",
      specification: "",
      serviceUrl: "",
      evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      approvalWeight: 0n,
      quorumReached: false,
      rejectionWeight: 0n,
      rejectionThreshold: 0n,
      candidateRejected: false,
      ...overrides,
    });
    const board = [
      makeDemand(12n, { status: 1, capability: "Oracle Adapter", quorumReached: true }),
      makeDemand(13n, { status: 0, capability: "Oracle Runtime" }),
      makeDemand(14n, { status: 1, capability: "Oracle Rejected", candidateRejected: true }),
      makeDemand(15n, { status: 0, capability: "Expired Connector", deadline: 999n }),
    ];
    const now = 1_000n;
    const result = deriveMarketRequests(
      board,
      { search: "oracle", status: "READY", sort: "most-funded" },
      (demand) => effectiveStatus(demand, now),
    );

    expect(result.requests.map((demand) => demand.demandId)).toEqual([12n]);
    expect([...result.statusCounts]).toEqual([
      ["READY", 1],
      ["OPEN", 1],
      ["REJECTED", 1],
      ["EXPIRED", 1],
    ]);
    expect(effectiveStatus(makeDemand(16n), now)).toBe("OPEN");
  });

  test("sorts bigint escrow and IDs without mutating the board", () => {
    const board = [
      { demandId: 2n, committed: 10n, capability: "Second", status: "OPEN" },
      { demandId: 10n, committed: 10n, capability: "Tenth", status: "OPEN" },
      { demandId: 3n, committed: 9_007_199_254_740_993n, capability: "High", status: "OPEN" },
      { demandId: 1n, committed: 1n, capability: "Low", status: "OPEN" },
    ];
    const idsFor = (sort: "most-funded" | "least-funded" | "latest-id" | "earliest-id") => deriveMarketRequests(
      board,
      { search: "", status: "ALL", sort },
      (demand) => demand.status,
    ).requests.map((demand) => demand.demandId);

    expect(idsFor("most-funded")).toEqual([3n, 10n, 2n, 1n]);
    expect(idsFor("least-funded")).toEqual([1n, 10n, 2n, 3n]);
    expect(idsFor("latest-id")).toEqual([10n, 3n, 2n, 1n]);
    expect(idsFor("earliest-id")).toEqual([1n, 2n, 3n, 10n]);
    expect(board.map((demand) => demand.demandId)).toEqual([2n, 10n, 3n, 1n]);
  });
});
