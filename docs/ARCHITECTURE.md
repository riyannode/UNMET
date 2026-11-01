# Architecture

## Production paths

```mermaid
flowchart TD
    U[Browser / AI Agent] -->|wallet / contract calls via RPC| X[Selected canonical AgentDemand deployment]
    X --- E[Demand, escrow, voting, settlement, refund]
    U -->|HTTP: UI and API| C[Caddy]
    C -->|static files / SPA fallback| F[React / Vite build]
    C -->|API paths| B[Bun / Express API]
    B -->|pinned demand reads and logs| R[X Layer Testnet RPC]
    B -->|operation records| S[SQLite WAL/FULL: payment_data volume]
    S --- I[x402 idempotency and settlement records]
    B -->|official verify / settle / status| O[Official OKX x402: Mainnet billing rail]
```

The browser's demand actions use `frontend/contract.ts` directly, not the Bun API. `frontend/main.tsx` lazy-loads app routes; `/` is the landing page, `/docs` serves the Vite MPA public API document at `frontend/docs/index.html`, and `/market`, `/market/:chainId/:contract/:demandId`, `/create-demand`, `/analytics` are app routes.

Docker starts `backend/start.ts` through `docker/Dockerfile.api`; Caddy serves the web image and proxies `/v1`, `/v1/*`, `/live`, `/health` and `/ready`. One **Bun API replica** owns a local payment volume. Indexes, quotas and admission limits are process-local. SQLite and OKX do not share an atomic transaction; no distributed exactly-once guarantee is made. See [Self-hosting](SELF_HOSTING.md) and [Payment recovery](PAYMENT_RECOVERY.md).

