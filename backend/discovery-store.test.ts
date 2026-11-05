import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryStore } from "./discovery-store.ts";
import { Database } from "bun:sqlite";

test("revisions are atomic, monotonic, durable, and invalidate old observations", () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-discovery-"));
  const path = join(dir, "discovery.sqlite");
  try {
    let store = new DiscoveryStore(path);
    const initial = { identity: "1:contract:1", revision: "1", payload: "one", payloadHash: "hash1", signature: "sig1" };
    expect(store.put(initial)).toBe("updated");
    expect(store.put({ ...initial, signature: "sig2" })).toBe("unchanged");
    expect(store.put({ ...initial, payload: "different" })).toBe("conflict");
    expect(store.setObservation(initial.identity, "1", "hash1", "old")).toBe(true);
    expect(store.put({ ...initial, revision: "2", payload: "two", payloadHash: "hash2" })).toBe("updated");
    expect(store.setObservation(initial.identity, "1", "hash1", "late")).toBe(false);
    expect(store.put(initial)).toBe("conflict");
    store.close();
    store = new DiscoveryStore(path);
    expect(store.get(initial.identity)?.revision).toBe("2");
    expect(store.get(initial.identity)?.observation).toBeNull();
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unknown and malformed schemas fail without replacing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-discovery-schema-"));
  try {
    for (const version of [1, 2]) {
      const path = join(dir, `${version}.sqlite`);
      const db = new Database(path); db.exec(`CREATE TABLE unrelated (value TEXT); PRAGMA user_version=${version}`); db.close();
      chmodSync(path, 0o600);
      expect(() => new DiscoveryStore(path)).toThrow("DISCOVERY_STORAGE_UNAVAILABLE");
      const verify = new Database(path); expect(verify.query("SELECT * FROM unrelated").all()).toEqual([]); verify.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("independent connections preserve the highest revision and reject late observations", () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-discovery-connections-"));
  const path = join(dir, "discovery.sqlite");
  const first = new DiscoveryStore(path), second = new DiscoveryStore(path);
  try {
    const record = { identity: "1:contract:1", revision: "1", payload: "one", payloadHash: "hash1", signature: "sig" };
    expect(first.put(record)).toBe("updated");
    expect(second.put({ ...record, revision: "3", payload: "three", payloadHash: "hash3" })).toBe("updated");
    expect(first.put({ ...record, revision: "2", payload: "two", payloadHash: "hash2" })).toBe("conflict");
    expect(first.setObservation(record.identity, "1", "hash1", "late")).toBe(false);
    expect(first.get(record.identity)?.revision).toBe("3");
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});
