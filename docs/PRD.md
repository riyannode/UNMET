# UNMET — Product Requirements Document

Version: 1.1  
Hackathon: OKX Dev Day 2026  
Primary track: Build a Company

## Product

UNMET is an onchain demand order book for AI agents. Agents fund capabilities they need but cannot currently buy. Builders use that demand as a machine-readable product signal, submit new supply, and receive the explicitly approved amount, less the protocol fee, when supporters approve the result.

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

MVP protocol fee: `2%` of the amount approved for builder settlement.

Example:

```text
100 USD₮0 in the review snapshot
60 USD₮0 explicitly approved
58.8 USD₮0 -> builder
 1.2 USD₮0 -> UNMET treasury
40 USD₮0 from non-approvers -> remains refundable
```

`committed` is current escrow. `reviewCommitted` is the immutable escrow snapshot taken when a candidate is submitted. `approvalWeight` is the total pre-submission commitment of supporters who explicitly approved; at finalization it is the approved amount and the maximum amount eligible for builder settlement. The treasury fee is calculated from that approved amount. Funds from supporters who did not approve remain individually refundable, including after the candidate is fulfilled.

`supporterCount` and aggregate `expectedCalls` are historical demand signals. Refunds reduce current escrow and the refunding wallet's own commitment/call values, but do not decrement those aggregate demand signals.

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
Stored lifecycle states are `Open`, `Submitted`, `Fulfilled`, and `Closed`. Candidate rejection is tracked as review progress and a derived `REJECTED` status; it is not a separate stored state.

Required actions:
- `createDemand`
- `supportDemand`
- `submitService`
- `approveService`
- `rejectService`
- `finalize`
- `reopen`
- `refund`
- `getDemand`
- `getSupport`
- `approvalProgress`
- `rejectionProgress`
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

No new support is allowed during review. Each supporter's weight is its pre-submission token commitment. Each supporter may approve or reject once per submission nonce; the same supporter cannot do both. Approval and rejection weights are measured against the immutable review snapshot.

`rejectionProgress` reports rejection weight and the threshold that makes approval quorum mathematically impossible. When rejection reaches that threshold, the candidate is marked rejected. Anyone may reopen immediately while the demand deadline is active; otherwise, anyone may reopen after review ends below quorum while the deadline remains active. Reopening emits `SubmissionRejected`, clears the current candidate and review progress, and starts a fresh open period; votes from the old submission do not carry forward.

### Fulfillment

Anyone may finalize after the fixed approval quorum is reached. State is finalized before token transfers. Only `approvalWeight` is settled: the builder receives the approved amount less its 2% fee, and the treasury receives the fee. Funds from non-approvers are excluded and remain refundable. Builder payout plus fee therefore equals the approved amount, not the original review snapshot or total committed pool.

### Failed review

If rejection weight makes quorum impossible, anyone can reopen while the demand deadline is still active. If the candidate is neither approved nor rejected by the early threshold, anyone can reopen after review expiry, provided the demand deadline is still active. Rejection is scoped to the current submission nonce; reopening emits `SubmissionRejected`, clears candidate-specific vote progress, and returns the demand to `Open` for a new candidate.

### Refund

Refunds are pull-based and available only when `isRefundable()` is true. This includes non-approver commitments remaining after fulfillment and supporter commitments after a demand expires or an unapproved review ends. Each supporter can withdraw only their own remaining commitment; there is no global refund loop. A refund decreases `committed` and `totalEscrowed`, and clears that wallet's own commitment and expected calls. Aggregate `supporterCount` and `expectedCalls` remain historical. When the last escrow entitlement is refunded, state becomes `Closed`; fulfilled demands remain `Fulfilled` while non-approver refunds are outstanding.

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
- `rejectService` with rejection progress
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

Versions pinned in manifests or used by the verified WSL toolchain:
- Bun runtime 1.4.2 (`packageManager`)
- TypeScript 7.0.2
- React / React DOM 19.3.0
- Vite 8.3.0
- viem 2.56.7
- Express 4.22.3 (HTTP adapter required by the official OKX x402 middleware)
- `@okxweb3/x402-core` 0.1.0
- `@okxweb3/x402-evm` 0.2.1
- `@okxweb3/x402-express` 0.1.1
- Solidity 0.8.37
- OpenZeppelin Contracts v5.6.1 and forge-std v1.16.1 (Foundry dependency tags)
- Foundry Forge 1.8.3 (verified WSL toolchain)

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
