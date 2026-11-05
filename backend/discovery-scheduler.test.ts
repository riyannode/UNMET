import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DiscoveryStore } from "./discovery-store.ts";
import { startDiscoveryScheduler } from "./discovery-scheduler.ts";
import { discoveryIdentity, discoveryPayload, parseDiscoveryMetadata } from "./discovery-metadata.ts";
import { discoveryRequest } from "./discovery-evaluator.ts";
import fixture from "./fixtures/discovery.json";

test("startup rechecks persisted records and suppresses old compatibility on canonical failure", async () => {
  for (const throws of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), "unmet-scheduler-"));
    const store = new DiscoveryStore(join(dir, "data.sqlite"));
    try {
      const record = { identity: "1:contract:1", revision: "1", payload: "{}", payloadHash: "hash", signature: "sig" };
      store.put(record);
      store.setObservation(record.identity, "1", "hash", JSON.stringify({ observedAt: 1, result: { state: "compatible", reason: null, offers: [] }, lastAttemptAt: 1, generation: 0, failure: null }));
      store.markAttempt(record.identity, "1", Date.now() - 1);
      let called = false;
      const stop = startDiscoveryScheduler(store, { tickMs: 1000, refreshMs: 300000, staleMs: 900000, maxInFlight: 2, timeoutMs: 1000 }, join(dir, "absent.sock"), "1:contract:", async () => {
        called = true;
        if (throws) throw new Error("RPC failed");
        return false;
      });
      for (let i = 0; i < 100 && !JSON.parse(store.get(record.identity)!.observation!).failure; i++) await Bun.sleep(5);
      await stop();
      const observation = JSON.parse(store.get(record.identity)!.observation!);
      expect(called).toBe(true);
      expect(observation.failure).toBe(throws ? "CANONICAL_UNAVAILABLE" : "CANONICAL_INACTIVE");
      expect(observation.observedAt).toBe(1);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test("corrupt persisted observations do not prevent recording canonical failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-scheduler-corrupt-"));
  const store = new DiscoveryStore(join(dir, "data.sqlite"));
  try {
    const record = { identity: "1:contract:1", revision: "1", payload: "{}", payloadHash: "hash", signature: "sig" };
    store.put(record);
    store.setObservation(record.identity, "1", "hash", "malformed");
    const stop = startDiscoveryScheduler(store, { tickMs: 1000, refreshMs: 300000, staleMs: 900000, maxInFlight: 1, timeoutMs: 1000 }, join(dir, "absent.sock"), "1:contract:", async () => false);
    for (let i = 0; i < 100 && store.get(record.identity)?.observation === "malformed"; i++) await Bun.sleep(5);
    await stop();
    expect(JSON.parse(store.get(record.identity)!.observation!)).toMatchObject({ observedAt: null, result: null, failure: "CANONICAL_INACTIVE" });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("refresh persists valid IPC evidence and preserves it as last-known on observer failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-scheduler-ipc-")), socket = join(dir, "observer.sock");
  const store = new DiscoveryStore(join(dir, "data.sqlite"));
  let onRequest = () => {};
  const server = createServer((_req, res) => { onRequest(); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response)); });
  const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify(fixture.metadata)));
  const { payload, payloadHash } = discoveryPayload(metadata), identity = discoveryIdentity(metadata);
  const target = metadata.targets[0];
  const offer = { scheme: "exact", network: target.network, asset: target.asset, amount: "1", payTo: target.payTo, maxTimeoutSeconds: 30, transferMethod: "permit2", paymentFlow: "authorization", extra: { assetTransferMethod: "permit2", paymentFlow: "authorization" }, validationPolicyId: `0x${"aa".repeat(32)}`, withinOriginatingMaxPrice: null };
  let response: unknown = { state: "compatible", reason: null, metadataRevision: metadata.revision, requestHash: discoveryRequest(metadata).requestHash, blockHash: `0x${"bb".repeat(32)}`, offers: [offer] };
  try {
    store.put({ identity, revision: metadata.revision, payload, payloadHash, signature: metadata.signature });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
    let generation = 0;
    const stop = startDiscoveryScheduler(store, { tickMs: 10, refreshMs: 20, staleMs: 1000, maxInFlight: 1, timeoutMs: 1000 }, socket, `${metadata.chainId}:${metadata.contract}:`, async () => true, () => generation);
    try {
      const wait = async (condition: () => boolean) => { for (let i = 0; i < 200 && !condition(); i++) await Bun.sleep(5); expect(condition()).toBe(true); };
      await wait(() => !!store.get(identity)?.observation);
      const first = JSON.parse(store.get(identity)!.observation!);
      expect(first.result.state).toBe("compatible");
      response = { state: "compatible", reason: null, offers: [{ ...offer, amount: "invalid" }] };
      await wait(() => JSON.parse(store.get(identity)!.observation!).failure === "INVALID_OBSERVER_RESPONSE");
      const failed = JSON.parse(store.get(identity)!.observation!);
      expect(failed.observedAt).toBe(first.observedAt);
      expect(failed.result.offers).toHaveLength(1);
      response = { state: "compatible", reason: null, metadataRevision: metadata.revision, requestHash: discoveryRequest(metadata).requestHash, blockHash: `0x${"bb".repeat(32)}`, offers: [{ ...offer, amount: "2" }] };
      await wait(() => JSON.parse(store.get(identity)!.observation!).result?.offers[0]?.amount === "2");
      const refreshed = JSON.parse(store.get(identity)!.observation!);
      expect(refreshed.failure).toBeNull();
      response = { state: "metadata_invalid", reason: "INVALID_METADATA", offers: [] };
      await wait(() => JSON.parse(store.get(identity)!.observation!).result?.state === "metadata_invalid");
      expect(JSON.parse(store.get(identity)!.observation!).failure).toBeNull();
      response = { state: "compatible", reason: null, metadataRevision: metadata.revision, requestHash: discoveryRequest(metadata).requestHash, blockHash: `0x${"bb".repeat(32)}`, offers: [{ ...offer, amount: "2" }] };
      await wait(() => JSON.parse(store.get(identity)!.observation!).result?.state === "compatible");
      const restored = JSON.parse(store.get(identity)!.observation!);
      onRequest = () => { generation++; };
      await wait(() => JSON.parse(store.get(identity)!.observation!).failure === "CANONICAL_CHANGED");
      expect(JSON.parse(store.get(identity)!.observation!).observedAt).toBe(restored.observedAt);
    } finally { await stop(); }
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("scheduler bounds concurrent probes and rejects results for superseded revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-scheduler-bound-")), socket = join(dir, "observer.sock");
  const store = new DiscoveryStore(join(dir, "data.sqlite"));
  const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify(fixture.metadata)));
  const held: Array<import("node:http").ServerResponse> = [];
  let active = 0, peak = 0;
  const server = createServer((_req, res) => { active++; peak = Math.max(peak, active); held.push(res); res.on("finish", () => active--); });
  try {
    const records = [1, 2, 3].map((id) => {
      const value = { ...metadata, demandId: String(id) };
      const { payload, payloadHash } = discoveryPayload(value);
      const record = { identity: discoveryIdentity(value), revision: value.revision, payload, payloadHash, signature: value.signature };
      store.put(record); return record;
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
    const stop = startDiscoveryScheduler(store, { tickMs: 1000, refreshMs: 300000, staleMs: 900000, maxInFlight: 2, timeoutMs: 1000 }, socket, `${metadata.chainId}:${metadata.contract}:`, async () => true);
    try {
      for (let i = 0; i < 200 && held.length < 2; i++) await Bun.sleep(5);
      expect(held).toHaveLength(2);
      expect(peak).toBe(2);
      const next = { ...records[0], revision: (BigInt(records[0].revision) + 1n).toString(), payloadHash: "new" };
      expect(store.put(next)).toBe("updated");
      for (const res of held) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: "unavailable", reason: "TEST_FAILURE", offers: [] }));
      for (let i = 0; i < 200 && !store.get(records[1].identity)?.observation; i++) await Bun.sleep(5);
      expect(store.get(records[1].identity)?.observation).not.toBeNull();
      expect(store.get(records[0].identity)?.observation).toBeNull();
      expect(store.get(records[2].identity)?.observation).toBeNull();
    } finally { await stop(); }
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
