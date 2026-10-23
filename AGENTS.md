# UNMET coding-agent guide

Read this file before editing. It applies to the repository; inspect any more-specific instructions in the area you touch. Use the task map below to find the relevant subsystem, then follow its imports, callers, tests and documentation.

## Project overview

UNMET is an onchain demand market for AI-agent capabilities that users need but cannot yet buy. Requesters and supporters fund demand; builders discover funded opportunities and propose a service; agents can separately buy ranked demand intelligence.

The demand lifecycle is create → support → builder proposal → commitment-weighted review → finalize or eligible refund/reopen. Submission fixes the review escrow and approval quorum. Only explicit approver funds settle to the builder and treasury; eligible non-approver commitments remain refundable.

Demand funding and API billing are separate:
- Demand-market reads, wallet actions and escrow use X Layer Testnet `1952` in the current setup.
- `POST /v1/opportunities` sells demand intelligence through official OKX x402. Production billing requires X Layer Mainnet `196` independently of the market network.
- An intelligence payment does not fund a demand, buy service execution or change escrow state.

## Repository map

```text
UNMET/
├── AGENTS.md, README.md, CONTRIBUTING.md
├── package.json, bun.lock             # Bun workspaces and root commands
├── compose.yaml, .dockerignore        # Root build context and stack
├── .env.example, .gitignore, LICENSE
├── Docker/
│   ├── Dockerfile.api                 # Bun runtime, backend/start.ts
│   ├── Dockerfile.web                 # Vite build and Caddy runtime
│   └── Caddyfile                      # Static files, API proxy, SPA fallback
├── frontend/
│   ├── index.html, main.tsx, routing.ts
│   ├── App.tsx, Analytics.tsx
│   ├── CreateDemandChat.tsx, create-demand-chat-model.ts
│   ├── contract.ts, transaction-lifecycle.ts
│   ├── reown.ts, reown-status.ts
│   ├── app-state.ts, analytics.ts, capability.ts, errors.ts
│   ├── UnmetLanding.tsx, UnmetNavigation.tsx
│   ├── UnmetHowItWorks.tsx, UnmetFooter.tsx, MagicRings.tsx
│   ├── components/, hooks/, public/
│   ├── tests/                        # Wallet, routing, chat and transaction tests
│   └── package.json, tsconfig.json, vite.config.ts, vercel.json
├── backend/
│   ├── AgentDemand.sol, AgentDemand.t.sol, foundry.toml
│   ├── server.ts, start.ts, contract.ts
│   ├── config.ts, admission.ts, upstream.ts
│   ├── durable-payment.ts, payment-identity.ts
│   ├── payment-store.ts, payment-error.ts, payment-ops.ts
│   ├── admin.ts, payment-debug.ts
│   ├── server.test.ts, hardening.test.ts
│   ├── payment-store.test.ts, durable-payment.test.ts
│   └── package.json, tsconfig.json, tsconfig.bun.json, vercel.json
├── scripts/
│   ├── smoke-unpaid.ts                # Local HTTP acceptance; no signature
│   └── load-unpaid.ts                 # Bounded local unpaid probe
└── docs/                             # Current references, operations, history
```

Keep root manifests, lockfile, Compose, environment template and ignore files at root. Workspace manifests/configuration, Vite's HTML entrypoint, Vercel configuration and the browser race fixture stay in their functional locations.

Foundry runs from `backend/`, where source and tests are siblings. Its dependencies are ignored under `backend/lib/`; `admin.ts` resolves build artifacts under `backend/out/`. Preserve those paths. Asset attribution stays at `frontend/public/avatars/ATTRIBUTION.md` beside its SVGs; `.hallmark` records are historical evidence.

## System architecture

