# UNMET

UNMET is an onchain demand market for AI-agent capabilities. Requesters publish needs and commit funds; builders discover funded demand, propose a service, and receive funds only after commitment-weighted supporter approval. Eligible non-approver funds remain refundable.

## Demand funding and intelligence

- **Demand funding:** wallet transactions create/support demands, vote, finalize or refund through `AgentDemand.sol` on **X Layer Testnet (1952)**.
- **Free discovery:** `GET /v1/demands` returns public market facts and its existing compatibility score, ordered by current escrow.
- **Paid demand intelligence:** `POST /v1/opportunities` adds scoped ranks, score contributions, escrow-per-expected-call and review signals, and deterministic reasons to investigate or exercise caution. Official OKX x402 bills each query **$0.01** separately on **X Layer Mainnet (196)** in production. Buying intelligence does not fund escrow or move the demand market to Mainnet. See the [API contract](docs/API.md).

## Architecture

| Part | Responsibility |
| --- | --- |
| [AgentDemand.sol](backend/AgentDemand.sol) | Canonical demand, escrow, voting, settlement and refunds |
| React/Vite frontend | Reown wallet UI, viem contract reads/writes, routed demand views |
| Bun/Express backend | Bounded, reorg-aware in-memory chain index and intelligence ranking |
| Native `bun:sqlite` | Self-hosted x402 operation/idempotency and settlement records; **not the escrow database** |
| Caddy + Docker Compose | Static frontend, reverse proxy and persistent payment volume |

The chain index can be rebuilt. Payment records must survive restarts. Vercel uses the exported Express app without durable SQLite; Docker uses one Bun API replica. See [Architecture](docs/ARCHITECTURE.md).

## Local development

Use Ubuntu WSL2 on its Linux filesystem. Install Bun (manifest/image version `1.4.2`) and Foundry for contract checks.

```bash
git clone https://github.com/riyannode/UNMET.git
cd UNMET
bun install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

Configure public market addresses/RPC and Reown inputs; backend startup additionally needs your official OKX credentials and fee recipient. See [Contributing](CONTRIBUTING.md) for exact environment loading, Foundry dependency installation, and separate terminal commands. Offline checks need no payment credentials.

```bash
# Terminal 1, repository root; use development settings as documented.
bun --env-file=.env run dev:backend
# Terminal 2, repository root
bun --env-file=.env run dev:frontend --host 127.0.0.1
```

## Checks

```bash
bun run typecheck
bun run test:backend
bun run test:frontend
bun run test:contract
bun run build:frontend
```

`bun run check` runs all of these. Foundry dependencies must be installed first. The CI workflow runs frontend, backend, contract and Docker checks; there is no lint script. Payment regressions use temporary SQLite files and injected facilitator fixtures; they submit no live payments.

## Documentation and limitations

[PRD](docs/PRD.md) describes the current Post-Hackathon product; [Future Implementation](docs/FUTURE_IMPLEMENTATION.md) contains proposals only; [STATUS](docs/STATUS.md) and dated reports retain evidence and its limits. Coding agents should read [AGENTS](AGENTS.md) first. Start with the [documentation index](docs/README.md), [contributor guide](CONTRIBUTING.md), [API](docs/API.md), [self-hosting guide](docs/SELF_HOSTING.md), and [payment recovery](docs/PAYMENT_RECOVERY.md).

The contract is unaudited and the demand market remains on Testnet. Self-hosted payment protection assumes one API replica and a local WAL/FULL SQLite volume. It provides neither distributed exactly-once settlement nor original paid-response replay. Hashless ambiguous settlements require operator investigation; never retry payment automatically. Interactive wallet acceptance and live paid Mainnet settlement remain separate production gates.

[STATUS](docs/STATUS.md) preserves dated deployment/transaction evidence; [the submission video](https://youtu.be/6eCRf7iAbFo) and September endpoints are historical artifacts, not proof of a current deployment. Local tests do not establish public hosting or audited production readiness.
