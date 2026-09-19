# UNMET — Product Requirements Document

Version: 1.1  
Hackathon: OKX Dev Day 2026  
Primary track: Build a Company

## Product

UNMET is an onchain demand order book for AI agents. Agents fund capabilities they need but cannot currently buy. Builders use that demand as a machine-readable product signal, submit new supply, and receive the pooled bounty when the existing supporters approve the result.

Hero: **The market for what agents need but cannot buy yet.**

## Thesis

AI-agent markets should expose demand as well as supply.

Existing marketplace loop:

```text
builder -> publish service -> wait for buyer
```

UNMET loop:

```text
agent cannot buy capability
-> creates/supports funded demand
-> builders observe committed demand
-> builder ships service
-> supporters review
-> fixed weighted quorum approves
-> builder paid
```

A funded demand signal is stronger than a poll, Discord request, failed search, like, or waitlist.

## Problem

1. Failed agent searches disappear instead of becoming ecosystem data.
2. Builders cannot see recurring missing capabilities.
3. Builders cannot see credible willingness-to-pay for supply that does not exist.
4. Expected machine call volume is hidden.
5. Existing supply-first marketplaces encourage builders to guess demand.
6. Autonomous agents need structured, verifiable demand rather than human-only forum posts.

## Users

### Requester/supporter agent
Creates a missing capability or joins an existing one with real USD₮0 and expected usage.

### Builder
Finds funded gaps and produces a reusable service matching the requirement.

### OKX.AI / A2MCP buyer
Pays per query for normalized, ranked, chain-verifiable Demand Intelligence.

## Primary product

A public funded demand record contains:
- capability slug
- specification
- maximum acceptable unit price
- expected calls
- deadline
- supporting wallet count
- real committed bounty
- candidate service/evidence when submitted
- fixed review threshold
- lifecycle state

The system must say “supporting wallets,” not “unique users.”

## Economics

MVP protocol fee: `2%` of a successfully fulfilled bounty.

Example:

```text
100 USD₮0 committed
98 USD₮0 -> builder
 2 USD₮0 -> UNMET treasury
```

No protocol fee is charged merely for posting a failed demand. Unfulfilled supporters retain their pull-refund entitlement.

Secondary revenue: paid `POST /v1/opportunities`, recommended demo price `$0.01/query`, protected with official OKX x402 middleware.

## Canonical storage

No persistent application DB.

Current economic state: `AgentDemand.sol`.  
History: contract events.  
Backend: disposable derived index.  
Frontend: display/session state only.

If any derived layer disagrees with chain state, chain state wins.

## Contract requirements

File/name: `backend/AgentDemand.sol` / `AgentDemand`.

Non-upgradeable. Immutable token, treasury, fee, quorum, min commitment and review period for MVP.

Required actions:
- `createDemand`
- `supportDemand`
- `submitService`
- `approveService`
- `finalize`
- `reopen`
- `refund`
- `getDemand`
- `getSupport`
- `approvalProgress`
- `isRefundable`

### Demand creation

Contract validates:
- canonical lowercase capability slug
- nonempty spec <= 2048 bytes
- positive max price
- positive expected calls
- deadline at least 1 hour ahead
- initial commitment >= configured minimum

Contract computes the exact demand key itself. Caller cannot provide a fake dedupe key.

### Support

Allowed only while Open and before deadline. Real tokens are transferred into the contract. The token transfer must increase contract balance by exactly the requested amount.

### Review

Submission freezes:
- `reviewCommitted`
- ceil-rounded `approvalRequired`

No new support during review. Each supporter's weight is its pre-submission token commitment. Approval is scoped to a submission nonce.

### Fulfillment

Anyone may finalize after fixed quorum. State is finalized before token transfers. Builder payout and treasury fee must equal the original committed amount exactly.

### Failed review

After review expiry below quorum and before demand deadline, anyone can reopen the demand for a new candidate. Old approvals cannot survive.

### Refund

After demand deadline, a supporter may pull only its own commitment when there is no quorum-approved candidate. No global refund loop. Aggregate committed/calls/supporter values are updated. When the last entitlement is refunded, state becomes Closed.

Expired exact demand may be replaced without waiting for every old supporter to refund; old-demand cleanup must not clear a newer active replacement.

## Backend requirements

Runtime: Bun. HTTP: Express only because the official OKX x402 package provides the supported middleware adapter.

Routes:
- `GET /health` free
- `GET /v1/demands` free chain-derived board
- `POST /v1/opportunities` paid OKX.AI/A2MCP route

Requirements:
- official `@okxweb3/x402-*` packages
- no custom/fake payment proof
- fail closed when OKX credentials/facilitator are unavailable
- deterministic input validation and ranking
- BigInt for EVM integer values
- structured JSON logs with no secrets
- exact production CORS origin
- bind `0.0.0.0`
- chain-reorg-aware disposable cache

## Demand Intelligence score

Ranking only:
- 50% committed bounty percentile
- 25% expected-call percentile
- 15% supporting-wallet percentile
- 10% remaining-deadline factor capped at 30 days

No LLM and no success-probability claim.

## Frontend requirements

React/Vite/viem.

Screens/actions:
- demand board
- create demand
- demand detail
- support
- submit service
- commitment-weighted approval
- finalize
- reopen failed review
- refund only when `isRefundable()` says true
- My Activity

Wallet behavior:
- injected EIP-1193 wallet
- account/chain change handling
- X Layer switch/add
- wait for successful tx receipt before success UI
- explorer link for writes
- no private keys

## Repository constraints

Only source directories:

```text
backend/
frontend/
docs/
```

Avoid helper/service/repository abstraction folders unless a demonstrated problem requires them.

## Stack

Pinned stable baseline for this release:
- Bun 1.4.2
- TypeScript 7.0.2
- React 19.3.0
- Vite 8.3.0
- viem 2.56.7
- Solidity 0.8.37
- OpenZeppelin Contracts 5.6.1 audited npm latest
- Foundry stable

## Non-goals

Do not add to hackathon MVP:
- semantic clustering / LLM matching
- reputation
- KYC / identity proof
- affiliate/referral market
- generic agent marketplace
- token/NFT/DAO
- upgradeable proxy
- cross-chain state
- trading/recommendation functionality
- hidden DB

## Security acceptance

Before any mainnet release:
- contract tests pass
- backend tests pass
- typecheck passes
- frontend build passes
- testnet deploy + config readback succeeds
- two-wallet commitment E2E succeeds
- failed-review refund fixture succeeds
- real OKX x402 402 -> payment -> replay -> 200 succeeds
- browser flow succeeds
- secrets absent from repo/bundle
- mainnet values manually rechecked

The contract is not independently audited; documentation must not imply otherwise.

## Hackathon demo success

The 2–4 minute demo must visibly prove:

```text
missing capability
-> funded demand
-> second supporter
-> paid Demand Intelligence query
-> builder submission
-> weighted approval
-> onchain payout
```

Evidence is transaction receipt + state readback, not transaction submission alone.


## Settlement safety amendment

Only explicit approver funds are settled to the accepted builder. Reaching quorum marks the candidate accepted, but it does not authorize seizure of deposits belonging to supporters who did not approve. Non-approver funds remain individually refundable after fulfillment.

`committed` is current escrow. `reviewCommitted` is the immutable review snapshot used for quorum. `supporterCount` and aggregate `expectedCalls` are historical demand signals and remain unchanged by refunds.
