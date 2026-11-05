import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ActivityStore, type ActivityEvent } from "./activity-store.ts";

const deployment = { chainId: "1952", contract: "0x" + "1".repeat(40), escrowToken: "0x" + "2".repeat(40), tokenDecimals: 6, deployBlock: "10" };
const anchor = (number: string) => ({ blockNumber: number, blockHash: "0x" + "a".repeat(64), timestamp: "1000" });
function event(index: string, block = "10"): ActivityEvent {
  const payload = '{"amount":"100"}';
  return { chainId: deployment.chainId, contract: deployment.contract, transactionHash: "0x" + "b".repeat(64), logIndex: index,
    blockNumber: block, blockHash: "0x" + "a".repeat(64), transactionIndex: "0", blockTimestamp: "1000",
    eventName: "DemandSupported", demandId: "1", payload, payloadHash: createHash("sha256").update(payload).digest("hex") };
}
function fixture(run: (store: ActivityStore, path: string) => void, max = 100) {
  const dir = mkdtempSync(tmpdir() + "/unmet-activity-"), path = dir + "/activity.sqlite";
  const store = new ActivityStore(path, deployment, max);
  try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true }); }
}
function target(store: ActivityStore, end = "20") {
  store.updateState(store.state().nextBlock, (state) => ({ ...state, startAnchor: anchor("10"), target: anchor(end), coverageStatus: "unavailable", coverageReason: "BACKFILL_INCOMPLETE" }));
}

test("private WAL database initializes only two tables and pins deployment", () => {
  fixture((store, path) => {
    store.integrity();
    const db = new Database(path);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)).toEqual(["activity_events", "activity_state"]);
    db.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => new ActivityStore(path, { ...deployment, deployBlock: "11" })).toThrow("ACTIVITY_DEPLOYMENT_MISMATCH");
  });
});

test("page commits atomically, rejects conflicting duplicates and preserves exact numeric order", () => {
  fixture((store) => {
    target(store);
    const first = event("2");
    expect(() => store.commitPage("10", anchor("10"), [first, { ...first, blockHash: "0x" + "c".repeat(64) }])).toThrow("ACTIVITY_EVENT_CONFLICT");
    expect(store.events()).toEqual([]);
    expect(store.state().nextBlock).toBe("10");
    store.commitPage("10", anchor("10"), [event("10"), first, first]);
    expect(store.events().map((row) => row.logIndex)).toEqual(["2", "10"]);
    expect(store.state().nextBlock).toBe("11");
    expect(store.commitPage("10", anchor("10"), [first, event("10")]).nextBlock).toBe("11");
    expect(() => store.commitPage("10", anchor("10"), [])).toThrow("ACTIVITY_EVENT_CONFLICT");
    store.commitPage("11", anchor("20"), []);
    expect(store.state().nextBlock).toBe("21");
  });
});

test("capacity and invalid payload leave both rows and checkpoint unchanged", () => {
  fixture((store) => {
    target(store);
    expect(() => store.commitPage("10", anchor("10"), [event("0"), event("1")])).toThrow("ACTIVITY_CAPACITY");
    expect(store.events()).toEqual([]);
    expect(store.state().nextBlock).toBe("10");
    expect(() => store.commitPage("10", anchor("10"), [{ ...event("0"), blockNumber: "010" }])).toThrow("ACTIVITY_INVALID_LOG");
    expect(() => store.commitPage("10", anchor("10"), [{ ...event("0"), payload: '{"amount":"101"}' }])).toThrow("ACTIVITY_INVALID_LOG");
    expect(store.state().nextBlock).toBe("10");
  }, 1);
});

