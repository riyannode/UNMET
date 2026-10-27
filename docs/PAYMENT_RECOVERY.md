# Durable x402 payment operations

Durability applies to **one self-hosted Bun API replica with its local Docker volume**. SQLite stores payment operations, not demand state or paid response bodies. The contract and official OKX facilitator remain authoritative.

## Lifecycle and integration

Installed packages: @okxweb3/x402-core 0.1.0, @okxweb3/x402-express 0.1.1, @okxweb3/x402-evm 0.2.1. The Express SDK verifies payment, buffers API execution, skips settlement for unsuccessful execution, settles, then flushes the response. We wrap the official facilitator, without replacing its verification, signing, settlement, or EVM exact scheme. syncSettle remains true.

Validation, route/IP limits and admission still run before the SDK. SQLite reservations happen only after official verification returns isValid=true. Each short synchronous transaction completes before network work begins. The optional Idempotency-Key is 1–128 printable non-space ASCII characters; existing payment-signature clients need no new required header. CORS permits the optional header.

~~~text
official verification valid
    -> VERIFIED (unique reservation committed)
    -> SETTLEMENT_IN_FLIGHT (committed before official settle)
    -> persisted transaction hash checkpoint
    -> bounded read-only settle-status polling for initial pending/timeout
    -> SETTLED (matching facilitator success plus canonical Mainnet L2 receipt proof)
    -> UNKNOWN (unresolved/failed status, identity mismatch, transport error or invalid proof)

VERIFIED -> CANCELLED (execution failed/disconnected before settlement)
VERIFIED / SETTLEMENT_IN_FLIGHT -> UNKNOWN (restart)
UNKNOWN -> SETTLED (strict official status plus the same canonical L2 receipt proof)
UNKNOWN -> FAILED (explicit matching official failed status)
UNKNOWN -> UNKNOWN (query unresolved)
~~~

FAILED requires an explicit matching official failed status during the separate UNKNOWN recovery flow; its provider error text is expected. A failed or contradictory result from settle alone remains ambiguous. A transaction hash returned by settle is committed before any RPC proof. For exact `syncSettle=true`, OKX documents `pending` as an asynchronous broadcast and `timeout` as a synchronous wait timeout; neither means the transaction failed. Both trigger a bounded, read-only `getSettleStatus` poll for the checkpointed hash. Polls use the existing `RPC_TIMEOUT_MS` budget and bounded facilitator transport/concurrency, with backoff. Only matching `success` proceeds; pending/not-found and transient transport or HTTP 429/5xx outcomes may be observed again within the budget. Failed, malformed, contradictory, identity-mismatched and other HTTP error responses stop immediately. A successful facilitator status is still followed by the full canonical proof below before `SETTLED` or content release. No status path calls settle again. Missing or unavailable Mainnet proof remains blocked; it is never retried by submitting settlement again. Confirmation checks chain ID 196, supported legacy/access-list/dynamic-fee transaction envelopes, transaction/receipt/block/log references, direct token `transferWithAuthorization` calldata, matching `AuthorizationUsed` and `Transfer` logs, and block timestamp bounds. It rejects blob, delegated-account and unknown transaction types, wrappers, multicalls and unknown selectors. It uses current canonical L2 inclusion, not safe/finalized or L1 finality. A successful historical authorization can be expired now as long as its inclusion timestamp was within its signed bounds.

## Schema and identity

The existing inline schema-version-1 DDL is unchanged; no migration is required. Its single table stores: internal UUID, unique payment fingerprint, separate request binding fingerprint, optional unique logical-key fingerprint, network, recipient, amount, verified payer, authorization expiry (`validBefore` in milliseconds), state, transaction hash, timestamps and stable error classification. No raw signatures, response bodies, private keys or OKX secrets are stored.

