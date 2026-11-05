import { existsSync } from "node:fs";
import { ActivityStore } from "./activity-store.ts";
import { loadConfig } from "./contract.ts";
import { loadOperationalConfig } from "./config.ts";

let store: ActivityStore | undefined;
try {
  const [command, destination, ...extra] = process.argv.slice(2);
  if (extra.length || !((command === "integrity" && !destination) || (command === "backup" && destination))) throw new Error();
  const config = loadOperationalConfig();
  const deployment = loadConfig().deployment;
  if (!deployment || !config.activityDbPath || !existsSync(config.activityDbPath)) throw new Error();
  store = new ActivityStore(config.activityDbPath, {
    chainId: String(deployment.chainId), contract: deployment.contract.toLowerCase(),
    escrowToken: deployment.escrowToken.address.toLowerCase(), tokenDecimals: deployment.escrowToken.decimals,
    deployBlock: deployment.deployBlock.toString(),
  }, config.activityMaxEvents);
  if (command === "integrity") {
    store.integrity();
    console.log(JSON.stringify({ integrity: "ok" }));
  } else if (command === "backup" && destination) {
    store.backup(destination);
    console.log(JSON.stringify({ backup: "ok" }));
  } else throw new Error();
} catch {
  console.error(JSON.stringify({ code: "ACTIVITY_OPERATION_FAILED" }));
  process.exitCode = 1;
} finally { store?.close(); }
