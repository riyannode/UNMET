import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import canonicalize from "canonicalize";

export type ActivityDeployment = { chainId: string; contract: string; escrowToken: string; tokenDecimals: number; deployBlock: string };
export type ActivityAnchor = { blockNumber: string; blockHash: string; timestamp: string };
export type ActivityReason = "NOT_INITIALIZED" | "UNVERIFIED_CHECKPOINT" | "BACKFILL_INCOMPLETE" | "REORG_REBUILD" | "RPC_UNAVAILABLE" | "CAPACITY" | "INVALID_LOG" | "COVERAGE_MISMATCH";
export type ActivityState = ActivityDeployment & {
  nextBlock: string;
  startAnchor: ActivityAnchor | null;
  cutoff: ActivityAnchor | null;
  target: ActivityAnchor | null;
  coverageStatus: "complete" | "partial" | "unavailable";
  coverageReason: ActivityReason | null;
  lastValidatedAt: string | null;
  reorgState: "unchecked" | "clear" | "detected" | "rebuilding";
  lastDetectedAt: string | null;
};
export type ActivityEvent = {
  chainId: string; contract: string; transactionHash: string; logIndex: string;
  blockNumber: string; blockHash: string; transactionIndex: string; blockTimestamp: string;
  eventName: string; demandId: string | null; payload: string; payloadHash: string;
};

type StateRow = Omit<ActivityState, "startAnchor" | "cutoff" | "target"> & {
  startHash: string | null; startTimestamp: string | null;
  cutoffBlock: string | null; cutoffHash: string | null; cutoffTimestamp: string | null;
  targetBlock: string | null; targetHash: string | null; targetTimestamp: string | null;
};
const uint = (value: string, bits = 256) => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78 && BigInt(value) < (1n << BigInt(bits));
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
const address = (value: string) => /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const iso = (value: string | null) => value === null || (!Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value);
function anchorValid(anchor: ActivityAnchor | null) {
  return anchor === null || (uint(anchor.blockNumber, 64) && hash(anchor.blockHash) && uint(anchor.timestamp, 64));
}
function validateDeployment(deployment: ActivityDeployment) {
  if (!uint(deployment.chainId, 64) || deployment.chainId === "0" || !address(deployment.contract) || !address(deployment.escrowToken) ||
      !Number.isInteger(deployment.tokenDecimals) || deployment.tokenDecimals < 0 || deployment.tokenDecimals > 255 || !uint(deployment.deployBlock, 64)) throw new Error("ACTIVITY_DEPLOYMENT_INVALID");
}
function validateState(state: ActivityState) {
  validateDeployment(state);
  if (!uint(state.nextBlock, 64) || BigInt(state.nextBlock) < BigInt(state.deployBlock) || !anchorValid(state.startAnchor) || !anchorValid(state.cutoff) || !anchorValid(state.target) ||
      (state.startAnchor !== null && state.startAnchor.blockNumber !== state.deployBlock) ||
      !iso(state.lastValidatedAt) || !iso(state.lastDetectedAt) ||
      !["complete", "partial", "unavailable"].includes(state.coverageStatus) ||
      !(state.coverageReason === null || ["NOT_INITIALIZED", "UNVERIFIED_CHECKPOINT", "BACKFILL_INCOMPLETE", "REORG_REBUILD", "RPC_UNAVAILABLE", "CAPACITY", "INVALID_LOG", "COVERAGE_MISMATCH"].includes(state.coverageReason)) ||
      !["unchecked", "clear", "detected", "rebuilding"].includes(state.reorgState) ||
      (state.cutoff !== null && BigInt(state.cutoff.blockNumber) + 1n !== BigInt(state.nextBlock)) ||
      (state.target !== null && BigInt(state.target.blockNumber) < BigInt(state.deployBlock)) ||
      (state.coverageStatus === "complete" && (!state.startAnchor || !state.cutoff || !state.target || state.cutoff.blockNumber !== state.target.blockNumber || state.cutoff.blockHash !== state.target.blockHash || state.cutoff.timestamp !== state.target.timestamp || state.coverageReason !== null || state.reorgState !== "clear")) ||
      (state.coverageStatus !== "complete" && state.coverageReason === null)) throw new Error("ACTIVITY_STATE_INVALID");
}
function validateEvent(event: ActivityEvent, deployment: ActivityDeployment) {
  let canonical: string | undefined;
  try { canonical = canonicalize(JSON.parse(event.payload)); } catch { throw new Error("ACTIVITY_INVALID_LOG"); }
  if (event.chainId !== deployment.chainId || event.contract !== deployment.contract || !hash(event.transactionHash) || !hash(event.blockHash) ||
      !uint(event.logIndex, 64) || !uint(event.blockNumber, 64) || !uint(event.transactionIndex, 64) || !uint(event.blockTimestamp, 64) ||
      (event.demandId !== null && (!uint(event.demandId) || event.demandId === "0")) || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.eventName) ||
      Buffer.byteLength(event.payload, "utf8") > 8192 || canonical !== event.payload ||
      event.payloadHash !== createHash("sha256").update(event.payload).digest("hex")) throw new Error("ACTIVITY_INVALID_LOG");
}
function stateFromRow(row: StateRow): ActivityState {
  const { startHash, startTimestamp, cutoffBlock, cutoffHash, cutoffTimestamp, targetBlock, targetHash, targetTimestamp, ...rest } = row;
  if ((startHash === null) !== (startTimestamp === null)) throw new Error("ACTIVITY_STATE_INVALID");
  if ((cutoffBlock === null || cutoffHash === null || cutoffTimestamp === null) && !(cutoffBlock === null && cutoffHash === null && cutoffTimestamp === null)) throw new Error("ACTIVITY_STATE_INVALID");
  if ((targetBlock === null || targetHash === null || targetTimestamp === null) && !(targetBlock === null && targetHash === null && targetTimestamp === null)) throw new Error("ACTIVITY_STATE_INVALID");
  const state: ActivityState = { ...rest, startAnchor: startHash === null ? null : { blockNumber: row.deployBlock, blockHash: startHash, timestamp: startTimestamp! },
    cutoff: cutoffBlock === null ? null : { blockNumber: cutoffBlock, blockHash: cutoffHash!, timestamp: cutoffTimestamp! },
    target: targetBlock === null ? null : { blockNumber: targetBlock, blockHash: targetHash!, timestamp: targetTimestamp! } };
  validateState(state);
  return state;
}

