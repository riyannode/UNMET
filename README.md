# UNMET

**The market for what agents need but cannot buy yet.**

UNMET is an onchain demand order book for AI agents on X Layer. Agents lock USD₮0 behind capabilities they need but cannot currently buy. Builders inspect funded demand, ship a matching service, supporters approve with commitment-weighted voting, and the contract settles only the funds of supporters who explicitly approved. Non-approver funds remain individually refundable.

## OKX Dev Day 2026 thesis

Primary track: **Build a Company**.

Agent marketplaces are supply-first: builders publish a service and wait for buyers. UNMET exposes the other side of the market — machine demand that has no supply yet — and makes that demand credible by requiring onchain economic commitment.

Existing marketplaces answer **“What can agents buy?”** UNMET answers **“What are agents already willing to pay someone to build?”**

The hackathon integration is **UNMET Demand Intelligence**, a paid OKX.AI/A2MCP endpoint protected by the official OKX x402 middleware. The core demand market stays on X Layer Testnet (`1952`); only this endpoint's x402 billing rail uses X Layer Mainnet (`196`).

## Architecture

| Layer | Responsibility | Canonical? |
| --- | --- | --- |
| `backend/AgentDemand.sol` | demand, commitments, review snapshot, approval, payout, refund | **Yes** |
| X Layer events | immutable lifecycle history | Yes |
| `backend/server.ts` | chain-derived index + deterministic ranking + OKX x402 API | No |
| `frontend/` | wallet UI and direct contract reads/writes | No |

There is **no persistent application database**. Backend cache is disposable, reorg-aware, and rebuilt from the contract. `committed` means current escrow; `reviewCommitted` is the immutable review snapshot. `approvalWeight` is the maximum amount eligible for builder settlement: only explicit approver funds are split between builder and treasury. Non-approver funds remain refundable. Supporter count and expected calls are historical demand signals and refunds do not decrement them.

## Repository layout

Only three source directories:

```text
backend/   smart contract, Foundry tests, Bun/Express API, deploy/inspect CLI
frontend/  React/Vite wallet UI
docs/      PRD, architecture, API, errors, runbook, demo
```

## Stack versions

- Bun runtime 1.4.2 (`packageManager`)
- TypeScript 7.0.2
- React 19.3.0
- Vite 8.3.0
- viem 2.56.7
- Solidity 0.8.37
- Express 4.22.3 (official OKX x402 middleware adapter)
- `@okxweb3/x402-core` 0.1.0, `@okxweb3/x402-evm` 0.2.1, `@okxweb3/x402-express` 0.1.1
- OpenZeppelin Contracts v5.6.1 and forge-std v1.16.1 (Foundry dependency tags)
- Foundry Forge 1.8.3 (verified WSL toolchain; not pinned by a repository manifest)

## Install and verify

Prerequisites: Bun 1.4.2 and Foundry Forge 1.8.3 for the verified WSL toolchain.

```bash
bun install --frozen-lockfile
cp -n .env.example .env

cd backend
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std.git lib/forge-std
cd ..

bun run check
forge fmt --check
forge build
forge test -vvv
```

`bun.lock` is committed; OpenZeppelin and forge-std are checked out at the exact tags shown above.

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

`POST /v1/opportunities` is protected with the official OKX x402 Express middleware. In production, `X402_CHAIN_ID=196` selects mainnet USD₮0 for the `$0.01` challenge. `CHAIN_ID=1952`, its testnet RPC, contract, and escrow token remain the independent demand-market configuration. Missing payment returns the standard HTTP 402 challenge; the OKX facilitator verifies/settles valid payment before the endpoint result is returned.

There is no test bypass and no arbitrary `x-payment-id` acceptance path.

See `docs/API.md` and `docs/RUNBOOK.md`.

## Public deployment

