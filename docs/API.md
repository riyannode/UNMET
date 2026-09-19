# API

Default local base URL: `http://127.0.0.1:8787`.

## GET /health

Free readiness check. Returns `503` if the configured contract is missing, RPC is unavailable, or no bytecode exists at the configured address.

```json
{
  "ok": true,
  "name": "UNMET",
  "chainId": 1952,
  "contract": "0x...",
  "latestBlock": "123456"
}
```

## GET /v1/demands

Free UI/discovery read. Returns up to 50 chain-derived demands sorted by committed bounty. This is not a persistent database endpoint.

## POST /v1/opportunities

Paid OKX.AI/A2MCP Demand Intelligence route. Default price: `$0.01`.

### x402

The route uses the official `@okxweb3/x402-express` middleware with `OKXFacilitatorClient` and the EVM exact scheme.

Without valid payment, the middleware returns HTTP `402` using the standard x402 v2 payment challenge (`PAYMENT-REQUIRED`). The buyer pays/signs according to the challenge and replays the same request with the standard `PAYMENT-SIGNATURE` header. Verification and settlement happen through the OKX facilitator before the protected route executes.

UNMET does not accept a locally invented payment ID as proof.

### Body

```json
{
  "minBounty": "10.000000",
  "minSupporters": 2,
  "status": "open",
  "sort": "bounty",
  "limit": 10
}
```

Rules:
- `minBounty`: non-negative decimal string, maximum 6 decimals
- `minSupporters`: uint32-safe integer, default `1`
- `status`: `open | submitted | ready | rejected | expired | fulfilled | closed` (default: `open`)
- `sort`: `bounty | supporters | calls | deadline | score`
- `limit`: integer `1..50`, default `10`

### Success

```json
{
  "chainId": 1952,
  "contract": "0x...",
  "blockNumber": "123456",
  "generatedAt": "2026-09-18T12:00:00.000Z",
  "opportunities": [
    {
      "demandId": "12",
      "capability": "vendor-kyb-singapore",
      "currentEscrow": "360.000000",
      "fundedBounty": "360.000000",
      "reviewCommitted": "0.000000",
      "supporters": 37,
      "expectedCalls": "25000",
      "maxUnitPrice": "0.020000",
      "deadline": "2026-10-15T00:00:00.000Z",
      "status": "OPEN",
      "creator": "0x...",
      "builder": "0x0000000000000000000000000000000000000000",
      "approvalWeight": "0",
      "approvalRequired": "0",
      "rejectionWeight": "0",
      "rejectionThreshold": "0",
      "candidateRejected": false,
      "score": 0.87
    }
  ]
}
```

Large integer values are serialized as decimal strings so JSON never loses EVM integer precision.
`deadline` is an ISO timestamp, or `null` when a valid onchain `uint64` deadline exceeds JavaScript's supported date range. Deadline sorting places these `null` values last.

## Derived status

Stored contract states are `OPEN`, `SUBMITTED`, `FULFILLED`, `CLOSED`.

API/UI additionally derive:
- `READY`: submitted and fixed approval quorum reached
- `REJECTED`: enough rejection weight makes approval quorum mathematically impossible
- `EXPIRED`: deadline passed and no successful path is pending
- `CLOSED`: all remaining refundable escrow has been withdrawn

During review, `rejectService` records a supporter's pre-submission commitment as rejection weight. A supporter can approve or reject once for the current submission nonce, but cannot do both. `rejectionWeight >= reviewCommitted - approvalRequired + 1` marks the candidate rejected and permits immediate reopen while the demand deadline is active. Reopening emits `SubmissionRejected`, clears the candidate and review vote progress, and returns the demand to `OPEN`.

Economic field semantics:
- `currentEscrow`: funds still held by the contract for this demand. After fulfillment this is only non-approver money that remains refundable.
- `reviewCommitted`: immutable total escrow snapshot when the current candidate entered review.
- `fundedBounty`: `reviewCommitted` once a candidate has been reviewed, otherwise current escrow. It is a historical funding signal, not necessarily the amount still payable.
- `approvalWeight`: total funds explicitly approved for the current candidate; it is the maximum amount eligible for builder settlement.
- The `DemandFulfilled` event's `approvedAmount` equals `approvalWeight` at finalization. Builder payout plus fee equals this approved amount, not the original committed pool.
- Non-approver funds remain in escrow and refundable after fulfillment. `supporters` and aggregate `expectedCalls` are historical demand signals; refunds do not decrement them.

## Deterministic demand score

Ranking only. It is not quality, probability, financial advice, or builder reputation.

```text
0.50 * current-escrow percentile
+ 0.25 * expected-calls percentile
+ 0.15 * supporting-wallet percentile
+ 0.10 * time-to-deadline factor (capped at 30 days)
```

EVM integers and percentile comparisons remain `bigint`. The deadline freshness ratio converts only a remaining duration already capped at 30 days to `number` for scoring.

## Error shape

```json
{
  "error": {
    "code": "INVALID_LIMIT",
    "message": "limit must be between 1 and 50"
  }
}
```

See `ERRORS.md`.
