import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { PaymentStore, type Reservation } from "./payment-store.ts";

export const reservation = (suffix = "a"): Reservation => ({
  payment: suffix.repeat(64), binding: "b".repeat(64), logicalKey: null,
  network: "eip155:196", recipient: "0x" + "1".repeat(40), payer: "0x" + "2".repeat(40),
  amount: "10000", validBefore: Date.now() + 60_000,
});
function fixture(run: (store: PaymentStore, path: string) => void) {
  const dir = mkdtempSync(tmpdir() + "/unmet-payment-");
  const path = dir + "/payments.sqlite";
  const store = new PaymentStore(path);
  try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

test("SQLite schema, WAL, FULL durability, permissions and safe reinitialization", () => {
  fixture((store, path) => {
    store.integrity();
    const db = new Database(path);
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path.slice(0, path.lastIndexOf("/"))).mode & 0o777).toBe(0o700);
    db.close();
    const reopened = new PaymentStore(path); reopened.integrity(); reopened.close();
  });
});

test("atomic reservations and explicit state transitions prohibit duplicate settlements", () => {
  fixture((store) => {
    const row = store.reserve(reservation());
    expect(() => store.reserve(reservation())).toThrow("PAYMENT_ALREADY_RESERVED");
    expect(() => store.reserve({ ...reservation(), binding: "c".repeat(64) })).toThrow("IDEMPOTENCY_CONFLICT");
    store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    expect(() => store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT")).toThrow("PAYMENT_STATE_CONFLICT");
    expect(() => store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "CANCELLED")).toThrow("PAYMENT_STATE_INVALID");
    expect(store.get(row.id)?.state).toBe("SETTLEMENT_IN_FLIGHT");
  });
});

test("logical key conflicts atomically and distinct identities work", () => {
  fixture((store) => {
    store.reserve({ ...reservation(), logicalKey: "d".repeat(64) });
    expect(() => store.reserve({ ...reservation("c"), logicalKey: "d".repeat(64) })).toThrow("IDEMPOTENCY_CONFLICT");
    expect(store.reserve(reservation("e")).state).toBe("VERIFIED");
  });
});

test("crash/reopen preserves in-flight identity and recovery never resettles", () => {
  fixture((store, path) => {
    const row = store.reserve(reservation());
    store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    const reopened = new PaymentStore(path);
    try {
      expect(reopened.recoverInterrupted()).toBe(1);
      expect(reopened.get(row.id)?.state).toBe("UNKNOWN");
      expect(() => reopened.reserve(reservation())).toThrow("PAYMENT_ALREADY_RESERVED");
    } finally { reopened.close(); }
  });
});

test("busy database rejects reservation with no partial record", () => {
  fixture((store, path) => {
    const lock = new Database(path);
    lock.exec("BEGIN IMMEDIATE");
    const started = Date.now();
    expect(() => store.reserve(reservation())).toThrow();
    expect(Date.now() - started).toBeLessThan(6500);
    lock.exec("ROLLBACK"); lock.close();
    expect(store.reserve(reservation()).state).toBe("VERIFIED");
  });
}, 10_000);

test("missing, unwritable, corrupted and unsupported schema storage fails closed", () => {
  const dir = mkdtempSync(tmpdir() + "/unmet-failure-");
  try {
    expect(() => new PaymentStore(dir + "/missing/data.sqlite")).toThrow("PAYMENT_STORAGE_UNAVAILABLE");
    chmodSync(dir, 0o500);
    expect(() => new PaymentStore(dir + "/readonly.sqlite")).toThrow("PAYMENT_STORAGE_UNAVAILABLE");
    chmodSync(dir, 0o700);
    writeFileSync(dir + "/bad.sqlite", "corrupt database", { mode: 0o600 });
    expect(() => new PaymentStore(dir + "/bad.sqlite")).toThrow("PAYMENT_STORAGE_UNAVAILABLE");
    const db = new Database(dir + "/future.sqlite");
    db.exec("PRAGMA user_version=2"); db.close();
    expect(() => new PaymentStore(dir + "/future.sqlite")).toThrow("PAYMENT_STORAGE_UNAVAILABLE");
  } finally { chmodSync(dir, 0o700); rmSync(dir, { recursive: true }); }
});