- Frontend: [https://unmet-ai.vercel.app](https://unmet-ai.vercel.app), Vercel project `frontend`, deployment `dpl_B6dHSuUcdB6V4EMUY2rELjB3N4qC`.
- Backend: [https://unmet-api.vercel.app](https://unmet-api.vercel.app), Vercel project `backend`, deployment `dpl_HWDy1bPJXN11e1yKMK2RpXScG35n`.
- Frontend remains the existing Vite deployment; backend runs Express on Vercel Node.js 24. The backend deployment used local branch `feat/unmet-x402-network`, commit `ef0c249f7381bc35a0ef2fe3e467948484ebd8b0`; it has not been pushed to GitHub.
- `/health` and `/v1/demands` return the live demand market on chain `1952`. The current unpaid opportunities request returns x402 v2 HTTP 402 for exact mainnet USD₮0 on `eip155:196`, amount `10000`, to the configured treasury. No paid mainnet request was sent. The earlier paid production replay used the former testnet challenge and is historical evidence; see [docs/STATUS.md](docs/STATUS.md).

The paid production response contained an empty opportunity list because no open demands were available at that time. The production browser loaded live demand data without console errors or localhost requests. Its headless browser had no injected wallet provider, so no production wallet transaction was submitted. The browser transaction E2E on the same frontend source is recorded in [docs/STATUS.md](docs/STATUS.md).

## Verified X Layer Testnet evidence

| Item | Value |
| --- | --- |
| Network | X Layer Testnet `eip155:1952` |
| AgentDemand | `0x7c51457235cFFBae862493D788137BFf1EF07e2E` |
| Deployment transaction | `0x11cf1b6415dba756c98c88f8d1c174b2e38c0c2b0f8fb5ba61dac930ebc94284` (successful receipt, block `41369800`) |
| Test USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Browser finalize | `0x8fa5b789c5e4aebcb688cafc9d42f210c03f5ad75cbb56c6436b2348ab476663` (successful receipt, block `41372377`) |
| Separate refund | `0xd70d104b2b3248b676e030356414301fe1686c9e8b3eff58df4d8513344bc244` (successful receipt, block `41374315`) |
| UNMET x402 payment | `0x0cefbdfbc8bade0442629fe3ba0531babb7ca10b441baef985cff8c323b079a9` (successful receipt, block `41376569`) |
| Historical production x402 payment before network split | `0xb03a645fe2fecae7703a88e0ce6f8dd56ccad5b3bb432473d7bb0c4ede323bf2` (successful receipt on Testnet, block `41462370`; 0.01 USD₮0) |
| Current production x402 challenge | Mainnet `eip155:196`, USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `10000`; unpaid 402 verified, no payment sent |
| OKX.AI registration | ASP `13853`, Service `40842`; listing and review pending |
| Browser finalize balance deltas | Builder `+0.0196 USD₮0`; treasury `+0.0004`; escrow `−0.02` |
| Public backend / frontend | [unmet-api.vercel.app](https://unmet-api.vercel.app) / [unmet-ai.vercel.app](https://unmet-ai.vercel.app) |
| OKX.AI listing | Not published |

See [docs/STATUS.md](docs/STATUS.md) for constructor readback, full create/support/approve/finalize/refund receipts, token balance deltas, x402 replay evidence, and the separate Mock Merchant failure.

## Readiness

**Verified:** X Layer Testnet demand-contract flows, local browser E2E, public frontend/API smoke checks, the current mainnet x402 challenge, and a historical paid Testnet x402 replay.

**Remaining:** no paid mainnet x402 replay was performed; production wallet-provider write verification and OKX.AI listing/review are pending. The contract is not independently audited. This project is not production-ready.

## Security status

The smart contract has **not been independently audited**. Do not describe it as audited or guaranteed secure. Only unpaid x402 challenge generation has been checked on mainnet; demand-market mainnet deployment and paid mainnet settlement remain unverified and require separate authorization/review.

Wallet count is not identity count. UNMET reports supporting wallets, not unique humans.