Payment identity is SHA-256 of normalized network, token contract, payer and EIP-3009 nonce. It deliberately excludes request content and signature bytes: serialization, address case, alternate signatures or a changed request cannot create a second operation for the same nonce. The separate binding covers method, route, canonical validated filters/defaults, payment terms and expected requirements. Logical keys are hashed and scoped to verified payer/network.

Concurrent duplicates and already-reserved authorizations return 409. The same logical key with changed filters or a newly signed authorization returns 409 while its operation remains reserved. After confirmed pre-settlement CANCELLED with no transaction hash, a new valid authorization may reclaim the logical key. Reclamation and the new reservation share one immediate transaction; failure rolls both back. The original record and unique payment fingerprint remain protected against replay. UNKNOWN, SETTLEMENT_IN_FLIGHT and SETTLED never release the key. No paid result is replayed, including for a settled operation or an arbitrary key. Official verification still runs on retries; a consumed authorization belonging to a known operation produces a duplicate conflict instead of a misleading new-payment challenge.

**Without a stable logical key, a fresh nonce is a distinct payment and can charge again for the same logical request.** Clients must retain their key across retries and must not automatically create a new authorization after a 409/ambiguous response.

Current X Layer exact assets use EIP-3009. Durable mode rejects unsupported authorization shapes, including Permit2, instead of guessing their identity. Adding a scheme requires a dedicated verified identity implementation and tests.

## Storage and capacity

Compose fixes PAYMENT_DB_PATH=/data/payments.sqlite and mounts payment_data. The API remains non-root, with a read-only root filesystem and no published API/database ports. The image creates /data owned by bun; a fresh named volume inherits that ownership. Directory mode is 0700; database/WAL/SHM use 0600. Existing host mounts must already be writable by the container UID. No root entrypoint changes ownership automatically.

SQLite uses WAL, synchronous=FULL, busy_timeout=5000 and foreign_keys=ON; initialization checks schema and integrity. Missing storage directories, unsupported versions, corruption, permission failures, deleted/replaced database files and failed writes never select an in-memory fallback. Failed initialization prevents API startup. A writable database can be created in the configured existing private directory.

PAYMENT_MAX_RECORDS defaults to 100000 (1–1000000); exhaustion fails closed. Metadata is bounded by schema constraints and fixed hashes. PAYMENT_RETENTION_DAYS defaults to 30 (1–3650). Startup and operator cleanup remove at most 1000 terminal rows whose retention interval **and authorization validity** have ended. Active/UNKNOWN rows never expire to free space. Run cleanup repeatedly when needed; no worker or automatic payment retry is installed. Deleted pages are reused by SQLite; WAL checkpoints and physical disk capacity still require normal operator attention.

