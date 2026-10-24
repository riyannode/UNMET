/// <reference types="@types/bun" />
import { PaymentError } from "./payment-error.ts";
import { Database } from "bun:sqlite";
import { chmodSync, lstatSync, openSync, closeSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export type PaymentState = "VERIFIED" | "SETTLEMENT_IN_FLIGHT" | "UNKNOWN" | "SETTLED" | "FAILED" | "CANCELLED";
export type Reservation = {
  payment: string; binding: string; logicalKey: string | null;
  network: string; recipient: string; amount: string; payer: string; validBefore: number;
};
export type PaymentRecord = Reservation & {
  id: string; state: PaymentState; txHash: string | null; created: number; updated: number; error: string | null;
};

export class PaymentStore {
  private db!: Database;
  private inode = 0;
  constructor(public readonly path: string, private readonly maxRecords = 100_000, private readonly now = Date.now) {
    if (!isAbsolute(path) || path === ":memory:") throw new PaymentError("PAYMENT_STORAGE_UNAVAILABLE");
    const directory = dirname(path);
    try {
      const dir = lstatSync(directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || !(dir.mode & 0o200)) throw new Error();
      chmodSync(directory, 0o700);
      try {
        const file = lstatSync(path);
        if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.() || !(file.mode & 0o200)) throw new Error();
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        closeSync(openSync(path, "wx", 0o600));
      }
      chmodSync(path, 0o600);
      this.inode = lstatSync(path).ino;
      this.db = new Database(path, { strict: true });
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      const mode = this.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL").get();
      if (mode?.journal_mode !== "wal") throw new Error();
      this.db.transaction(() => {
        const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
        if (version === 0) {
          this.db.exec(`
            CREATE TABLE payments (
              id TEXT PRIMARY KEY, payment TEXT NOT NULL UNIQUE, binding TEXT NOT NULL,
              logicalKey TEXT UNIQUE, network TEXT NOT NULL, recipient TEXT NOT NULL,
              amount TEXT NOT NULL, payer TEXT NOT NULL, validBefore INTEGER NOT NULL,
              state TEXT NOT NULL CHECK(state IN ('VERIFIED','SETTLEMENT_IN_FLIGHT','UNKNOWN','SETTLED','FAILED','CANCELLED')),
              txHash TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, error TEXT,
              CHECK(length(payment)=64 AND length(binding)=64),
              CHECK(logicalKey IS NULL OR length(logicalKey)=64),
              CHECK(length(network)<=64 AND length(recipient)<=42 AND length(payer)<=42 AND length(amount)<=78),
              CHECK(txHash IS NULL OR length(txHash)=66)
            );
            CREATE INDEX payments_retention ON payments(state, updated);
            PRAGMA user_version=1;
          `);
        } else if (version !== 1) throw new Error();
      }).immediate();
      if (this.db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous !== 2 ||
        this.db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw new Error();
      this.integrity();
    } catch {
      // The constructor never replaces an invalid database or falls back to memory.
      this.db!?.close();
      throw new PaymentError("PAYMENT_STORAGE_UNAVAILABLE");
    }
  }

  private available() {
    const file = lstatSync(this.path), dir = lstatSync(dirname(this.path));
    if (!file.isFile() || file.isSymbolicLink() || file.ino !== this.inode || !(file.mode & 0o200) ||
      !dir.isDirectory() || !(dir.mode & 0o200)) throw new PaymentError("PAYMENT_STORAGE_UNAVAILABLE");
  }

  integrity() {
    this.available();
    const rows = this.db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw new PaymentError("PAYMENT_STORAGE_UNAVAILABLE");
  }

  get(id: string) { this.available(); return this.db.query<PaymentRecord, [string]>("SELECT * FROM payments WHERE id=?").get(id); }

  findPayment(payment: string) {
    this.available();
    return this.db.query<PaymentRecord, [string]>("SELECT * FROM payments WHERE payment=?").get(payment);
  }

  reserve(input: Reservation): PaymentRecord {
    this.available();
    return this.db.transaction(() => {
      // Reclaim only a confirmed pre-settlement cancellation, in the same transaction.
      this.db.query("UPDATE payments SET logicalKey=NULL WHERE logicalKey=? AND state='CANCELLED' AND txHash IS NULL")
        .run(input.logicalKey);
      const prior = this.db.query<PaymentRecord, [string, string | null]>(
        "SELECT * FROM payments WHERE payment=? OR logicalKey=? LIMIT 1",
      ).get(input.payment, input.logicalKey);
      if (prior) {
        const conflict = prior.payment !== input.payment || prior.binding !== input.binding ||
          prior.logicalKey !== input.logicalKey;
        throw new PaymentError(conflict ? "IDEMPOTENCY_CONFLICT" : "PAYMENT_ALREADY_RESERVED", 409);
      }
      const count = this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM payments").get()!.count;
      if (count >= this.maxRecords) throw new PaymentError("PAYMENT_STORAGE_CAPACITY");
      const id = crypto.randomUUID(), time = this.now();
      this.db.query(`INSERT INTO payments
        (id,payment,binding,logicalKey,network,recipient,amount,payer,validBefore,state,created,updated)
        VALUES (?,?,?,?,?,?,?,?,?,'VERIFIED',?,?)`).run(
        id, input.payment, input.binding, input.logicalKey, input.network, input.recipient,
        input.amount, input.payer, input.validBefore, time, time,
      );
      return this.get(id)!;
    }).immediate();
  }

  transition(id: string, from: PaymentState, to: PaymentState, txHash: string | null = null, error: string | null = null) {
    this.available();
    const allowed: Record<PaymentState, readonly PaymentState[]> = {
      VERIFIED: ["SETTLEMENT_IN_FLIGHT", "CANCELLED", "UNKNOWN"],
      SETTLEMENT_IN_FLIGHT: ["SETTLED", "FAILED", "UNKNOWN"],
      UNKNOWN: ["UNKNOWN", "SETTLED", "FAILED"],
      SETTLED: [], FAILED: [], CANCELLED: [],
    };
    if (!allowed[from].includes(to) || (txHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) ||
      (error !== null && !/^[A-Z_]{1,64}$/.test(error))) throw new PaymentError("PAYMENT_STATE_INVALID");
    const result = this.db.query(`UPDATE payments SET state=?,txHash=COALESCE(?,txHash),updated=?,error=?
      WHERE id=? AND state=? AND (? IS NULL OR txHash IS NULL OR lower(txHash)=lower(?))`)
      .run(to, txHash, this.now(), error, id, from, txHash, txHash);
    if (result.changes !== 1) throw new PaymentError("PAYMENT_STATE_CONFLICT");
  }

  checkpointHash(id: string, payment: string, hash: string) {
    this.available();
    if (!/^[0-9a-f]{64}$/.test(payment) || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new PaymentError("PAYMENT_STATE_INVALID");
    const result = this.db.query(`UPDATE payments SET txHash=?,updated=?
      WHERE id=? AND payment=? AND state='SETTLEMENT_IN_FLIGHT' AND (txHash IS NULL OR lower(txHash)=lower(?))`)
      .run(hash, this.now(), id, payment, hash);
    if (result.changes !== 1) throw new PaymentError("PAYMENT_STATE_CONFLICT");
  }

  recoverInterrupted() {
    this.available();
    return this.db.query(`UPDATE payments SET state='UNKNOWN',updated=?,error='PROCESS_INTERRUPTED'
      WHERE state IN ('VERIFIED','SETTLEMENT_IN_FLIGHT')`).run(this.now()).changes;
  }

  pending(limit = 100, withHash = false) {
    this.available();
    return this.db.query<PaymentRecord, [number, number]>(
      "SELECT * FROM payments WHERE state='UNKNOWN' AND (?=0 OR txHash IS NOT NULL) ORDER BY updated,id LIMIT ?",
    ).all(Number(withHash), Math.min(100, Math.max(1, limit)));
  }

  cleanup(retentionMs: number) {
    this.available();
    return this.db.query(`DELETE FROM payments WHERE id IN (
      SELECT id FROM payments WHERE state IN ('SETTLED','FAILED','CANCELLED') AND updated<?
      AND validBefore<? ORDER BY updated LIMIT 1000)`).run(this.now() - retentionMs, this.now()).changes;
  }

  backup(destination: string) {
    this.available();
    if (!isAbsolute(destination)) throw new PaymentError("PAYMENT_BACKUP_INVALID");
    const dir = lstatSync(dirname(destination));
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() ||
      (dir.mode & 0o777) !== 0o700) throw new PaymentError("PAYMENT_BACKUP_INVALID");
    // VACUUM INTO makes a consistent snapshot including committed WAL content.
    this.db.query("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
  }

  close() { this.db.close(); }
}
