import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ActivityStore } from "./activity-store.ts";

assert.notEqual(process.getuid?.(), 0);
const dir = mkdtempSync(join(tmpdir(), "activity-smoke-"));
const deployment = { chainId: "1952", contract: "0x3333333333333333333333333333333333333333", escrowToken: "0x4444444444444444444444444444444444444444", tokenDecimals: 6, deployBlock: "0" };
try {
  const store = new ActivityStore(join(dir, "activity.sqlite"), deployment);
  try {
    assert.equal(store.state().coverageReason, "NOT_INITIALIZED");
    store.integrity();
    store.backup(join(dir, "backup.sqlite"));
  } finally { store.close(); }
  const restored = new ActivityStore(join(dir, "backup.sqlite"), deployment);
  try { restored.integrity(); } finally { restored.close(); }
  const env = { PATH: process.env.PATH, CHAIN_ID: deployment.chainId, DEMAND_CONTRACT: deployment.contract,
    DEMAND_DEPLOY_BLOCK: deployment.deployBlock, PAYMENT_TOKEN: deployment.escrowToken,
    PAYMENT_TOKEN_DECIMALS: String(deployment.tokenDecimals), ACTIVITY_DB_PATH: join(dir, "activity.sqlite") };
  const cli = join(import.meta.dir, "activity-ops.ts");
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, "integrity"], { env, encoding: "utf8" })), { integrity: "ok" });
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, "backup", join(dir, "cli-backup.sqlite")], { env, encoding: "utf8" })), { backup: "ok" });
} finally { rmSync(dir, { recursive: true }); }
console.log("Activity storage and backup smoke passed.");