FULL WAL adds synchronous disk commits. The [PR #14 local verification](PAYMENT_VERIFICATION.md), dated 2026-10-23, sampled 100 reserve+cancel operations: p50 3.39 ms, p95 4.32 ms, p99 4.79 ms. These are historical local disk measurements, not production throughput or facilitator latency guarantees. A busy transaction can block the Bun event loop for up to five seconds. One local filesystem and one API replica are required; do not share this volume across hosts or use network filesystems.

## Operator reconciliation

Stop the API **before reconcile**. This is a mandatory operator precondition, not an enforced distributed lock: the command marks all interrupted reservations UNKNOWN. Running it concurrently can disrupt active requests. Do not start a second API process against this database.

~~~bash
docker compose stop api
docker compose run --rm --no-deps api bun run backend/payment-ops.ts reconcile
docker compose up -d api
~~~

The command checks up to 20 hash-bearing UNKNOWN records, sequentially, with a 30-second batch deadline between records. An active facilitator-status query and its receipt-proof RPC calls can extend the pass by their individually bounded timeouts. Hashless records cannot starve hash-bearing recovery. Output contains counts only. Rerun bounded passes if necessary. Missing hashes remain unresolved.

Other operator commands:

~~~bash
docker compose exec -T api bun run backend/payment-ops.ts integrity
docker compose exec -T api bun run backend/payment-ops.ts cleanup
~~~

No public recovery endpoint exists. A confirmed status does not recover the original resource response.

## Backup, restore and rollback

Keep backups private; the database contains payer/payment metadata. Never commit it or bake it into an image.

Use SQLite's consistent VACUUM INTO snapshot, which includes committed WAL contents. Do not copy only payments.sqlite from a running volume.

~~~bash
docker compose exec -T api mkdir -m 700 -p /data/backups
docker compose exec -T api bun run backend/payment-ops.ts backup /data/backups/payments-known-good.sqlite
docker compose cp api:/data/backups/payments-known-good.sqlite ./payments-known-good.sqlite
chmod 600 ./payments-known-good.sqlite
~~~

Use a fresh destination filename; backup refuses to overwrite a file. Store an off-host private backup separately. For restore:

1. Stop the API and back up the **current** database first.
2. Use a one-off container running as bun on payment_data to restore the snapshot to /data/payments.sqlite, mode 0600. Remove stale payments.sqlite-wal and payments.sqlite-shm only while every database connection is stopped. Keep a copy of the complete old database/WAL/SHM set if investigating corruption.
3. Run integrity with a one-off API container, then start the API. Startup reclassifies interrupted operations UNKNOWN.
4. Reconcile known hashes before resuming affected payment operations.

**Restoring an older snapshot can forget payments settled since the snapshot and reopen duplicate-settlement attempts.** Keep paid traffic stopped until missing operations have been reconciled with authoritative facilitator records. An older backup is not safe proof that an authorization is unused.

docker compose down preserves payment_data; never use down -v for real payment data. Updates and rollbacks must retain the volume and use an image supporting its schema version. Never roll paid traffic back to a pre-durability image as a recovery strategy. Unknown future schema versions fail closed. No destructive migration is performed.

Interrupted shutdown/crash leaves a durable pre-settlement marker or an UNKNOWN operation. If OKX submitted a payment but the process died before receiving/persisting its transaction hash, the hash-only status API cannot resolve it automatically. Operator investigation with OKX is required; do not delete its identity or resubmit settlement. Storage failure after receiving a hash preserves it when a subsequent write is possible; a persistent disk failure can still lose that observation.

## Platform and delivery limits

With PAYMENT_DB_PATH unset, the service can still serve unpaid SDK challenges, but requests carrying payment headers receive 503 PAYMENT_STORAGE_UNAVAILABLE and readiness fails. No ephemeral filesystem is advertised as durable. Docker cannot disable persistence through an env override because Compose fixes its required path.

This prevents multiple independent settlements for retained identities under the single-replica deployment assumptions. It does **not** provide distributed exactly-once settlement across SQLite and OKX: there is no atomic transaction spanning those systems. PR #17 records historical isolated Docker staging acceptance at commit `cb346e2a73de917a01e2555363d6b54f4e4a58a7`: three Mainnet assets reached HTTP 200 and `SETTLED` after current-canonical L2 confirmation. Each response had an empty opportunity list, so nonempty paid results were not exercised. This evidence does not establish Ethereum L1 finality, a current public deployment, or a fresh acceptance run; no payment was authorized by this documentation update.

This confirmer is Mainnet-only. Nonproduction 1952 challenges retain the existing Testnet asset selection, but durable paid acceptance is unsupported under this policy. The PR #17 staging run exercised direct paid calls through an isolated Docker deployment; it does not establish acceptance on a hosted public deployment. Verify any current hosted deployment separately before relying on its paid content delivery.

References: [official OKX payment API](https://web3.okx.com/onchainos/dev-docs/payments/api-http-onetime), [installed SDK source](https://github.com/okx/payments), [Bun SQLite](https://bun.com/docs/runtime/sqlite), [SQLite WAL](https://www.sqlite.org/wal.html), [SQLite pragmas](https://www.sqlite.org/pragma.html).
