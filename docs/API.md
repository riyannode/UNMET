# API

Default local base URL: `http://127.0.0.1:8787`.

## Routes

| Method / route | Payment | Behavior |
| --- | --- | --- |
| `GET /live` | Public | Cheap process liveness: `{ "ok": true, "name": "UNMET" }`; no dependency calls |
| `GET /health` | Public | Checks market RPC chain ID, latest block and contract bytecode |
| `GET /ready` | Public | Payment middleware/storage readiness, then the health check |
| `GET /v1/demands` | Public | Up to 50 chain-derived demands |
| `POST /v1/opportunities` | Official x402 | Filtered and ranked demand intelligence |

`OPTIONS` returns 204 with configured CORS headers. Unknown API routes return JSON 404. `/live` is a liveness probe, not evidence of dependency readiness. `/health` results are coalesced/cached for `DEPENDENCY_CACHE_MS` (default 5000). `/ready` returns 503 `PAYMENT_UNAVAILABLE` for payment initialization/storage failure, then uses the same health result. It sends no payment and does not guarantee future settlement or index capacity.

## GET /health

Free chain dependency check. Returns `503` if the configured contract is missing, RPC/chain ID is unavailable or mismatched, or no bytecode exists at the configured address.

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

Free UI/discovery read. Returns up to 50 chain-derived demands sorted by committed bounty. The envelope is `chainId`, `contract`, `blockNumber` (decimal string), `generatedAt` (ISO timestamp), and `demands` (the opportunity schema below). It has no filter or pagination contract; the query string is not used. The disposable index is not the payment database.

## POST /v1/opportunities

Paid OKX.AI/A2MCP Demand Intelligence route. Mainnet billing is fixed at `$0.01` per call; any other `OPPORTUNITY_PRICE` fails configuration.

The returned opportunity data is read from the core market network (`CHAIN_ID=1952` in production). The payment network is configured independently with `X402_CHAIN_ID=196` in production; this does not change demand reads or escrow.

### x402

The route uses the official `@okxweb3/x402-express` middleware with `OKXFacilitatorClient` and the EVM exact scheme.

Without valid payment, the middleware returns HTTP `402` using the standard x402 v2 payment challenge (`PAYMENT-REQUIRED`). The buyer pays/signs according to the challenge and replays the same request with the standard `PAYMENT-SIGNATURE` header. Official verification precedes route execution. The Express SDK buffers the result, skips settlement for unsuccessful execution, settles through OKX, then releases the response. Self-hosted durable mode records the reservation and in-flight marker before settlement and releases content only after confirmed success is persisted.

Production advertises exactly three `eip155:196` native EIP-3009 exact options in order: USD₮0 (`0x779ded0c9e1022225f8e0630b35a9b54be713736`, domain `USD₮0` v1), USDC (`0xb6ceceab302e2e4948951ee7843fc24e92933061`, `USDC` v2), and USDG (`0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`, `Global Dollar` v1). Each is `10000` atomic units (6 decimals) and uses configured `OKX_PAY_TO`, independent of the contract treasury. `X402_RPC_URL` (default `https://rpc.xlayer.tech`) is used only to confirm Mainnet inclusion and must report chain ID 196. The market's Testnet token remains separate on `eip155:1952`.

With durable SQLite enabled, content is released only after the facilitator reports strict success and the persisted transaction is confirmed in a successful canonical X Layer Mainnet L2 block with matching EIP-3009 authorization and token logs. This is current L2 inclusion, not safe/finalized or L1 finality. Without durable storage, unpaid requests can still receive the SDK's standard challenge, while requests carrying a payment signature receive `503 PAYMENT_STORAGE_UNAVAILABLE`.

Nonproduction `eip155:1952` configuration remains separate and uses its existing Testnet token, never a Mainnet address. This Mainnet-only confirmation policy does not accept paid Testnet settlement; use unpaid smoke tests for Testnet environments. Hosted direct-call paid execution has not been verified by this local implementation work.

UNMET does not accept a locally invented payment ID as proof.

### Optional Idempotency-Key (durable self-hosted mode)

`Idempotency-Key` is optional: 1–128 printable non-space ASCII characters. It is scoped to the verified payer/network and binds the validated operation. A retained authorization or conflicting key returns 409; even a settled request does **not** replay its original paid response. A fresh nonce without a stable key can be another payment. After confirmed pre-settlement cancellation only, a new authorization may reclaim the key while the original authorization stays blocked. Ambiguous outcomes require observation/operator recovery, never automatic signing or settlement retry. Vercel has no durable-key guarantee. See [Payment recovery](PAYMENT_RECOVERY.md).

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

All fields are optional; `{}` uses defaults. Body must be a JSON object, with no unknown fields, `Content-Type: application/json`, and at most 32 KiB. Validation runs before payment.

Rules:
- `minBounty`: non-negative decimal string, maximum 6 decimals
- `minSupporters`: uint32-safe integer, default `1`
- `status`: `open | submitted | ready | rejected | expired | fulfilled | closed`, case-insensitive (default: `open`)
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
- `CLOSED`: all refundable escrow has been withdrawn from a non-fulfilled demand; `FULFILLED` remains `FULFILLED` after eligible non-approver refunds, including the final refund.

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

| HTTP | Context |
| --- | --- |
| 400 | Invalid JSON/filter (`INVALID_JSON`, `INVALID_SORT`, `INVALID_STATUS`, `INVALID_LIMIT`); durable key/identity validation |
| 402 | Official x402 challenge with `PAYMENT-REQUIRED`; no paid content |
| 409 | Durable authorization/key conflict, already reserved, or settlement reconciliation required; no paid response replay |
| 413 / 415 | Oversized body / unsupported content type or encoding |
| 429 | `RATE_LIMITED`; respect `Retry-After` |
| 503 | Chain/index dependency, payment readiness, capacity, client identity or durable storage failure |

Default per-IP route quotas are 60 demands and 20 opportunities per 60 seconds, including unpaid challenges. Invalid input precedes quotas/admission; limits and admission precede x402. Limits are process-local. Retry guidance never authorizes a new payment. The error handler sanitizes unexpected execution failures as `CHAIN_RPC_UNAVAILABLE`. Readiness uses `{ ok: false, error: ... }`; normal API failures use `{ error: ... }`; official SDK challenge/payment bodies retain SDK format.

API responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a server-generated `X-Request-ID`. CORS allows configured exact origins and exposes `payment-required` / `payment-response`; it permits `idempotency-key`.

See the canonical [error reference](ERRORS.md) and [operational limits](SELF_HOSTING.md#limits-and-bounded-work).
