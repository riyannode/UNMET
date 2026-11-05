import { Database } from "bun:sqlite";
import { closeSync, lstatSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export type DiscoveryRecord = { identity: string; revision: string; payload: string; payloadHash: string; signature: string; observation: string | null; lastAttempt: number };

export class DiscoveryStore {
  private db: Database;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("DISCOVERY_STORAGE_UNAVAILABLE");
    const dir = lstatSync(dirname(path));
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.()) throw new Error("DISCOVERY_STORAGE_UNAVAILABLE");
    try { closeSync(openSync(path, "wx", 0o600)); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.() || (file.mode & 0o077)) throw new Error("DISCOVERY_STORAGE_UNAVAILABLE");
    this.db = new Database(path, { strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      if (this.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL").get()?.journal_mode !== "wal") throw new Error();
      this.db.transaction(() => {
        const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
        if (version === 0) this.db.exec("CREATE TABLE discovery (identity TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL, payloadHash TEXT NOT NULL, signature TEXT NOT NULL, observation TEXT, lastAttempt INTEGER NOT NULL DEFAULT 0); PRAGMA user_version=1;");
        else if (version !== 1) throw new Error();
      }).immediate();
      const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(discovery)").all().map((column) => column.name).join(",");
      if (columns !== "identity,revision,payload,payloadHash,signature,observation,lastAttempt" || this.db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error();
    } catch { this.db.close(); throw new Error("DISCOVERY_STORAGE_UNAVAILABLE"); }
  }

  get(identity: string) { return this.db.query<DiscoveryRecord, [string]>("SELECT * FROM discovery WHERE identity=?").get(identity); }
  due(prefix: string, before: number, limit: number) {
    return this.db.query<DiscoveryRecord, [string, number, number]>("SELECT * FROM discovery WHERE identity LIKE ? ESCAPE '\\' AND lastAttempt<=? ORDER BY lastAttempt,identity LIMIT ?").all(prefix.replace(/[\\%_]/g, "\\$&") + "%", before, limit);
  }
  markAttempt(identity: string, revision: string, time: number) {
    this.db.query("UPDATE discovery SET lastAttempt=? WHERE identity=? AND revision=?").run(time, identity, revision);
  }
  put(record: Omit<DiscoveryRecord, "observation" | "lastAttempt">): "updated" | "unchanged" | "conflict" {
    return this.db.transaction(() => {
      const previous = this.get(record.identity);
      if (previous) {
        if (BigInt(record.revision) < BigInt(previous.revision)) return "conflict";
        if (record.revision === previous.revision) return record.payloadHash === previous.payloadHash && record.payload === previous.payload ? "unchanged" : "conflict";
      }
      this.db.query("INSERT INTO discovery(identity,revision,payload,payloadHash,signature,observation) VALUES(?,?,?,?,?,NULL) ON CONFLICT(identity) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,payloadHash=excluded.payloadHash,signature=excluded.signature,observation=NULL,lastAttempt=0")
        .run(record.identity, record.revision, record.payload, record.payloadHash, record.signature);
      return "updated";
    }).immediate();
  }
  setObservation(identity: string, revision: string, payloadHash: string, observation: string) {
    return this.db.query("UPDATE discovery SET observation=? WHERE identity=? AND revision=? AND payloadHash=?")
      .run(observation, identity, revision, payloadHash).changes === 1;
  }
  close() { this.db.close(); }
}