The active public site is [https://unmetxyz.my.id](https://unmetxyz.my.id). Repository G0.5 changes do not update that running release.

## Local G0.2 validation source

The repository also contains a separate Bun validation runtime, described in [API](API.md#standalone-g02-validation-runtime). Its dependency path is `validation-service` → `validation-config`, `validation-evaluator`, `validation-codec` and `validation-transport`. It uses a local read-only ABI for chain reads and does not import the existing payment runtime, SQLite storage or API entrypoint. It is not wired into the production Compose deployment.

The runtime pins demand, nonce and ERC-1271 reads to a canonical block hash, checks the block again after evaluation, and verifies enabled token decimals at startup. It verifies builder authorization before unpaid target inspection. A separate authenticated Unix-socket signer owns the verifier key, accepts only the attestation type and allowlisted deployment/policy, and returns a signature the validator independently recovers before PASS. Isolation protects the key but does not establish the truth of a compromised validator's observations. No deployment or production readiness follows from local tests; they do not establish VPS firewall, namespace, mount, secret or egress isolation. Onchain consumption and replay prevention are implemented in the G0.4 AgentDemand source. G0.5 consumers use the same attestation schema; the browser signs builder authorization before requesting validation and separately signs the onchain submission after PASS.

## Independent network contexts

The demand market selects one deployment: chain, contract, RPC, deployment block, chain metadata and escrow-token address/symbol/decimals. The reviewed acceptance configuration uses faucet `USDC_TEST` on X Layer Testnet (`1952`), with the AgentDemand identity pinned in `.env.example` and the public Gate-0 policy. Activation verifies RPC chain, contract bytecode, immutable `token()` and token decimals. Custom chain metadata supports future deployments without changing wallet identity. One contract holds one immutable exact-transfer ERC-20; token symbols do not prove compatibility.

Only the x402 middleware for `POST /v1/opportunities` uses `X402_CHAIN_ID`. Production sets it explicitly to X Layer Mainnet (`196`) and advertises three fixed native EIP-3009 assets. `X402_RPC_URL` independently confirms Mainnet settlement receipts; it is never sourced from the market Testnet RPC. This payment setting is never used by `backend/contract.ts` or demand-market clients.

`backend/AgentDemand.sol` is the canonical escrow source. AgentDemand is the only supported escrow protocol; no dual-version runtime is planned. G0.4 replaces Solidity source/tests without deploying or migrating funds. Frontend and backend consume the reviewed canonical ABI in `shared/abi.ts`, including the five-argument attestation submit and digest-bearing events. `backend/admin.ts` disables `deploy-testnet` and `deploy-mainnet` with `DEPLOYMENT_TOOLING_UNAVAILABLE` before deployment work. The obsolete six-argument flow is removed, so the canonical artifact cannot enter it. Offline `plan` validates all eight constructor arguments; read-only `inspect` verifies configured deployment parameters. Actual deployment requires separate owner authorization. Live addresses and onchain state are unchanged. The backend derives demand information from blockchain state. Self-hosted `bun:sqlite` persists x402 payment/idempotency and settlement records; it is not an escrow database. There is no database server, Redis or offchain demand authority.

## Deployment and demand identity

Deployment identity is `(chainId, normalized contract)`; demand identity adds `demandId`. Routes carry all three values and reject unknown deployments. Backend index state and frontend market cursors bind their checkpoints to one deployment, so demand IDs remain local within that state. Rankings never combine different deployments or assets.

Pending v2 records use `chainId:contract:wallet:actionId`; approval intents separately bind the ERC-20 destination and escrow spender. Legacy records lacking contract identity remain preserved and unavailable for automatic recovery. Wallet/provider/chain checks and exact transaction intent matching remain required.

The browser hashes ordered query pairs and GET/POST metadata with JCS plus SHA-256, signs the G0.3 EIP-712 authorization, and calls the explicitly configured validator endpoint. PASS bindings, current-verifier signature, expiry and nonce are checked before a separately user-signed submit. Receipt success and canonical state readback precede submission success. Validation failures never trigger automatic submission or validation retries.

## Free discovery and paid intelligence

`GET /v1/demands` retains its public market fields and legacy score for API compatibility. The frontend reads the contract directly; its board, detail and analytics views do not consume either API response.

`POST /v1/opportunities` uses the same index and filters, with no additional RPC reads. It adds rank within the full matching pool before the response limit, a reproducible score breakdown, current escrow per historically expected call, remaining deadline/review time, review gaps, and deterministic reasons and cautions. Requested response order remains independent of score rank. Percentile tables are prepared once per pool; premium row enrichment applies only to the returned rows.

Premium serialization executes after the existing official payment middleware. SDK response buffering and durable settlement confirmation continue to control release. Free and unpaid challenge responses contain no new premium fields. All existing onchain facts remain public; paid value is the scoped comparison and interpretation. Scores are relative signals, and escrow is not guaranteed builder earnings. See [API calculations and examples](API.md#deterministic-demand-score).

## Canonical attestation

AgentDemand accepts only the five-argument `submitService(demandId, serviceUrl, evidenceHash, attestation, verifierSignature)`. The G0.3 `ValidationAttestation` EIP-712 domain is `UNMET AgentDemand`, version `2`, the current chain ID and this contract, without salt. The signature binds every typed field, the caller, exact URL bytes, evidence and next submission nonce. Time bounds are `issuedAt <= now + 60`, `issuedAt < expiresAt`, lifetime at most 900 seconds and `now < expiresAt`.

Only the current verifier's canonical 65-byte low-s ECDSA signature is accepted. The immutable `verifierAdmin` may only rotate that verifier through `setVerifier`; rotation is immediate and leaves accepted proposals and escrow rights unchanged. Submission atomically advances `submissionNonce`; invalid attempts do not consume it, and reopen never resets it. `submissionDigests(demandId, nonce)` preserves authenticated payment-requirements and validation-policy hashes across proposals. Voting, finalization, reopen and refunds require no verifier availability.

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
 | quorum reached -> finalize before grace ends -> FULFILLED
 | quorum reached -> cancel at grace end ------> CANCELLED
 |
 | rejection threshold reached, or review ends below quorum
 | while demand deadline is active
 v
reopen -> SubmissionRejected -> OPEN

OPEN after deadline --------------------------> supporter refunds
SUBMITTED after deadline + review end
  and below quorum ---------------------------> supporter refunds
last refundable balance withdrawn from an expired unfulfilled demand -> CLOSED
```

Important invariants:
- New support is disabled during review, so the approval denominator cannot move.
- `approvalRequired` is a ceil-rounded snapshot created at submission.
- Refunds cannot lower the threshold for an existing submission.
- A submission that reached quorum settles before seven days after review end; at or after that boundary anyone may cancel settlement and every remaining supporter may refund. After fulfillment, eligible non-approver commitments remain refundable.
- `FULFILLED` remains the lifecycle state after eligible non-approver refunds, including the final such refund; `CLOSED` applies when an expired unfulfilled demand has no remaining refundable balance.
- Approvals are scoped to `submissionNonce`; old votes never carry into a new candidate.
- Approvers may not also reject the same submission. Rejection weight is measured against the review snapshot; reaching `reviewCommitted - approvalRequired + 1` makes quorum impossible and permits immediate reopen before the demand deadline.
- Reopening emits `SubmissionRejected` and clears candidate-specific vote progress. The demand returns to `Open` while its deadline remains active.
- Cancelled remains terminal after its final refund; cancellation clears only its own active key and does not transfer funds. Votes specify the intended submission nonce.
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
validated request -> route/IP quota -> admission -> official x402 middleware
  unpaid -> HTTP 402 + PAYMENT-REQUIRED
  PAYMENT-SIGNATURE -> official verify
    -> durable SQLite reservation (self-hosted only)
    -> buffered chain-derived execution
    -> durable SETTLEMENT_IN_FLIGHT before official settle
    -> checkpoint returned hash -> verify canonical Mainnet L2 inclusion and token logs
    -> confirmed SETTLED -> release result + PAYMENT-RESPONSE
    -> ambiguous outcome -> UNKNOWN, withhold content, HTTP 409
```

The official Express SDK buffers execution **before settlement** and skips settlement on failed execution. Durable mode adds no custom payment signing, settlement or bypass; it preserves the official verifier and facilitator while independently correlating the persisted operation with canonical receipt evidence. Content remains blocked until strict facilitator success and persisted-receipt inclusion proof. Proof uses current canonical L2 inclusion, not safe/finalized or L1 finality, so sequencer/reorg risk remains. Duplicate/conflicting reservations return 409. Optional `Idempotency-Key` binds a logical request but never enables original paid-response replay. Status-only operator reconciliation never resubmits settlement; a missing hash can require manual investigation.

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

[ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) was compared as a **Draft** in the original design rationale below. This retained comparison describes the specification inspected then; it does not claim incompatibility, superiority or a current standards review. ERC-8183 solves a neighboring problem at a different abstraction layer.

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

## Historical native-USDC template provenance

The [Circle address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [X Layer native-USDC announcement](https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer) identify Testnet USDC as `0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3`. On 2026-10-31, read-only calls to `https://testrpc.xlayer.tech/terigon` reported chain ID `1952`; at block `44951534`, the token had 1,798 bytes of code, `decimals() = 6` and `symbol() = USDC`. This establishes the template token address/metadata, not a canonical AgentDemand deployment, exact-transfer acceptance test, paid settlement or production readiness. The runtime repeats the configured token/decimal binding checks when a deployment is used.


## Faucet-supported Testnet acceptance deployment

On 2026-11-01, the owner authorized one replacement AgentDemand on chain `1952` because the actual faucet balance was a different ERC-20 from the historical native-USDC template. This deployment is protocol acceptance using faucet `USDC_TEST`, not evidence of Circle native-USDC behavior.

| Identity | Verified value |
| --- | --- |
| AgentDemand | `0x4411C49F8a3Efcc671A1b11E651Cc82AbeAdace5` |
| Deployment transaction | [`0x7a2f9d92e2b376966d085c3846357f2ed86f596f4e4748a00e00a349aa61dab3`](https://www.oklink.com/x-layer-testnet/tx/0x7a2f9d92e2b376966d085c3846357f2ed86f596f4e4748a00e00a349aa61dab3) |
| Deployment block / gas used | `45074702` / `3789178` |
| Deployed source / unchanged contract-ABI baseline | `e960a04b94ed85d8392c4107cd635cfe24728dd8` / `b16354a6ae427a75df278702a56af1712bd0a4b7` |
| Escrow token | `0xcB8BF24c6cE16Ad21D707c9505421a17f2bec79D` |
| Token name / symbol / decimals | `USDC_TEST` / `USDC_TEST` / `6` |
| Deployer / treasury / verifier / verifierAdmin | `0x00000A43Df0bf634a1A917e61192344961152F4e` for all four Testnet roles |
| feeBps / quorumBps / minCommitment | `200` / `6000` / `10000` |
| reviewPeriod / SETTLEMENT_GRACE | `86400` / `604800` |
| Initial nextDemandId / totalEscrowed | `1` / `0` at deployment block |

Faucet receipt [`0x30b095098eb79fef3dc75739736aed54dd8a6dda5469a82d0238c0916016c195`](https://www.oklink.com/x-layer-testnet/tx/0x30b095098eb79fef3dc75739736aed54dd8a6dda5469a82d0238c0916016c195), block `45073416`, contains a Transfer log emitted by `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d`: faucet `0xf6d088123a3c17e6047ae9338b8cf072ad448907` sent `10000000` atomics to `0xaa68e429319d065ce9fd5842497a8dbec786075a`. The owner's pinned readback was `20000000` atomics (20 USDC_TEST). Identity comes from the receipt/log and RPC bytecode/metadata/balance, not its symbol.

The [verified proxy](https://www.oklink.com/x-layer-testnet/token/0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d?tab=contract) is AdminUpgradeabilityProxy; its active [verified implementation](https://www.oklink.com/x-layer-testnet/address/0xc436aa964fc921cd29ff7dd9221390d45658b721/contract) is FiatTokenV2_2 (`0xc436aa964fc921cd29ff7dd9221390d45658b721`). Read-only state-override `eth_call` simulations passed standard approve/allowance, transfer and transferFrom with true returns, exact sender/receiver deltas, allowance decrement and unchanged total supply. Owner, operator and predicted escrow were not blacklisted; the token was not paused. These simulations persisted no transfer or allowance changes. Public RPC denied debug_traceCall (403), so no trace-based callback claim is made. Upgrade, mint, pause and blacklist authority remain with token administrators; the implementation/state must be rechecked if they change. This bounded compatibility evidence supports Testnet acceptance, not unrestricted token guarantees.

The old AgentDemand `0x57bdd53eaabda18c81afea1dfcac30b15bd58e99` with token `0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3` remains onchain and is no longer the active acceptance reference. Immediately before replacement at block `45074697`, and again afterward, it read `nextDemandId = 1`, `totalEscrowed = 0`; no transaction was sent to it.

The [public policy](gate0-testnet-policy.json) now binds the replacement escrow address. Its validationPolicyId changed from `0x7e74b01782c3851842b7520000058814e32eb3bfce82872e09b08e2f6faa6fd4` to `0xadd7277f7b08fa5cb3e56d045ff684567d708451e01dcd1ff36f9c6254c2d783` by canonical JCS/SHA-256 recomputation. The signer allows only the new exact deployment/policy tuple. Mainnet `eip155:196` USDC demandPriceAsset, the approved payment profile, the 300-second authorization timeout, the 900-second attestation bound and independent three-offer intelligence billing are unchanged. Existing browser records are deployment-scoped; old approvals/pending records do not migrate to this address. No create/support/submit/vote/finalize/refund action was part of replacement acceptance.
