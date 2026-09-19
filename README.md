# UNMET

**The market for what agents need but cannot buy yet.**

UNMET is an onchain demand order book for AI agents on X Layer. Agents lock USD₮0 behind capabilities they need but cannot currently buy. Builders inspect funded demand, ship a matching service, supporters approve with commitment-weighted voting, and the contract settles only the funds of supporters who explicitly approved. Non-approver funds remain individually refundable.

## OKX Dev Day 2026 thesis

Primary track: **Build a Company**.

Agent marketplaces are supply-first: builders publish a service and wait for buyers. UNMET exposes the other side of the market — machine demand that has no supply yet — and makes that demand credible by requiring onchain economic commitment.

Existing marketplaces answer **“What can agents buy?”** UNMET answers **“What are agents already willing to pay someone to build?”**

The hackathon integration is **UNMET Demand Intelligence**, a paid OKX.AI/A2MCP endpoint protected by the official OKX x402 middleware.

## Architecture

| Layer | Responsibility | Canonical? |
| --- | --- | --- |
| `backend/AgentDemand.sol` | demand, commitments, review snapshot, approval, payout, refund | **Yes** |
| X Layer events | immutable lifecycle history | Yes |
| `backend/server.ts` | chain-derived index + deterministic ranking + OKX x402 API | No |
| `frontend/` | wallet UI and direct contract reads/writes | No |

There is **no persistent application database**. Backend cache is disposable, reorg-aware, and rebuilt from the contract. `committed` means current escrow; `reviewCommitted` is the immutable review snapshot. Supporter count and expected calls are historical demand signals.

## Repository layout

Only three source directories:

```text
backend/   smart contract, Foundry tests, Bun/Express API, deploy/inspect CLI
frontend/  React/Vite wallet UI
docs/      PRD, architecture, API, errors, runbook, demo
```

## Stable stack pinned in this source

- Bun 1.4.2
- TypeScript 7.0.2
- React 19.3.0
- Vite 8.3.0
- viem 2.56.7
- Solidity 0.8.37
- OpenZeppelin Contracts 5.6.1 audited npm `latest`
- official OKX x402 packages (`@okxweb3/x402-*`)

## Install and verify

Prerequisites: Bun 1.4.2 and current stable Foundry.

```bash
bun install
cp .env.example .env

cd backend
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std.git lib/forge-std
cd ..

bun run typecheck
bun run test:backend
bun run test:contract
bun run build:frontend
```

For reproducible installs, use `bun install --frozen-lockfile`; `bun.lock` is committed.

## Testnet deployment

```bash
# .env: CHAIN_ID=1952, treasury + deployer key configured
cd backend
bun run admin.ts deploy-testnet

# then set DEMAND_CONTRACT/VITE_DEMAND_CONTRACT to the returned address
bun run admin.ts inspect
```

The deploy command waits for a successful receipt and reads immutable configuration back from chain. Mainnet deployment is gated by `ALLOW_MAINNET_DEPLOY=1` and must be done only after the testnet E2E in `docs/RUNBOOK.md` passes.

## Paid OKX.AI endpoint

`POST /v1/opportunities` is protected with the official OKX x402 Express middleware. Missing payment must produce the standard HTTP 402 payment challenge; valid payment is verified/settled by the OKX facilitator before the endpoint result is returned.

There is no test bypass and no arbitrary `x-payment-id` acceptance path.

See `docs/API.md` and `docs/RUNBOOK.md`.

## Current deployment fields

| Item | Value |
| --- | --- |
| X Layer Testnet | chainId `1952` |
| Test USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| X Layer Mainnet | chainId `196` |
| Mainnet USD₮0 | `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| AgentDemand contract | configure after deployment |
| Backend URL | configure after deployment |
| Frontend URL | configure after deployment |
| OKX.AI listing | configure after publication |

## Security status

The implementation is hardened for real-value testing, but the smart contract has **not been independently audited**. Do not describe it as audited or guaranteed secure. Use tiny values first, prove the full testnet path, then perform a separate mainnet release review.

Wallet count is not identity count. UNMET reports supporting wallets, not unique humans.