test("retention preserves ambiguous payments and still-valid authorizations; capacity fails closed", () => {
  const dir = mkdtempSync(tmpdir() + "/unmet-retention-");
  let time = Date.now();
  const store = new PaymentStore(dir + "/data.sqlite", 3, () => time);
  try {
    const settled = store.reserve({ ...reservation(), validBefore: time + 1000 });
    store.transition(settled.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    store.transition(settled.id, "SETTLEMENT_IN_FLIGHT", "SETTLED");
    const active = store.reserve(reservation("c"));
    store.transition(active.id, "VERIFIED", "UNKNOWN");
    store.reserve({ ...reservation("d"), validBefore: time + 100_000 });
    expect(() => store.reserve(reservation("e"))).toThrow("PAYMENT_STORAGE_CAPACITY");
    expect(store.cleanup(1)).toBe(0);
    time += 10_000;
    expect(store.cleanup(1)).toBe(1);
    expect(store.get(active.id)?.state).toBe("UNKNOWN");
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test("WAL-consistent backup contains committed records", () => {
  fixture((store, path) => {
    const row = store.reserve(reservation());
    store.backup(path + ".backup");
    const backup = new Database(path + ".backup", { readonly: true });
    expect(backup.query("SELECT state FROM payments WHERE id=?").get(row.id)).toEqual({ state: "VERIFIED" });
    backup.close();
    expect(statSync(path + ".backup").mode & 0o777).toBe(0o600);
  });
});

test("actual SIGKILL crash retains WAL reservation and blocks a restart retry", async () => {
  const dir = mkdtempSync(tmpdir() + "/unmet-crash-");
  const path = dir + "/payments.sqlite";
  const modulePath = new URL("./payment-store.ts", import.meta.url).pathname;
  const source = `import { PaymentStore } from ${JSON.stringify(modulePath)};
    const db = new PaymentStore(${JSON.stringify(path)});
    const row = db.reserve(${JSON.stringify(reservation())});
    db.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
    console.log(row.id);
    setInterval(() => {}, 1000);`;
  const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    const output = await reader.read();
    reader.releaseLock();
    const id = new TextDecoder().decode(output.value).trim();
    expect(id.length).toBe(36);
    child.kill("SIGKILL"); await child.exited;
    const recovered = new PaymentStore(path);
    try {
      expect(recovered.get(id)?.state).toBe("SETTLEMENT_IN_FLIGHT");
      expect(recovered.recoverInterrupted()).toBe(1);
      expect(recovered.get(id)?.state).toBe("UNKNOWN");
      expect(() => recovered.reserve(reservation())).toThrow("PAYMENT_ALREADY_RESERVED");
    } finally { recovered.close(); }
  } finally {
    if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    rmSync(dir, { recursive: true });
  }
});

test("removed or made-unwritable database cannot admit new settlement", () => {
  fixture((store, path) => {
    const row = store.reserve(reservation());
    chmodSync(path, 0o400);
    expect(() => store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT")).toThrow("PAYMENT_STORAGE_UNAVAILABLE");
    chmodSync(path, 0o600);
    rmSync(path);
    expect(() => store.reserve(reservation("c"))).toThrow();
  });
});

test("cancelled logical key can be reclaimed without deleting its authorization", () => {
  fixture((store, path) => {
    const key = "d".repeat(64);
    const original = store.reserve({ ...reservation(), logicalKey: key });
    store.transition(original.id, "VERIFIED", "CANCELLED");
    const retry = store.reserve({ ...reservation("c"), logicalKey: key });
    expect(retry.logicalKey).toBe(key);
    expect(store.get(original.id)?.state).toBe("CANCELLED");
    expect(store.get(original.id)?.logicalKey).toBeNull();
    expect(() => store.reserve({ ...reservation(), logicalKey: key })).toThrow();
    const reopened = new PaymentStore(path);
    try {
      expect(reopened.findPayment(original.payment)?.id).toBe(original.id);
      expect(() => reopened.reserve({ ...reservation("e"), logicalKey: key })).toThrow("IDEMPOTENCY_CONFLICT");
    } finally { reopened.close(); }
  });
});

test("settlement and interrupted states never release their logical keys", () => {
  for (const state of ["UNKNOWN", "SETTLEMENT_IN_FLIGHT", "SETTLED"] as const) {
    fixture((store) => {
      const key = "d".repeat(64);
      const row = store.reserve({ ...reservation(), logicalKey: key });
      if (state === "UNKNOWN") store.recoverInterrupted();
      else {
        store.transition(row.id, "VERIFIED", "SETTLEMENT_IN_FLIGHT");
        if (state === "SETTLED") store.transition(row.id, "SETTLEMENT_IN_FLIGHT", "SETTLED");
      }
      expect(() => store.transition(row.id, state, "CANCELLED")).toThrow("PAYMENT_STATE_INVALID");
      expect(() => store.reserve({ ...reservation("c"), logicalKey: key })).toThrow("IDEMPOTENCY_CONFLICT");
      expect(store.get(row.id)?.logicalKey).toBe(key);
    });
  }
});

test("failed replacement reservation rolls back cancelled-key release", () => {
  const dir = mkdtempSync(tmpdir() + "/unmet-cancel-atomic-");
  const store = new PaymentStore(dir + "/payments.sqlite", 1);
  try {
    const key = "d".repeat(64), row = store.reserve({ ...reservation(), logicalKey: key });
    store.transition(row.id, "VERIFIED", "CANCELLED");
    expect(() => store.reserve({ ...reservation("c"), logicalKey: key })).toThrow("PAYMENT_STORAGE_CAPACITY");
    expect(store.get(row.id)?.logicalKey).toBe(key);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
