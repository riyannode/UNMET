# Architecture

## System boundary

```text
Agent / browser wallet
        |
        | ERC-20 approve + contract writes
        v
AgentDemand.sol on X Layer
        |                 ^
        | storage/events  | direct reads
        v                 |
Bun + Express API      React frontend
        |
        | official OKX x402 middleware
        v
OKX.AI / A2MCP buyer
```

## Independent network contexts

The demand market is configured by `CHAIN_ID` and remains on X Layer Testnet (`1952`): contract reads, indexing, frontend writes, escrow, and health/readback reporting use this network. `PAYMENT_TOKEN` is the Testnet escrow token.

Only the x402 middleware for `POST /v1/opportunities` uses `X402_CHAIN_ID`. Production sets it explicitly to X Layer Mainnet (`196`), matching the registered A2MCP fee token and yielding the mainnet USD₮0 challenge. This payment setting is never used by `backend/contract.ts` or demand-market clients. Local/test environments can omit it to inherit `CHAIN_ID`.

`AgentDemand.sol` is the only canonical application state. No Supabase, PostgreSQL, Redis, Firebase or hidden persistence is used.

## Contract state

`Demand` stores:
- creator and submitted builder
- max unit price
- current committed bounty
- immutable-per-review `reviewCommitted`
- immutable-per-review `approvalRequired`
- expected calls
- deadline / review end
- supporting-wallet count
- lifecycle status
- capability / specification
- submitted service URL / evidence hash

Per-supporter mappings store commitment, expected calls and approval for the current submission nonce.

## Demand lifecycle

```text
OPEN
 | support
 | submit
 v
SUBMITTED
 | quorum reached -> finalize ----------------> FULFILLED
 |
 | rejection threshold reached, or review ends below quorum
 | while demand deadline is active
 v
reopen -> SubmissionRejected -> OPEN

OPEN after deadline --------------------------> supporter refunds
SUBMITTED after deadline + review end
  and below quorum ---------------------------> supporter refunds
all remaining funds refunded ----------------> CLOSED
```

Important invariants:
- New support is disabled during review, so the approval denominator cannot move.
- `approvalRequired` is a ceil-rounded snapshot created at submission.
- Refunds cannot lower the threshold for an existing submission.
- A submission that reached quorum is not refundable.
- Approvals are scoped to `submissionNonce`; old votes never carry into a new candidate.
- Approvers may not also reject the same submission. Rejection weight is measured against the review snapshot; reaching `reviewCommitted - approvalRequired + 1` makes quorum impossible and permits immediate reopen before the demand deadline.
- Reopening emits `SubmissionRejected` and clears candidate-specific vote progress. The demand returns to `Open` while its deadline remains active.
- Refunds are pull-based; there is no unbounded payout loop.
- Expired demand can be replaced by a new exact demand even before every old supporter refunds. An old refund cannot clear the replacement's active key.
- Contract computes the exact duplicate key itself from the validated capability slug + specification.

## Exact duplicate semantics

Capability is a canonical lowercase slug: `[a-z0-9]+(-[a-z0-9]+)*`, maximum 64 bytes.

`demandKey = keccak256(abi.encode(keccak256(bytes(capability)), keccak256(bytes(specification))))`

This prevents callers from bypassing exact-duplicate checks with an arbitrary key. It intentionally does **not** perform semantic similarity matching.

## Token accounting

UNMET assumes a normal ERC-20 accounting model. `_pullExact()` compares contract balance before and after `transferFrom`; fee-on-transfer/rebasing behavior that changes the received amount is rejected.

`finalize()`:
1. checks fixed quorum snapshot
2. sets terminal state before transfers
3. treats explicit `approvalWeight` as the approved settlement amount
4. removes only that amount from current escrow and total escrow accounting
5. calculates the protocol fee from the approved amount and transfers the net to the builder
6. leaves non-approver escrow in the fulfilled demand for individual refunds

`refund()` zeroes the caller's entitlement before transfer.

## Backend derived index

The API keeps a disposable in-memory index:
1. initial start reads `nextDemandId` and every demand
2. later requests read only demand IDs touched by contract logs since the indexed block
3. missing new IDs are detected from `nextDemandId`
4. indexed block hash is checked to detect a chain reorg
5. reorg / chain rewind triggers a full rebuild