- `frontend/main.tsx` registers React Router routes. `/` is the landing page; `/docs` is a Coming Soon page. App routes are `/market`, `/market/:demandId`, `/create-demand` and `/analytics`.
- The app shell owns wallet/session orchestration. Reown AppKit is configured in `frontend/reown.ts`; `frontend/contract.ts` uses viem for direct RPC reads, approvals and contract writes. Ordinary demand actions do not pass through the Bun API.
- `backend/AgentDemand.sol` is authoritative for demand state, escrow balances, voting, settlement and refunds. Frontend and backend ABIs are hand-maintained consumers of that contract.
- `backend/server.ts` exports the Express app and implements API routes, health/readiness, demand indexing and ranking. `backend/start.ts` is the standalone Bun/container entrypoint.
- The backend index is disposable, process-local derived chain state. Reads use pinned blocks; canonical hashes, bounded log windows and atomic checkpoints protect refreshes and reorg recovery.
- Native `bun:sqlite` stores operational x402 reservations, idempotency and settlement records. It is not the escrow database. Self-hosting requires WAL, synchronous=FULL, one Bun API replica and persistent `payment_data:/data` at `/data/payments.sqlite`.
- Official OKX verification precedes buffered execution and settlement. Durable mode reserves the authorization, persists the in-flight marker before external settlement, and withholds content until confirmed success is persisted. Ambiguous results remain blocked for status-only recovery.
- Root Compose builds from `context: .` using `Docker/Dockerfile.api` and `Docker/Dockerfile.web`. Caddy serves the frontend and proxies `/v1`, `/v1/*`, `/live`, `/health` and `/ready` to the private API. Caddy replaces forwarded client identity; Express trusts only its configured hop.
- Vercel is a separate path: it imports the Express default export, initializes payments lazily and uses platform ingress identity. `PAYMENT_DB_PATH` must remain unset there; no durable SQLite guarantee applies to that runtime.

Read [Architecture](docs/ARCHITECTURE.md) for diagrams and detailed accounting/index behavior. Deployment configuration and historical receipts do not prove that a current public deployment is live or production-ready.

## Where to make changes

These are starting points, not isolated ownership boundaries. Trace the complete subsystem before changing its interface or behavior.

| Task | Start here; inspect related callers and tests |
| --- | --- |
| Workspace commands/dependencies | `package.json`, workspace manifests, `bun.lock`, `CONTRIBUTING.md` |
| Frontend routing | `frontend/main.tsx`, `frontend/routing.ts`, `frontend/tests/routing.test.ts`, `frontend/vercel.json` |
| App pages, wallet orchestration | `frontend/App.tsx`, `frontend/app-state.ts`, `frontend/tests/app-state.test.ts` |
| Guided Create Demand | `frontend/CreateDemandChat.tsx`, `frontend/create-demand-chat-model.ts`, `frontend/capability.ts`, `frontend/tests/create-demand-chat.test.ts` |
| Wallet connection/disconnect | `frontend/reown.ts`, `frontend/reown-status.ts`, `frontend/App.tsx`, `frontend/tests/wallet.test.ts`, `docs/WALLET_DISCONNECT.md` |
| Contract reads/writes and approvals | `frontend/contract.ts`, `frontend/transaction-lifecycle.ts`, `frontend/tests/transaction-lifecycle.test.ts` |
| Pending transaction recovery | `frontend/transaction-lifecycle.ts`, `frontend/App.tsx`, `frontend/errors.ts`, wallet/transaction tests |
| Sidebar and mobile navigation | `frontend/components/examples/c-sidebar-1.tsx`, `frontend/components/ui/sidebar.tsx`, `frontend/hooks/use-mobile.ts` |
| Landing and visual conventions | `frontend/UnmetLanding.tsx`, `frontend/UnmetHowItWorks.tsx`, `frontend/UnmetNavigation.tsx`, `frontend/UnmetFooter.tsx`, `frontend/MagicRings.tsx`, `docs/DESIGN.md` |
| Styles and reusable UI | `frontend/app.css`, `frontend/create-demand-chat.css`, `frontend/components/ui/`, `frontend/components/reui/`; landing styles remain in `frontend/` |
| Analytics and derived frontend state | `frontend/Analytics.tsx`, `frontend/analytics.ts`, `frontend/app-state.ts` |
| Escrow/economics and ABI | `backend/AgentDemand.sol`, `backend/AgentDemand.t.sol`, `backend/contract.ts`, `frontend/contract.ts` |
| API routes, schemas, index/ranking | `backend/server.ts`, `backend/contract.ts`, `backend/server.test.ts`, `docs/API.md` |
| Configuration, trust and bounded work | `backend/config.ts`, `backend/admission.ts`, `backend/upstream.ts`, `backend/hardening.test.ts` |
| SQLite reservations/state/backups | `backend/payment-store.ts`, `backend/payment-store.test.ts`, `docs/PAYMENT_RECOVERY.md` |
| x402 lifecycle and identity | `backend/durable-payment.ts`, `backend/payment-identity.ts`, `backend/payment-error.ts`, `backend/server.ts`, `backend/durable-payment.test.ts` |
| Payment operator commands | `backend/payment-ops.ts`, `docs/PAYMENT_RECOVERY.md`; reconciliation requires the API stopped |
| Contract/diagnostic operations | `backend/admin.ts`, `backend/payment-debug.ts`, `docs/RUNBOOK.md`, `docs/OKX_PAYMENT_DEBUG.md`; signing/deployment needs explicit authorization |
| Container configuration and smoke | `Docker/`, `compose.yaml`, `.dockerignore`, `.env.example`, `scripts/`, `docs/SELF_HOSTING.md` |
| Product/design reference | `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/PRD.md` |

