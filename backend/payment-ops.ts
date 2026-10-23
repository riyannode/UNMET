import { existsSync } from "node:fs";
import { PaymentStore } from "./payment-store.ts";
import { reconcilePayments } from "./durable-payment.ts";
import { createOfficialFacilitator } from "./server.ts";
import { loadOperationalConfig } from "./config.ts";

let store: PaymentStore | undefined;
try {
  const config = loadOperationalConfig();
  if (!config.paymentDbPath || !existsSync(config.paymentDbPath)) throw new Error();
  store = new PaymentStore(config.paymentDbPath, config.paymentMaxRecords);
  const [command, destination] = process.argv.slice(2);
  if (command === "integrity") {
    store.integrity();
    console.log(JSON.stringify({ integrity: "ok" }));
  } else if (command === "reconcile") {
    // Run with the API stopped; converts interrupted reservations before status-only queries.
    store.recoverInterrupted();
    console.log(JSON.stringify(await reconcilePayments(store, createOfficialFacilitator())));
  } else if (command === "cleanup") {
    console.log(JSON.stringify({ removed: store.cleanup(config.paymentRetentionDays * 86_400_000) }));
  } else if (command === "backup" && destination) {
    store.backup(destination);
    console.log(JSON.stringify({ backup: "ok" }));
  } else throw new Error();
} catch {
  console.error(JSON.stringify({ code: "PAYMENT_OPERATION_FAILED" }));
  process.exitCode = 1;
} finally { store?.close(); }
