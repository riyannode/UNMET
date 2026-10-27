# Contributing

Coding agents should read the repository [AGENTS.md](AGENTS.md) before choosing a subsystem or editing files.

## Tools and installation

Use Bun `1.4.2` (manifest and Docker version), Git, Foundry/Forge (verified version `1.8.3`), and Docker Engine with Compose for container checks. Foundry selects Solidity `0.8.37` from `backend/foundry.toml`. Bun `1.4.3` also passed the cleanup checks.

Ubuntu WSL2 is the verified Windows development environment. On Windows, keep the checkout in WSL's native Linux filesystem, for example `~/projects/UNMET`, rather than `/mnt/c`. The commands below use a POSIX shell; WSL2 is not a requirement for every operating system. Other platform setups were not verified by the recorded cleanup checks.

From the repository root:

```bash
bun install --frozen-lockfile
# Fresh checkout only; retain existing dependency directories.
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts.git backend/lib/openzeppelin-contracts
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std.git backend/lib/forge-std
cp .env.example .env
chmod 600 .env
```

`backend/lib` is ignored. Check existing dependency tags before reusing them; do not overwrite another developer's checkout.

## Environment and local servers

Edit `.env` privately. It starts with **Compose production defaults**, including `NODE_ENV=production` and Mainnet x402 billing. For standalone local development, set `NODE_ENV=development`, `HOST=127.0.0.1`, and `FRONTEND_ORIGIN=http://localhost:5173`. Keep `CHAIN_ID=1952` and matching Testnet contract/token/RPC configuration. Production requires `X402_CHAIN_ID=196`; a deliberately configured nonproduction process may use `1952`. Neither choice authorizes a signed payment.

- Backend startup needs `DEMAND_CONTRACT`, `XLAYER_RPC_URL`, `PAYMENT_TOKEN`, and your own `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PAY_TO`. See the full [configuration matrix](docs/SELF_HOSTING.md#configuration-matrix).
- Frontend: set matching public `VITE_CHAIN_ID`, `VITE_DEMAND_CONTRACT`, `VITE_PAYMENT_TOKEN`, `VITE_XLAYER_RPC_URL`, and your public `VITE_REOWN_PROJECT_ID`; allow the local origin in Reown.
- `VITE_*` is public build-time data. Keep private provider credentials, OKX secrets and wallet keys out of it. No deployment key is needed to develop or run checks.
- For standalone durable payments, create a private local directory first and set an absolute `PAYMENT_DB_PATH`. Compose fixes this path to `/data/payments.sqlite`. See [payment recovery](docs/PAYMENT_RECOVERY.md).

Run in two terminals from the root (explicit root env loading avoids workspace working-directory differences):

```bash
# Terminal 1: API on 127.0.0.1:8787
bun --env-file=.env run dev:backend
# Terminal 2: frontend on 127.0.0.1:5173
bun --env-file=.env run dev:frontend --host 127.0.0.1
```

The frontend reads the contract directly through its public RPC and wallet. It does not need the paid intelligence endpoint for normal demand-market actions. Stop both commands with Ctrl-C when finished.

## Offline validation

Run these from the root without payment credentials. For a credential-free run, use a clean checkout without a local `.env`; Bun otherwise auto-loads it. The test fixtures themselves need no operator credentials.

| Command | Coverage |
| --- | --- |
| `bun run test:backend` | API validation, proxy trust, quotas, indexing; SQLite persistence and durable payment suites in separate Bun invocations |
| `bun run test:frontend` | Wallet, receipt/recovery, routing, app state and guided demand creation |
| `bun run test:contract` | Foundry escrow, votes, settlement, refunds and accounting tests |
| `bun run typecheck` | Both backend TypeScript configurations and frontend |
| `bun run build:frontend` | Frontend typecheck and Vite production output |
| `bun run check` | All checks above |

Root `bun run test` covers backend and contracts only; run `test:frontend` too. The CI workflow runs frontend, backend, contract and Docker checks; there is no lint script. Foundry's initial compiler/dependency downloads and frozen installation need network access, but no credentials. Tests use deterministic facilitator fixtures and temporary databases, not live signed payments.

For the existing real React wallet-session race fixture, start the frontend locally and open `/tests/create-demand-chat-race.html`; the final result must say PASS. It uses synthetic outcomes and sends no transactions. See [wallet limitations](docs/WALLET_DISCONNECT.md).

## Local Docker validation

Use a private env file with the original Compose production defaults, your own OKX/Reown configuration, and a free port/subnet. Compose fixes `NODE_ENV=production`. Example from the root:

```bash
# Edit .env: HTTP_PORT=18080, HTTPS_PORT=18443,
# SITE_ADDRESS=http://localhost, FRONTEND_ORIGIN=http://localhost:18080.
docker compose -p unmet-contributor config --quiet
docker compose -p unmet-contributor build
docker compose -p unmet-contributor up -d --no-build
docker compose -p unmet-contributor ps
BASE_URL=http://localhost:18080 bun scripts/smoke-unpaid.ts
docker compose -p unmet-contributor exec -T api bun run backend/payment-ops.ts integrity
docker compose -p unmet-contributor down
```

The smoke command checks SPA paths, liveness/readiness/health, demands, JSON API 404 and the official unpaid 402 challenge. It submits no payment. External RPC and facilitator initialization need working credentials/network; offline regression tests do not. Use a distinct project name, port and subnet when another stack exists. `down` preserves named volumes: never add `-v` for real payment data. Confirm your containers have exited and the chosen ports are closed. See [Self-hosting](docs/SELF_HOSTING.md) and [Payment recovery](docs/PAYMENT_RECOVERY.md) for persistence/backup/rollback rules.

## Changes and review

Fetch `origin`, create a fresh descriptive branch from `origin/main`, make a focused change and run relevant checks. Before staging, run `git diff --check` and inspect `git diff`. Stage only intended files; never stage `.env`, keys or payment databases. Commit with a concise message, then `git push -u origin HEAD` and open a pull request against `main` on GitHub. Use a Draft while acceptance is incomplete.

Describe the problem, scope, checks and exact failures/limits. Include removal evidence for cleanup and regression coverage for meaningful behavior changes. Preserve unrelated changes, formatting, architecture and public compatibility. Do not merge or deploy as part of cleanup.

Require careful review for escrow/settlement/token arithmetic, wallet approvals and receipt recovery, official OKX verification/settlement, payment fingerprints/state transitions/key reclamation, SQLite backups and ambiguous recovery, API client-IP trust/rate limiting, and reorg/index checkpoints. Never weaken a security regression or treat a mocked payment success as live acceptance.

Use the [documentation index](docs/README.md) for current references, operator procedures and historical evidence.