## Development commands

Run from the repository root. See [Contributing](CONTRIBUTING.md) for prerequisites, Foundry dependency tags and complete environment setup. Ubuntu WSL2 is the verified Windows environment; other platforms are not claimed as verified.

```bash
bun install --frozen-lockfile
```

For local development, configure `.env` with `NODE_ENV=development`, `HOST=127.0.0.1`, the intended Testnet market, local frontend origin, public Reown inputs and your own OKX runtime credentials. Start these in separate terminals:

```bash
bun --env-file=.env run dev:backend
bun --env-file=.env run dev:frontend --host 127.0.0.1
```

Offline regression commands need no private credentials or signed payments. Use a checkout without `.env` to avoid Bun auto-loading operator configuration. Initial package/compiler downloads still need network access.

```bash
bun run test:frontend
bun run test:backend
bun run test:contract
bun run typecheck
bun run build:frontend
bun run check
```

`check` runs typechecks, frontend/backend tests, Foundry and frontend production build. Root `test` omits frontend. Backend tests intentionally run API/hardening and SQLite/durable suites in separate Bun invocations. Use the root frontend test script for its required preload. No lint script or CI workflow currently exists.

The real React session-race fixture is `frontend/tests/create-demand-chat-race.html`, served by Vite at `/tests/create-demand-chat-race.html`. It must finish with PASS; its synthetic outcomes send no wallet transactions. This is separate from interactive wallet acceptance.

For container verification, configure the private `.env` with Compose defaults and your own RPC/OKX/Reown settings. Execute from root:

```bash
docker compose config --quiet
docker compose build
docker compose up -d --build
```

Use an isolated Compose project, free ports and nonconflicting subnet for disposable tests. The unpaid smoke script accepts local HTTP origins only; match the configured hostname and port:

```bash
# Default localhost port 80 only:
BASE_URL=http://localhost bun scripts/smoke-unpaid.ts
# For HTTP_PORT=18080 and the matching local origin instead:
BASE_URL=http://localhost:18080 bun scripts/smoke-unpaid.ts
```

