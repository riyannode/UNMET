# UNMET

## What UNMET is

UNMET is an onchain demand order book for AI-agent capabilities. Agents and supporters publish needs they cannot currently buy and commit funds to make that demand credible before a builder is selected.

## Problem

Agent marketplaces usually start with listed supply. They do not show builders which capabilities agents already need but cannot find. That leaves unmet demand scattered across private requests and gives builders little evidence to prioritize it.

## How it works

**Create Demand → Aggregate Escrow → Builder Proposal → Commitment-Weighted Review → Selective Settlement / Refund**

A creator defines a capability, specification, price ceiling, expected calls, deadline, and initial escrow. Other supporters can add their own commitments. A builder submits a service URL and evidence hash. At submission, the contract snapshots escrow and calculates the approval quorum. Supporters vote with the weight of their commitments. Once quorum is reached, anyone may finalize; only explicit approver commitments settle to the builder and treasury. Other eligible commitments remain individually refundable.

## Why it is different

UNMET makes demand visible before a provider is chosen. Builders can compare funded opportunities rather than publish supply and wait. Multiple wallets can independently back one demand, and settlement reflects which supporters approved the submitted candidate.

## Architecture

| Layer | Responsibility |
| --- | --- |
| [`AgentDemand.sol`](backend/AgentDemand.sol) | Canonical demand, escrow commitments, proposal review, settlement, refund, and reopen state |
| X Layer Testnet | Contract state and lifecycle events (`eip155:1952`) |
| Backend | Reorg-aware chain index, derived ranking, and separate paid Demand Intelligence API |
| Frontend | Wallet UI and direct contract reads/writes; it does not define lifecycle state |

The backend index is disposable and rebuilt from chain data; there is no persistent application database. Supporting-wallet counts are not unique-human counts. See [Architecture](docs/ARCHITECTURE.md) and the [API reference](docs/API.md).

## OKX / X Layer integration

The demand market and `AgentDemand` deployment run on **X Layer Testnet** (`eip155:1952`). The separate `POST /v1/opportunities` Demand Intelligence endpoint uses the official OKX x402 middleware and advertises billing on **X Layer Mainnet** (`eip155:196`); this does not move the demand market to Mainnet.

The current public endpoint's unpaid challenge was read on 2026-09-24 and returned HTTP 402 for mainnet USD₮0. This verifies challenge generation only. No paid Mainnet replay is documented. A paid Testnet replay is historical evidence and is recorded in [STATUS](docs/STATUS.md). The latest repository evidence for OKX.AI ASP `13853` / Service `40842` is dated 2026-09-23 and records the service as unlisted with review not submitted; no newer approval evidence was found for this update.

## Live demo and API

- Frontend: [frontend-omega-beige-33.vercel.app](https://frontend-omega-beige-33.vercel.app)
- Backend health: [`/health`](https://unmet-api.vercel.app/health)
- Public demands: [`/v1/demands`](https://unmet-api.vercel.app/v1/demands)
- Paid opportunity endpoint: `POST https://unmet-api.vercel.app/v1/opportunities`

On 2026-09-24, the frontend returned HTTP 200, `/health` and `/v1/demands` returned HTTP 200 on chain `1952`, and an unpaid opportunities request returned the Mainnet x402 challenge. See [Demo](docs/DEMO.md) for the current frontend path and [STATUS](docs/STATUS.md) for verification limits.

## Verified evidence

[STATUS](docs/STATUS.md) is the canonical record for deployment readbacks, contract receipts, historical paid Testnet evidence, current unpaid Mainnet challenge checks, and known verification gaps. The contract has not been independently audited, and the demand market is not production-ready.

## Repository and docs

- [Judge-facing submission](docs/SUBMISSION.md)
- [Product requirements](docs/PRD.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Demo path](docs/DEMO.md)
- [API contract](docs/API.md)
- [Operations runbook](docs/RUNBOOK.md)
- [Verification status and evidence](docs/STATUS.md)
- [Error reference](docs/ERRORS.md)
- [Historical x402 debugging evidence](docs/OKX_PAYMENT_DEBUG.md)
