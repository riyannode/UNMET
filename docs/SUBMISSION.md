# UNMET submission

## Project

UNMET

## One-line description

A funded onchain demand market for AI-agent capabilities.

## Problem

Agent marketplaces are supply-first and do not reveal capabilities agents already want but cannot buy. Builders see listed services, but lack a shared, credible signal for what should be built next.

## Solution

Agents and supporters make unmet demand credible by committing funds onchain. Builders discover funded opportunities, submit a candidate service, and settlement happens only after commitment-weighted supporter approval. Funds from supporters who did not approve remain individually refundable when eligible.

## Core flow

**Demand → Escrow → Proposal → Review → Settlement**

## Roles

- **Demand creator:** publishes the capability request and makes the initial commitment.
- **Supporter / funder:** adds an independent commitment and may approve or reject a submitted candidate.
- **Builder:** submits a service URL and evidence hash for review.

## What is onchain

[`AgentDemand.sol`](../backend/AgentDemand.sol) is the canonical lifecycle and accounting source. It stores demand fields and status, the creator and builder, per-wallet commitments, the aggregate escrow, deadline, service URL and evidence hash, and the review snapshot. At submission it fixes the review escrow snapshot and required approval weight. Supporter votes use their commitments as weight.

When quorum is met, finalization settles only the explicit approvers' funds: the builder receives the approved amount less the configured fee, and the treasury receives that fee. Non-approver commitments remain individually refundable. The contract also determines when refunds are available and when an unsuccessful candidate can be reopened.

## What is offchain

The backend indexes contract events and reads, maintains a disposable reorg-aware cache, and computes opportunity rankings. The frontend presents chain state and submits wallet transactions. These layers do not replace the contract as the source of lifecycle or escrow state. There is no persistent application database.

## OKX integration

The demand-market contract and escrow are deployed on **X Layer Testnet** (`eip155:1952`). Separately, the Demand Intelligence endpoint at `POST /v1/opportunities` uses the official OKX x402 middleware and advertises billing on **X Layer Mainnet** (`eip155:196`). The billing network does not change the demand-market network.

- **Historical paid Testnet evidence:** a successful x402 payment and replay were recorded on Testnet before the billing-network change. The receipt and readback are in [STATUS](STATUS.md); this is not Mainnet payment evidence.
- **Current Mainnet replay status:** on 2026-09-24 an unpaid request returned an x402 v2 HTTP 402 challenge for `eip155:196`. That check sent no payment. No paid Mainnet replay evidence is recorded, so Mainnet settlement remains unverified.
- **OKX.AI listing/review:** the latest repository evidence, dated 2026-09-23, records ASP `13853` / Service `40842` as unlisted with review not submitted. No newer listing approval evidence was found for this update.

## Demo path

1. Open **Demand Board**.
2. Select a demand to open its dedicated Demand view.
3. Read **Overview** for the request and market state.
4. Open **Fund** to inspect escrow and the connected wallet's commitment.
5. Open **Build & Review** for a proposal, supporter review, and any currently eligible settlement actions.
6. Open **Create Demand** to see the Request, Economics, and Initial Escrow sections.
7. Open **My Activity** and select a position to return to its Demand view.

The current frontend is available at [frontend-omega-beige-33.vercel.app](https://frontend-omega-beige-33.vercel.app). Further demo notes and transaction evidence are in [DEMO](DEMO.md) and [STATUS](STATUS.md).

## Verified evidence

See [STATUS](STATUS.md) for the canonical deployment, contract, Testnet transaction, historical paid Testnet, and current unpaid Mainnet challenge evidence.

## Limitations

- `AgentDemand.sol` has not been independently audited.
- The demand market is deployed on Testnet and is not production-ready.
- Paid Mainnet x402 replay and settlement are not verified.
- The latest recorded OKX.AI listing/review evidence says the service was unlisted and review had not been submitted; no newer approval evidence is available in this repository.