test("restart below the existing event count fails without changing history or checkpoint", () => {
  fixture((store, path) => {
    target(store, "10");
    store.commitPage("10", anchor("10"), [event("0"), event("1")]);
    const before = store.state();
    expect(() => new ActivityStore(path, deployment, 1)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    expect(store.state()).toEqual(before);
    expect(store.events()).toEqual([event("0"), event("1")]);
    const reopened = new ActivityStore(path, deployment, 2);
    try {
      expect(reopened.events()).toEqual([event("0"), event("1")]);
      expect(reopened.state().nextBlock).toBe("11");
    } finally { reopened.close(); }
  });
});

test("restart distrusts completed coverage and reorg reset removes derived rows atomically", () => {
  fixture((store, path) => {
    target(store, "10");
    store.commitPage("10", anchor("10"), [event("0")]);
    store.updateState("11", (s) => ({ ...s, coverageStatus: "complete", coverageReason: null, reorgState: "clear", lastValidatedAt: "2026-01-01T00:00:00.000Z" }));
    const reopened = new ActivityStore(path, deployment);
    try {
      expect(reopened.state()).toMatchObject({ nextBlock: "11", coverageStatus: "unavailable", coverageReason: "UNVERIFIED_CHECKPOINT", reorgState: "unchecked" });
      reopened.resetForReorg("2026-01-02T00:00:00.000Z");
      expect(reopened.events()).toEqual([]);
      expect(reopened.state()).toMatchObject({ nextBlock: "10", cutoff: null, target: null, coverageReason: "REORG_REBUILD", reorgState: "rebuilding" });
    } finally { reopened.close(); }
  });
});

test("backup includes WAL commits and restore remains unverified", () => {
  fixture((store, path) => {
    target(store, "10");
    store.commitPage("10", anchor("10"), [event("0")]);
    const backup = path + ".backup";
    store.backup(backup);
    const restored = new ActivityStore(backup, deployment);
    try {
      expect(restored.events()).toEqual([event("0")]);
      expect(restored.state()).toMatchObject({ nextBlock: "11", coverageReason: "UNVERIFIED_CHECKPOINT" });
      expect(statSync(backup).mode & 0o777).toBe(0o600);
    } finally { restored.close(); }
  });
});

test("reopening rejects corrupted stored event fields without advancing the checkpoint", () => {
  fixture((store, path) => {
    target(store, "10");
    store.commitPage("10", anchor("10"), [event("0")]);
    const db = new Database(path);
    db.query("UPDATE activity_events SET blockNumber=?").run("010");
    db.close();
    expect(() => new ActivityStore(path, deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    expect(store.state().nextBlock).toBe("11");
  });
});

test("a missing v1 state header fails closed without replacing event history", () => {
  fixture((store, path) => {
    target(store, "10");
    store.commitPage("10", anchor("10"), [event("0")]);
    const db = new Database(path);
    db.exec("DELETE FROM activity_state");
    expect(() => new ActivityStore(path, deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    expect(db.query<{ count: number }, []>("SELECT count(*) AS count FROM activity_events").get()?.count).toBe(1);
    expect(db.query<{ count: number }, []>("SELECT count(*) AS count FROM activity_state").get()?.count).toBe(0);
    db.close();
  });
  expect(() => new ActivityStore("/unused", { ...deployment, contract: "0x" + "0".repeat(40) })).toThrow("ACTIVITY_DEPLOYMENT_INVALID");
});

test("unsafe paths, corrupted files and unsupported versions fail closed", () => {
  const dir = mkdtempSync(tmpdir() + "/unmet-activity-invalid-");
  try {
    writeFileSync(dir + "/bad", "bad", { mode: 0o600 });
    expect(() => new ActivityStore(dir + "/bad", deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    symlinkSync(dir + "/bad", dir + "/link");
    expect(() => new ActivityStore(dir + "/link", deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    const db = new Database(dir + "/future"); db.exec("PRAGMA user_version=2"); db.close(); chmodSync(dir + "/future", 0o600);
    expect(() => new ActivityStore(dir + "/future", deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
    chmodSync(dir, 0o755);
    expect(() => new ActivityStore(dir + "/new", deployment)).toThrow("ACTIVITY_STORAGE_UNAVAILABLE");
  } finally { chmodSync(dir, 0o700); rmSync(dir, { recursive: true }); }
});