Use [Self-hosting](docs/SELF_HOSTING.md#health-smoke-checks-and-logs) for custom origins or public HTTPS verification. Do not print resolved secret-bearing Compose configuration. Stop only task-owned resources and confirm their ports are closed; preserve existing payment volumes.

## Critical invariants

### Escrow

- Keep contract state authoritative and fund movement explicitly authorized. Preserve fixed snapshot quorum, mutually exclusive votes, submission nonces, exact demand keys and refund/replacement protections.
- Settle only explicit approver funds; preserve eligible non-approver refunds and exact integer/token-decimal accounting. Keep ABI/event consumers synchronized when interface changes are explicitly in scope.
- Retain escrow, settlement, idempotency and concurrency regression coverage. A test receipt/hash is not production evidence.

### Wallet

- Bind every action to the intended provider, account, chain and explicit user intent; never silently substitute another wallet.
- Preserve receipt success, intent/replacement matching and state readback before reporting success. Keep wallet-scoped recovery records and compatibility keys.
- Treat broadcast/unknown outcomes as pending observation, not permission to submit again. Never blindly retry uncertain transactions. Read [wallet limitations](docs/WALLET_DISCONNECT.md) before changing disconnect/session handling.

### x402

- Keep official OKX verification/settlement and validation → quota → admission → payment ordering. No custom proof or payment bypass.
- Preserve SQLite atomic reservations, authorization uniqueness, request binding, logical-key protection and the existing durable state machine. Confirmed cancellation is distinct from ambiguous external settlement.
- Persist in-flight state before settlement. Never automatically retry an ambiguous settlement or release durable paid content without confirmed payment. Recovery queries status only; a missing hash may require operator investigation.
- Do not claim original paid-response replay or distributed exactly-once settlement. Keep Vercel's separate durability limits explicit.

### Infrastructure and data

- Preserve one Bun API replica, local WAL/FULL storage and separate `payment_data`, `caddy_data`, `caddy_config` volumes. Follow consistent backup/restore and rollback procedures; an older snapshot may forget settled operations.
- Keep private credentials out of source, logs, build arguments and public `VITE_*` values. Runtime allowlists exclude deployer keys; retain non-root/read-only containers and private API networking.
- Preserve Caddy client-IP replacement, explicit proxy trust, rate/admission limits, bounded RPC and canonical index/reorg checks.
- Deployment, production configuration, signed payments and onchain transactions need explicit authorization. Local smoke tests remain unpaid; changes to live infrastructure are separate work.

## Contributor workflow

1. Read this guide and locate the assigned subsystem using the task map.
2. Inspect the current branch, working tree, applicable instructions, code, documentation and tests. Preserve unrelated local changes.
3. Understand existing behavior and define a focused, verifiable outcome before editing.
4. Work on the assigned feature branch. For an existing Draft PR, update its branch instead of creating another branch/PR.
5. Implement the smallest correct change using existing names, components, strict types and conventions.
6. Run targeted checks and affected regressions; include build/container checks when paths or runtime packaging change.
7. Review the final diff for scope, secrets, generated files, broken links and unintended behavior. Report failed/unavailable checks honestly.
8. When delivery is authorized, stage intended files, commit and push; open or update the Draft PR with evidence and remaining limits.
9. Request review before merge. A cleanup task does not imply permission to merge or deploy.

## Coding principles

- **Think Before Coding:** understand code and requirements; surface material uncertainty and tradeoffs instead of silently guessing.
- **Simplicity First:** choose the simplest correct solution; add only the features and abstractions the task needs.
- **Surgical Changes:** change only what the task requires; preserve unrelated behavior, comments, formatting and conventions.
- **Goal-Driven Execution:** define checkable success criteria and prove the result with focused tests and validation.

## Documentation index

- [Documentation home](docs/README.md): current references, operations/security and historical evidence.
- [Product requirements](docs/PRD.md), [frontend behavior](docs/PRODUCT.md), [design/accessibility](docs/DESIGN.md).
- [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [canonical error reference](docs/ERRORS.md).
- [Self-hosting](docs/SELF_HOSTING.md), [payment recovery](docs/PAYMENT_RECOVERY.md), [runbook](docs/RUNBOOK.md), [wallet sessions](docs/WALLET_DISCONNECT.md).
- [Status](docs/STATUS.md), [self-hosting verification](docs/SELF_HOSTING_VALIDATION.md), [payment verification](docs/PAYMENT_VERIFICATION.md), [cleanup audit](docs/CLEANUP_AUDIT.md).
- [Demo](docs/DEMO.md), [submission](docs/SUBMISSION.md), [OKX debugging](docs/OKX_PAYMENT_DEBUG.md): retain original dates and provenance; do not present historical observations as current release acceptance.