A single in-flight refresh promise prevents duplicate concurrent rebuilds.

The cache is never used as proof. API results include chain ID, contract and indexed block so clients can verify them.

## OKX x402 flow

`POST /v1/opportunities` is the only paid route.

```text
request without valid payment
        -> official paymentMiddleware
        -> HTTP 402 + standard PAYMENT-REQUIRED challenge
buyer signs/pays
        -> replay with PAYMENT-SIGNATURE
        -> OKX facilitator verify/settle
        -> route executes
        -> HTTP 200 + chain-derived result
        -> PAYMENT-RESPONSE as produced by middleware
```

There is no fake payment header or local bypass.

## Trust model

Trust minimized:
- committed funds, approvals, payout and refunds are onchain
- backend cannot mutate demand economics
- frontend cannot mark a tx successful until receipt status is successful

Remaining assumptions:
- supporters must inspect a candidate before approving
- successful bounty payout does not guarantee future service availability
- supporting wallets are not verified unique identities
- RPC/facilitator/frontends can be temporarily unavailable
- contract is not independently audited

## Economic field semantics

- `committed` is current escrow remaining in the demand.
- `reviewCommitted` snapshots total escrow at candidate submission and never changes during that review.
- `approvalRequired` is calculated once from the snapshot using ceil division.
- `approvalWeight` is the maximum amount eligible for settlement because only explicit approvers are paid through to the builder. The `DemandFulfilled` event's `approvedAmount` equals that weight; builder payout plus fee equals `approvedAmount`, never the full original pool by default.
- Non-approver funds remain refundable after successful fulfillment. Refunding reduces current escrow and the individual position, while aggregate supporter count and expected calls remain historical.
- `supporterCount` and aggregate `expectedCalls` are historical demand signals and are not decremented by later refunds.

This prevents a majority from seizing minority deposits while preserving the original demand signal.

## Why the core escrow is not ERC-8183

[ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) is currently a **Draft** standard. This comparison describes the core abstractions in the current specification; it does not claim incompatibility or superiority. ERC-8183 solves a neighboring problem at a different abstraction layer.

At a high level, ERC-8183 models a job:

**Client → fund one job budget → Provider submits → one Evaluator completes or rejects → release or refund the job escrow**

Its evaluator may be the client or a contract, and the specification includes optional hooks. The core escrow unit is still the budget for one job.

UNMET models funded market demand:

**Many supporters → independently commit to one demand → one builder submits a candidate → supporters vote with commitment weight → quorum uses the review escrow snapshot → only explicit approver funds settle; eligible non-approver funds remain individually refundable**

| Dimension | UNMET | ERC-8183 core job |
| --- | --- | --- |
| Funding | Multiple wallets make independent commitments to one demand. | A client funds one job budget. |
| Evaluation authority | Supporters vote with commitment weight; the contract checks approval quorum against the snapshot taken at submission. | One evaluator address decides whether a submitted job completes or is rejected. The evaluator may be the client or a contract. |
| Settlement | Only explicit approver commitments are eligible for builder payout and treasury fee. Eligible non-approver commitments do not automatically pay the builder and remain individually refundable. | The job escrow is the settlement unit: completion releases it to the provider (less an optional fee); rejection or expiry refunds it to the client. |
| Market discovery | The demand can be funded and discovered before a builder is selected. | The primitive coordinates execution after the job's client, provider, evaluator, and budget are established. A provider may be assigned after creation, but must be set before funding. |
| Re-proposal | An unsuccessful candidate can be cleared and the demand reopened while its deadline remains active, preserving the underlying demand. | Rejected and expired jobs are terminal in the specified state machine, so another attempt would use a new job. |

These differences explain why `AgentDemand` uses a demand-level escrow and commitment ledger as its core. They do not imply that ERC-8183 cannot be extended or composed for a particular application.

One possible future composition would match a funded UNMET demand to a provider, then use an ERC-8183-compatible job escrow downstream for that provider's execution. `AgentDemand` could remain the demand-aggregation and commitment-consensus layer. UNMET does not implement this integration today.
