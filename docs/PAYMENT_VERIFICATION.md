# SQLite payment verification — 2026-10-23

Base: origin/main 448c949 (merged PR #13). Checkout: /home/acer/projects/UNMET inside Ubuntu-24.04 WSL2. No Windows source checkout was changed.

Tools: Bun 1.4.3, Docker 29.7.2, Compose 5.5.1, Git 2.43.0, Foundry 1.8.3. Production API image remains Bun 1.4.2; its native SQLite reports 3.53.2.

## Automated checks

| Check | Result |
| --- | --- |
| bun install --frozen-lockfile | Passed, no dependency or lockfile changes |
| Backend / frontend typechecks | Passed |
| Existing backend tests | 41 passed |
| New native SQLite / durable SDK tests | 30 passed |
| Frontend tests | 100 passed |
| Foundry tests | 19 passed |
| Frontend production build | Passed, existing chunk-size warning |
| Local Vercel CLI 65.2.0 Preview build | Passed, no deployment |
| Node import of compiled Express app with dependencies supplied | Passed with VERCEL=1 and no storage path; SQLite not loaded |
| docker compose config --quiet | Passed without printing resolved credentials |
| Production API/web image builds | Passed |
| git diff --check | Passed |

The original backend suite and new storage suite run in separate Bun invocations: native SQLite busy_timeout blocks synchronously, and API tests share process-local index state. No existing test was deleted or skipped.

## Required security / recovery cases

| Requirement | Evidence |
| --- | --- |
| Initialization, schema version, WAL/FULL and atomic changes | payment-store tests; constructor validates PRAGMAs; future schema rejected |
| Concurrent identical requests and duplicate authorization | Real official Express/core middleware with injected offline facilitator; one fixture settlement, duplicate 409 |
| Conflicting payload/key, new authorization under same key | 409, no second fixture settlement |
| Distinct payment identities | Independent nonces settle independently in fixtures |
| Official verification failure | No reservation or settlement; unpaid/invalid challenge preserved |
| Confirmed success / terminal failure | Durable SETTLED before content; official status fixture confirms FAILED |
| Timeout before hash / after hash | UNKNOWN; known hash retained; no resubmission |
| Pending or inconsistent status | UNKNOWN; no paid content; later bounded official status query can resolve |
| Disconnect during verification / settlement | No second settlement; existing admission tests still pass |
| Process crash and restart | Actual child process SIGKILL with real SQLite/WAL files; durable marker recovered UNKNOWN |
| Retry after restart | Reopened file and recreated Docker API reject the retained identity |
| SQLite busy / unavailable / corrupt | Busy bounded to configured five-second timeout; missing/unwritable/corrupt storage rejects operation |
| Deleted/replaced or read-only file | Availability guard blocks new settlement |
| Retention / capacity | Unknown records retained; terminal cleanup waits authorization expiry and retention; cap fails closed |
| Arbitrary key / consumed nonce | No paid content replay; known consumed nonce yields conflict instead of another payment challenge |
| Storage failure after OKX result | Buffered paid content withheld; observed hash retained when subsequent write succeeds |
| Recovery fairness | Hashless records and repeatedly throwing queries cannot permanently hide later recoverable records |

All paid lifecycle tests use deterministic injected facilitator fixtures and actual temporary SQLite files. No signed authorization was sent to the live facilitator. The production code retains the official OKX client and has no mock-payment runtime mode.

## Docker acceptance

Isolated Compose project: unmet-sqlite-pr14; named database volume unmet-sqlite-pr14_payment_data.

- Caddy -> API: /live, /ready, /health return 200.
- Direct SPA deep link /market/example returns 200 text/html.
- /v1/not-found returns JSON 404.
- Actual unpaid POST /v1/opportunities through Caddy returns official HTTP402, payment-required header, x402Version2, exact/eip155:196/amount10000.
- API is user bun, read-only root, no published host port. /data mode0700, database/WAL/SHM mode0600, UID1000.
- Isolated non-sensitive fixture row written IN_FLIGHT, API stopped and recreated without removing volume: row survived as UNKNOWN; repeat reserve returned PAYMENT_ALREADY_RESERVED.
- New image started with missing storage directory, no network and required runtime configuration: exit1 with sanitized STARTUP_UNAVAILABLE.
- Integrity check succeeds after normal API restart. Native tests separately cover corrupt/unwritable/locked storage and valid reopen.
- Idle sample: API33.54MiB/512MiB and0.15%CPU; Caddy12.34MiB/128MiB and0%CPU. This is not a capacity benchmark.
- Local disk sample: 100 reserve+cancel FULL/WAL operations, p50=3.39ms,p95=4.32ms,p99=4.79ms. No upstream traffic in that measurement.

Caddy matches the configured localhost Host. A request using a different Host does not prove application routing; acceptance above used http://localhost:18080.

## Security and boundaries

Exact scans against the three private developer OKX values found zero matches in tracked/new source, frontend/Vercel build artifacts and both saved image archives (including gzip layer contents). Runtime secrets remain in ignored .env and the API runtime environment; no secret-bearing resolved Compose configuration was printed.

Contracts, ABIs, deployed addresses, wallet configuration, frontend UI, indexing behavior and production Vercel settings were not changed. Local Vercel build was performed in a disposable copy; no public deployment occurred. No merge, real payment or onchain write occurred.

Task-owned Compose containers/network are stopped and removed after acceptance. The named test volumes remain intact to preserve restart evidence; no persistent local server is left running.

## Remaining payment acceptance

This is a single-replica foundation, not distributed exactly-once settlement. Live paid settlement, authoritative onchain finality, real payer resource delivery, and a deployed Vercel runtime for these changes were not tested or authorized. A crash between external submission and hash persistence remains manually ambiguous. Original paid responses are not cached/replayed. New authorization without a stable logical key can be a second payment. See [payment recovery](PAYMENT_RECOVERY.md) for operator actions and backup/rollback limits.