export class ActivityStore {
  private db!: Database;
  private inode = 0;
  constructor(public readonly path: string, private readonly deployment: ActivityDeployment, private readonly maxEvents = 100_000) {
    validateDeployment(deployment);
    if (!isAbsolute(path) || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 1_000_000) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    try {
      const dir = lstatSync(dirname(path));
      if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700) throw new Error();
      try { closeSync(openSync(path, "wx", 0o600)); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
      const file = lstatSync(path);
      if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.() || (file.mode & 0o777) !== 0o600) throw new Error();
      this.inode = file.ino;
      this.db = new Database(path, { strict: true });
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      if (this.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL").get()?.journal_mode !== "wal") throw new Error();
      let existed = false;
      this.db.transaction(() => {
        const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
        if (version === 0) this.db.exec("CREATE TABLE activity_events (chainId TEXT NOT NULL, contract TEXT NOT NULL, transactionHash TEXT NOT NULL, logIndex TEXT NOT NULL, blockNumber TEXT NOT NULL, blockHash TEXT NOT NULL, transactionIndex TEXT NOT NULL, blockTimestamp TEXT NOT NULL, eventName TEXT NOT NULL, demandId TEXT, payload TEXT NOT NULL, payloadHash TEXT NOT NULL, PRIMARY KEY(chainId,contract,transactionHash,logIndex)); CREATE TABLE activity_state (chainId TEXT NOT NULL, contract TEXT NOT NULL, escrowToken TEXT NOT NULL, tokenDecimals INTEGER NOT NULL, deployBlock TEXT NOT NULL, nextBlock TEXT NOT NULL, startHash TEXT, startTimestamp TEXT, cutoffBlock TEXT, cutoffHash TEXT, cutoffTimestamp TEXT, targetBlock TEXT, targetHash TEXT, targetTimestamp TEXT, coverageStatus TEXT NOT NULL, coverageReason TEXT, lastValidatedAt TEXT, reorgState TEXT NOT NULL, lastDetectedAt TEXT, PRIMARY KEY(chainId,contract)); PRAGMA user_version=1;");
        else if (version !== 1) throw new Error();
        const rows = this.db.query<StateRow, []>("SELECT * FROM activity_state").all();
        if (version === 0 && rows.length === 0) this.db.query("INSERT INTO activity_state(chainId,contract,escrowToken,tokenDecimals,deployBlock,nextBlock,coverageStatus,coverageReason,reorgState) VALUES(?,?,?,?,?,?,'unavailable','NOT_INITIALIZED','unchecked')").run(deployment.chainId, deployment.contract, deployment.escrowToken, deployment.tokenDecimals, deployment.deployBlock, deployment.deployBlock);
        else {
          if (rows.length !== 1) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
          const state = stateFromRow(rows[0]!);
          if (state.chainId !== deployment.chainId || state.contract !== deployment.contract || state.escrowToken !== deployment.escrowToken || state.tokenDecimals !== deployment.tokenDecimals || state.deployBlock !== deployment.deployBlock) throw new Error("ACTIVITY_DEPLOYMENT_MISMATCH");
          existed = true;
        }
      }).immediate();
      this.integrity();
      if (existed) this.db.query("UPDATE activity_state SET coverageStatus='unavailable',coverageReason='UNVERIFIED_CHECKPOINT',lastValidatedAt=NULL,reorgState=CASE WHEN reorgState IN ('detected','rebuilding') THEN reorgState ELSE 'unchecked' END").run();
    } catch (error) {
      this.db?.close();
      if (error instanceof Error && error.message === "ACTIVITY_DEPLOYMENT_MISMATCH") throw error;
      throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    }
  }
  private available() {
    const file = lstatSync(this.path), dir = lstatSync(dirname(this.path));
    if (!file.isFile() || file.isSymbolicLink() || file.ino !== this.inode || file.uid !== process.getuid?.() || (file.mode & 0o777) !== 0o600 ||
        !dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
  }
  integrity() {
    this.available();
    const tables = this.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if (tables.map((row) => row.name).join(",") !== "activity_events,activity_state") throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    const expected = { activity_events: "chainId,contract,transactionHash,logIndex,blockNumber,blockHash,transactionIndex,blockTimestamp,eventName,demandId,payload,payloadHash", activity_state: "chainId,contract,escrowToken,tokenDecimals,deployBlock,nextBlock,startHash,startTimestamp,cutoffBlock,cutoffHash,cutoffTimestamp,targetBlock,targetHash,targetTimestamp,coverageStatus,coverageReason,lastValidatedAt,reorgState,lastDetectedAt" };
    for (const table of ["activity_events", "activity_state"] as const) {
      const columns = this.db.query<{ name: string; pk: number }, []>("PRAGMA table_info(" + table + ")").all();
      const primary = columns.filter((row) => row.pk > 0).sort((a, b) => a.pk - b.pk).map((row) => row.name).join(",");
      if (columns.map((row) => row.name).join(",") !== expected[table] ||
          primary !== (table === "activity_events" ? "chainId,contract,transactionHash,logIndex" : "chainId,contract")) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    }
    if (this.db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
        this.db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous !== 2) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    if (this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM activity_events").get()!.count > this.maxEvents) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    const state = this.state();
    for (const event of this.events()) {
      validateEvent(event, this.deployment);
      if (BigInt(event.blockNumber) < BigInt(state.deployBlock) || BigInt(event.blockNumber) >= BigInt(state.nextBlock)) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    }
  }
  state(): ActivityState {
    this.available();
    const rows = this.db.query<StateRow, []>("SELECT * FROM activity_state").all();
    if (rows.length !== 1) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
    return stateFromRow(rows[0]!);
  }
  private writeState(state: ActivityState) {
    validateState(state);
    this.db.query("UPDATE activity_state SET nextBlock=?,startHash=?,startTimestamp=?,cutoffBlock=?,cutoffHash=?,cutoffTimestamp=?,targetBlock=?,targetHash=?,targetTimestamp=?,coverageStatus=?,coverageReason=?,lastValidatedAt=?,reorgState=?,lastDetectedAt=? WHERE chainId=? AND contract=?")
      .run(state.nextBlock, state.startAnchor?.blockHash ?? null, state.startAnchor?.timestamp ?? null, state.cutoff?.blockNumber ?? null, state.cutoff?.blockHash ?? null, state.cutoff?.timestamp ?? null, state.target?.blockNumber ?? null, state.target?.blockHash ?? null, state.target?.timestamp ?? null, state.coverageStatus, state.coverageReason, state.lastValidatedAt, state.reorgState, state.lastDetectedAt, state.chainId, state.contract);
  }
  updateState(expectedNextBlock: string, update: (state: ActivityState) => ActivityState) {
    this.available();
    return this.db.transaction(() => {
      const state = this.state();
      if (state.nextBlock !== expectedNextBlock) throw new Error("ACTIVITY_CHECKPOINT_CONFLICT");
      const next = update(state);
      if (next.chainId !== state.chainId || next.contract !== state.contract || next.escrowToken !== state.escrowToken || next.tokenDecimals !== state.tokenDecimals || next.deployBlock !== state.deployBlock || next.nextBlock !== state.nextBlock || JSON.stringify(next.cutoff) !== JSON.stringify(state.cutoff) || (state.startAnchor && JSON.stringify(next.startAnchor) !== JSON.stringify(state.startAnchor))) throw new Error("ACTIVITY_STATE_INVALID");
      this.writeState(next);
      return next;
    }).immediate();
  }
  commitPage(expectedNextBlock: string, end: ActivityAnchor, events: ActivityEvent[]) {
    this.available();
    return this.db.transaction(() => {
      const state = this.state();
      if (state.reorgState === "detected") throw new Error("ACTIVITY_REORG");
      if (state.nextBlock !== expectedNextBlock) {
        if (!uint(expectedNextBlock, 64) || !anchorValid(end) || !state.cutoff ||
            JSON.stringify(state.cutoff) !== JSON.stringify(end) || BigInt(expectedNextBlock) > BigInt(end.blockNumber) ||
            BigInt(end.blockNumber) - BigInt(expectedNextBlock) >= 100n) throw new Error("ACTIVITY_CHECKPOINT_CONFLICT");
        const stored = this.events().filter((row) => BigInt(row.blockNumber) >= BigInt(expectedNextBlock) && BigInt(row.blockNumber) <= BigInt(end.blockNumber));
        const byIdentity = new Map(stored.map((row) => [row.transactionHash + ":" + row.logIndex, row]));
        const identities = new Set<string>();
        for (const event of events) {
          validateEvent(event, this.deployment);
          const identity = event.transactionHash + ":" + event.logIndex;
          const prior = byIdentity.get(identity);
          if (!prior || Object.keys(event).some((key) => event[key as keyof ActivityEvent] !== prior[key as keyof ActivityEvent])) throw new Error("ACTIVITY_EVENT_CONFLICT");
          identities.add(identity);
        }
        if (identities.size !== stored.length) throw new Error("ACTIVITY_EVENT_CONFLICT");
        return state;
      }
      if (!anchorValid(end) || BigInt(end.blockNumber) < BigInt(expectedNextBlock) || BigInt(end.blockNumber) - BigInt(expectedNextBlock) >= 100n || !state.target || BigInt(end.blockNumber) > BigInt(state.target.blockNumber)) throw new Error("ACTIVITY_STATE_INVALID");
      const find = this.db.query<ActivityEvent, [string, string, string, string]>("SELECT * FROM activity_events WHERE chainId=? AND contract=? AND transactionHash=? AND logIndex=?");
      const insert = this.db.query("INSERT INTO activity_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
      let count = this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM activity_events").get()!.count;
      for (const event of events) {
        validateEvent(event, this.deployment);
        if (BigInt(event.blockNumber) < BigInt(expectedNextBlock) || BigInt(event.blockNumber) > BigInt(end.blockNumber)) throw new Error("ACTIVITY_INVALID_LOG");
        const previous = find.get(event.chainId, event.contract, event.transactionHash, event.logIndex);
        if (previous) {
          if (Object.keys(event).some((key) => event[key as keyof ActivityEvent] !== previous[key as keyof ActivityEvent])) throw new Error("ACTIVITY_EVENT_CONFLICT");
          continue;
        }
        if (++count > this.maxEvents) throw new Error("ACTIVITY_CAPACITY");
        insert.run(event.chainId, event.contract, event.transactionHash, event.logIndex, event.blockNumber, event.blockHash, event.transactionIndex, event.blockTimestamp, event.eventName, event.demandId, event.payload, event.payloadHash);
      }
      const next: ActivityState = { ...state, nextBlock: (BigInt(end.blockNumber) + 1n).toString(), cutoff: end, coverageStatus: "partial", coverageReason: state.reorgState === "rebuilding" ? "REORG_REBUILD" : "BACKFILL_INCOMPLETE", lastValidatedAt: null };
      this.writeState(next);
      return next;
    }).immediate();
  }
  events(): ActivityEvent[] {
    this.available();
    return this.db.query<ActivityEvent, []>("SELECT * FROM activity_events ORDER BY length(blockNumber),blockNumber,length(transactionIndex),transactionIndex,length(logIndex),logIndex").all();
  }
  resetForReorg(detectedAt: string) {
    this.available();
    return this.db.transaction(() => {
      const state = this.state();
      const next: ActivityState = { ...state, nextBlock: state.deployBlock, startAnchor: null, cutoff: null, target: null, coverageStatus: "unavailable", coverageReason: "REORG_REBUILD", lastValidatedAt: null, reorgState: "rebuilding", lastDetectedAt: detectedAt };
      validateState(next);
      this.db.query("DELETE FROM activity_events WHERE chainId=? AND contract=?").run(state.chainId, state.contract);
      this.writeState(next);
      return next;
    }).immediate();
  }
  backup(destination: string) {
    this.available();
    if (!isAbsolute(destination)) throw new Error("ACTIVITY_BACKUP_INVALID");
    const dir = lstatSync(dirname(destination));
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700) throw new Error("ACTIVITY_BACKUP_INVALID");
    this.db.query("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
  }
  close() { this.db.close(); }
}
