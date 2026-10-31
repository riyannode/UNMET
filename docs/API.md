# API

`frontend/public/openapi.json` publishes machine-readable payment discovery metadata for `POST /v1/opportunities`. Runtime payment initialization checks that it matches the resolved x402 profile. If `X402_CHAIN_ID` or `OPPORTUNITY_PRICE` changes, regenerate and validate the artifact with `bun run sync:payment-discovery` and `bun run check:payment-discovery`; a mismatch fails closed. The static artifact can describe only payment options supported by the configured x402 scheme and identity validation; adding another network requires corresponding verification and settlement support.

Default local base URL: `http://127.0.0.1:8787`.

The public frontend serves the [OpenAPI 3.1 description](../frontend/public/openapi.json), an [RFC 9727 API catalog](../frontend/public/.well-known/api-catalog), a concise [Markdown API reference](../frontend/public/api.md), and [payment guide](../frontend/public/payment.md). These discovery documents describe the deployed API schema. API clients should send `Accept: application/json`; the pinned x402 SDK can return an HTML payment page for a request with both `Accept: text/html` and a Mozilla browser user agent, and that browser-specific 402 may omit `PAYMENT-REQUIRED`.

## Routes

| Method / route | Payment | Behavior |
| --- | --- | --- |
| `GET /live` | Public | Cheap process liveness: `{ "ok": true, "name": "UNMET" }`; no dependency calls |
| `GET /health` | Public | Checks market RPC chain ID, latest block and contract bytecode |
| `GET /ready` | Public | Payment middleware/storage readiness, then the health check |
| `GET /v1/demands` | Free | Up to 50 public chain-derived demands and the legacy score |
| `POST /v1/opportunities` | $0.01, official x402 | Scoped ranks, score breakdown, economic signals and deterministic reasoning |

`OPTIONS` returns 204 with configured CORS headers. Unknown API routes return JSON 404. `/live` is a liveness probe, not evidence of dependency readiness. `/health` results are coalesced/cached for `DEPENDENCY_CACHE_MS` (default 5000). `/ready` returns 503 `PAYMENT_UNAVAILABLE` for payment initialization/storage failure, then uses the same health result. It sends no payment and does not guarantee future settlement or index capacity.

## Standalone G0.2 validation runtime

The source includes a separate, local validation runtime. It is not part of the API routes above, is not deployed by the existing Compose configuration, and is not a production-ready validation or attestation service. With an explicitly reviewed configuration file, it can be started locally as:

```sh
VALIDATION_CONFIG_PATH=/path/to/validation-config.json bun --no-env-file backend/validation-service.ts
```

It binds `127.0.0.1:3001` and exposes only `POST /v1/x402/validate`. There is no built-in production profile. The strict configuration has `maxInFlight`, `managementAddresses`, absolute `signerSocketPath` and `signerAuthTokenPath`, and a nonempty `deployments` array. Each deployment has `escrowChainId`, `escrowContract`, `escrowRpcUrl`, lowercase nonzero `verifier`, `demandPriceAsset` and a nonempty `paymentProfiles` array. Each payment profile contains the fields in the [public policy schema](schemas/validation-policy.json) under `profile`, plus `paymentRpcUrl`. Identity is the exact `(escrowChainId, escrowContract, paymentNetwork)` tuple. RPC URLs, signer settings, verifier and admission settings are excluded from the public policy digest. Configuration and its RPC endpoints are trusted operator inputs.

Browser integration uses public build inputs `VITE_VALIDATION_URL` (the full `/v1/x402/validate` URL) and `VITE_VALIDATION_NETWORKS` (approved comma-separated CAIP-2 networks matching operator policy). Missing configuration disables builder submission. A public HTTPS reverse proxy must forward that path to the standalone validator on `127.0.0.1:3001`; the repository does not provision or deploy this ingress. A same-origin proxy path is also supported. Keep this route directed to the isolated validator, separately from the existing payment API.

For cross-origin browser calls, set `VALIDATION_ALLOWED_ORIGINS` on the standalone validator to an exact comma-separated origin allowlist. Only POST with `content-type` is allowed by preflight; unknown origins or requested headers receive 403. Responses to allowed origins include CORS headers, including FAIL/UNAVAILABLE. Cookies and ambient credentials are omitted. This transport configuration does not change the signed policy schema or establish G0.6 target-host isolation.

The request follows the [validation request schema](schemas/validation-request.json), plus the semantic rules in the [roadmap](FUTURE_IMPLEMENTATION.md#48-validation-service-endpoint). The runtime bounds raw input at 32 KiB and checks strict JSON, Unicode, numeric and depth constraints before schema validation. GET uses null body/content type; POST uses a JSON object and `application/json`. Up to 32 ordered query pairs are appended to the service URL. HTTPS targets use effective port 443 only; an explicit `:443` and the root URL without a trailing slash are accepted and serialized using WHATWG URL rules. Other noncanonical service URLs are rejected. The transport checks DNS and peer addresses, verifies TLS for the original hostname, does not follow redirects and destroys the response without reading its body.

The endpoint checks canonical pinned escrow reads, declared receiver consistency, and a same-network, same-asset integer price against the onchain maximum. The challenge must be HTTP 402 with one `PAYMENT-REQUIRED` header. It validates the entire x402 V2 envelope before selecting the first eligible offer. Its core wire interpretation is pinned to [x402 V2 revision `3c0a740ef84f5a58215a75b709b2f3332839463c`](https://github.com/x402-foundation/x402/blob/3c0a740ef84f5a58215a75b709b2f3332839463c/specs/x402-specification-v2.md): standard canonical base64 is accepted with or without padding; `extra`, if present, must be an object rather than null. Generic offers require a decimal amount and positive finite timeout; the selected EVM profile additionally requires a uint256 amount and positive safe-integer timeout within its limit. Unsupported structurally valid alternatives do not invalidate an eligible offer. The runtime never attaches payment credentials or invokes payment verification or settlement.

The validator verifies the builder's EIP-712 authorization as a canonical EOA signature or an ERC-1271 call pinned to the escrow snapshot before inspecting the target. Authorization must expire after now, have at most 900 seconds lifetime and be issued no more than 60 seconds in the future. After evaluation and canonical recheck, it requests a narrowly scoped attestation signature from the local signer and verifies recovery against the configured verifier. HTTP 200 `PASS` follows the [response schema](schemas/validation-response.json); the expiry is capped by the builder authorization. Failures use HTTP 400 `FAIL` or HTTP 503 `UNAVAILABLE`; see [Errors](ERRORS.md#g02-validation-runtime). Local tests do not prove VPS firewall, namespace, mount, secret or egress isolation.

Start the separate signer with `VALIDATION_SIGNER_CONFIG_PATH=/path/to/signer-config.json bun --no-env-file backend/validation-signer.ts`. Its strict configuration contains `schemaVersion: "unmet-validation-signer-v1"`, an absolute `socketPath`, `authTokenPath`, `privateKeyPath`, lowercase `verifier`, and nonempty `allowedPolicies` entries containing `escrowChainId`, `escrowContract`, and `validationPolicyId`. The key file contains a hex private key; its derived address must match the verifier. The shared token file contains 64–256 lowercase hexadecimal characters without a newline and must be generated with high entropy. Protect the files and socket with host permissions. The signer accepts only authenticated `unmet-validation-sign-v1` requests and derives the domain and types itself.

Validation request bodies are limited to 32,768 bytes. Bun's HTTP server has a 32,769-byte hard ceiling and can reject larger requests with HTTP 413 before the validation handler runs; that transport response does not use the validation response envelope.

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

Free discovery returns up to 50 chain-derived demands of all statuses, sorted by **current escrow descending**, then numeric demand ID descending. The envelope is `chainId`, `contract`, `blockNumber` (decimal string), `generatedAt` (ISO timestamp), and `demands`. It has no filter or pagination contract; the query string is not used. The disposable index is not the payment database.

All existing fields remain available, including public review/accounting details and `score`, for compatibility with API consumers. The legacy score is computed across the entire indexed pool before the 50-row limit. The new paid-only `analysis`, `rank`, `scoreBreakdown`, `economicSignals` and `reasoning` fields are absent. The current frontend reads contracts directly, so its market/detail/analytics views do not depend on this JSON response.

Synthetic example (one returned row shown):

```json
{
  "chainId": 1952,
  "contract": "0x3333333333333333333333333333333333333333",
  "escrowToken": { "address": "0x4444444444444444444444444444444444444444", "symbol": "USDC", "decimals": 6 },
  "blockNumber": "100",
  "generatedAt": "2026-10-26T00:00:00.000Z",
  "demands": [{
    "demandId": "3",
    "capability": "vendor-kyb-singapore",
    "currentEscrow": "100.000000",
    "fundedBounty": "100.000000",
    "reviewCommitted": "0.000000",
    "supporters": 4,
    "expectedCalls": "1000",
    "maxUnitPrice": "0.200000",
    "deadline": "2026-11-25T00:00:00.000Z",
    "status": "OPEN",
    "creator": "0x1111111111111111111111111111111111111111",
    "builder": "0x0000000000000000000000000000000000000000",
    "approvalWeight": "0",
    "approvalRequired": "0",
    "rejectionWeight": "0",
    "rejectionThreshold": "0",
    "candidateRejected": false,
    "score": 1
  }]
}
```

## POST /v1/opportunities

Paid OKX.AI/A2MCP Demand Intelligence route. Mainnet billing is fixed at `$0.01` per call; any other `OPPORTUNITY_PRICE` fails configuration. Agents receive a comparison within their matching demand pool, inspectable factor contributions, escrow/usage and review calculations, and deterministic evidence and cautions for further investigation. Public blockchain facts remain free; payment buys the comparison and interpretation.

The returned opportunity data is read from the core market network (`CHAIN_ID=1952` in production). The payment network is configured independently with `X402_CHAIN_ID=196` in production; this does not change demand reads or escrow.

### x402

The route uses the official `@okxweb3/x402-express` middleware with `OKXFacilitatorClient` and the EVM exact scheme.

Without valid payment, the middleware returns HTTP `402` using the standard x402 v2 payment challenge (`PAYMENT-REQUIRED`). The buyer pays/signs according to the challenge and replays the same request with the standard `PAYMENT-SIGNATURE` header. Official verification precedes route execution. The Express SDK buffers the result, skips settlement for unsuccessful execution, settles through OKX, then releases the response. Self-hosted durable mode records the reservation and in-flight marker before settlement and releases content only after confirmed success is persisted.

Production advertises exactly three `eip155:196` native EIP-3009 exact options in order: USD₮0 (`0x779ded0c9e1022225f8e0630b35a9b54be713736`, domain `USD₮0` v1), USDC (`0xb6ceceab302e2e4948951ee7843fc24e92933061`, `USDC` v2), and USDG (`0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`, `Global Dollar` v1). Each is `10000` atomic units (6 decimals) and uses configured `OKX_PAY_TO`, independent of the contract treasury. `X402_RPC_URL` (default `https://rpc.xlayer.tech`) is used only to confirm Mainnet inclusion and must report chain ID 196. The escrow token remains independently configured.

With durable SQLite enabled, content is released only after the facilitator reports strict success and the persisted transaction is confirmed in a successful canonical X Layer Mainnet L2 block with matching EIP-3009 authorization and token logs. This is current L2 inclusion, not safe/finalized or L1 finality. Without durable storage, unpaid requests can still receive the SDK's standard challenge, while requests carrying a payment signature receive `503 PAYMENT_STORAGE_UNAVAILABLE`.

Nonproduction `eip155:1952` configuration remains separate and uses its existing Testnet token, never a Mainnet address. This Mainnet-only confirmation policy does not accept paid Testnet settlement; use unpaid smoke tests for Testnet environments. Historical isolated Docker staging acceptance at PR #17 commit `cb346e2a73de917a01e2555363d6b54f4e4a58a7` recorded HTTP 200 and `SETTLED` for USD₮0, USDC, and USDG on Mainnet. Each response had `opportunities: []` because no demand matched the default filters. This commit-scoped evidence does not establish a current public deployment or nonempty paid results; see the [PR #17 record](https://github.com/riyannode/UNMET/pull/17).

UNMET does not accept a locally invented payment ID as proof.

### Optional Idempotency-Key (durable self-hosted mode)

`Idempotency-Key` is optional: 1–128 printable non-space ASCII characters. It is scoped to the verified payer/network and binds the validated operation. A retained authorization or conflicting key returns 409; even a settled request does **not** replay its original paid response. A fresh nonce without a stable key can be another payment. After confirmed pre-settlement cancellation only, a new authorization may reclaim the key while the original authorization stays blocked. Ambiguous outcomes require observation/operator recovery, never automatic signing or settlement retry. The supported self-hosted service requires durable SQLite for payment-key guarantees. See [Payment recovery](PAYMENT_RECOVERY.md).

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
- `minBounty`: non-negative decimal string, maximum configured escrow-token decimals
- `minSupporters`: uint32-safe integer, default `1`
- `status`: `open | submitted | ready | rejected | expired | fulfilled | closed | cancelled`, case-insensitive (default: `open`)
- `sort`: `bounty | supporters | calls | deadline | score`
- `limit`: integer `1..50`, default `10`

`minBounty` and `sort: "bounty"` use current escrow, not the historical `fundedBounty` snapshot. Default sort remains `bounty`; explicitly request `score` to order the response by intelligence rank. There is no offset/cursor pagination.

### Success

Synthetic example for `{"sort":"score","limit":1}`: three OPEN demands match before the limit, and demand 3 has strictly more escrow, calls and supporters than both peers. Its deadline is 30 days away. This is fixture data, not live market or payment evidence.

```json
{
  "chainId": 1952,
  "contract": "0x3333333333333333333333333333333333333333",
  "escrowToken": { "address": "0x4444444444444444444444444444444444444444", "symbol": "USDC", "decimals": 6 },
  "blockNumber": "100",
  "generatedAt": "2026-10-26T00:00:00.000Z",
  "analysis": {
    "poolSize": 3,
    "rankingScope": "matching_filters_before_limit",
    "scoreVersion": "escrow-percentiles-v1",
    "marketToken": "0x4444444444444444444444444444444444444444",
    "tokenDecimals": 6
  },
  "opportunities": [
    {
      "demandId": "3",
      "capability": "vendor-kyb-singapore",
      "currentEscrow": "100.000000",
      "fundedBounty": "100.000000",
      "reviewCommitted": "0.000000",
      "supporters": 4,
      "expectedCalls": "1000",
      "maxUnitPrice": "0.200000",
      "deadline": "2026-11-25T00:00:00.000Z",
      "status": "OPEN",
      "creator": "0x1111111111111111111111111111111111111111",
      "builder": "0x0000000000000000000000000000000000000000",
      "approvalWeight": "0",
      "approvalRequired": "0",
      "rejectionWeight": "0",
      "rejectionThreshold": "0",
      "candidateRejected": false,
      "score": 1,
      "rank": 1,
      "scoreBreakdown": {
        "funding": { "percentile": 1, "contribution": 0.5 },
        "expectedCalls": { "percentile": 1, "contribution": 0.25 },
        "supporters": { "percentile": 1, "contribution": 0.15 },
        "deadlineFreshness": { "factor": 1, "contribution": 0.1 }
      },
      "economicSignals": {
        "escrowPerExpectedCall": "0.100000",
        "timeRemainingSeconds": "2592000",
        "review": null
      },
      "reasoning": {
        "positive": [
          "Current escrow ranks in the upper quartile of matching demands.",
          "Historical expected calls rank in the upper quartile of matching demands.",
          "Historical supporter count ranks in the upper quartile of matching demands.",
          "Open demand can receive builder proposals before its deadline."
        ],
        "cautions": [
          "Expected calls and supporter counts are historical signals, not purchased usage or independent people.",
          "Escrow and fundedBounty do not guarantee builder earnings; only approved funds can settle, minus fees."
        ]
      }
    }
  ]
}
```

Large integer values are serialized as decimal strings so JSON never loses EVM integer precision.
`deadline` is an ISO timestamp, or `null` when a valid onchain `uint64` deadline exceeds JavaScript's supported date range. Deadline sorting places these `null` values last.

All existing opportunity fields and request defaults are preserved. Additions are paid-only and additive; clients that reject unknown JSON fields must allow the new fields. An empty matching pool legitimately returns `analysis.poolSize: 0` and `opportunities: []`, including after successful mock or live settlement; payment does not guarantee a non-empty market.

### Paid economic signals and reasoning

| Field | Calculation and interpretation |
| --- | --- |
| `escrowPerExpectedCall` | `currentEscrowAtomic / expectedCalls`, integer division rounded down, then formatted with the configured token decimals. `null` when expected calls is zero. Units: **market tokens per historically expected call**, not service price, revenue, cost coverage or payout. Values below one atomic unit become zero formatted to the configured decimals. |
| `timeRemainingSeconds` | `max(deadlineUnix - evaluationUnix, 0)`, exact decimal integer string. Still available for deadlines outside the ISO date range. |
| `review` | `null` unless the underlying contract status is SUBMITTED, including derived READY, REJECTED or EXPIRED states. It is also null for FULFILLED, CLOSED and CANCELLED. |
| `review.approvalGap` | `max(approvalRequiredAtomic - approvalWeightAtomic, 0)`, formatted as market tokens with the configured decimals. Zero does not prove settlement occurred. |
| `review.rejectionHeadroom` | `max(rejectionThresholdAtomic - rejectionWeightAtomic, 0)`, formatted as market tokens with the configured decimals: additional rejection weight that would block the candidate. |
| `review.reviewTimeRemainingSeconds` | `max(reviewEndsAtUnix - evaluationUnix, 0)`, exact decimal integer string. |

The top-level `chainId`, `contract`, and `escrowToken` identify the selected deployment and denomination. `analysis.marketToken` and `analysis.tokenDecimals` repeat the token address and decimals. They are independent of the Mainnet asset used to buy intelligence. Existing `approvalWeight`, `approvalRequired`, `rejectionWeight` and `rejectionThreshold` retain their **atomic integer string** units; `currentEscrow`, `fundedBounty`, `reviewCommitted` and `maxUnitPrice` retain fixed-width token strings at the configured decimals.

Reasoning uses only the indexed facts, evaluation time and matching-pool percentiles. Funding/call/supporter quartile claims require that the particular factor varies across the full matching pool before limit: at or above the 75th percentile can indicate a relative strength, and at or below the 25th percentile a relative weakness. A constant factor supplies no relative distinction, even though its legacy strict-lower percentile remains zero in a multi-demand pool. Absolute zero-value cautions still apply.

Equal economic factors do not imply equal overall scores: capped deadline freshness can still distinguish them. Reasoning separates economic-factor equality from equality of the emitted, rounded scores. When all rounded scores match, numeric demand ID descending determines rank. Different raw deadlines beyond the 30-day cap have the same freshness; smaller freshness differences may also disappear after score rounding. Singleton reasoning makes no peer-comparison or pool-tie claim. These rules interpret the existing score and ranking without changing either calculation.

Open proposal availability, at-most-one-day deadline urgency, candidate/review state and historical-data/escrow qualifications are explained where applicable. Arrays are bounded by a fixed set of rules. No LLM, external AI call, supporter-concentration estimate or profitability prediction is involved. Wallet counts do not establish independent people or Sybil resistance. Agents must inspect specifications, execution feasibility and current onchain state separately.

## Derived status

Stored contract states are `OPEN`, `SUBMITTED`, `FULFILLED`, `CLOSED`, `CANCELLED`.

API/UI additionally derive:
- `READY`: submitted and fixed approval quorum reached
- `REJECTED`: enough rejection weight makes approval quorum mathematically impossible
- `EXPIRED`: deadline passed and no successful path is pending
- `CANCELLED`: quorum-approved settlement was cancelled at or after seven days from review end; all remaining supporters may refund.
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

Ranking only. It does not measure service quality, builder reputation, build cost, profit or success probability. The existing formula and six-decimal score are preserved on both endpoints; its breakdown and explicit rank are new paid fields.

```text
0.50 * current-escrow percentile
+ 0.25 * expected-calls percentile
+ 0.15 * supporting-wallet percentile
+ 0.10 * time-to-deadline factor (capped at 30 days)
```

EVM integers and percentile comparisons remain `bigint`. The deadline freshness ratio converts only a remaining duration already capped at 30 days to `number` for scoring.

For a matching pool of size `N > 1`, each percentile is `count(peer value < this value) / (N - 1)`. Equal values receive equal percentiles; all-equal multi-demand pools have percentile zero. A singleton retains percentile one for compatibility, even for zero values; it provides no peer-strength evidence. An empty pool has no score rows.

The deadline factor is `min(max(deadline - evaluationTime, 0), 2592000) / 2592000`. A longer remaining deadline contributes more score; urgency does not increase it. `scoreBreakdown` exposes unrounded percentiles/factor and their weighted contributions. Add the four contributions in the documented order, then apply `Number(total.toFixed(6))` to reproduce `score`; do not round each contribution first.

Paid scoring and rank use **all entries matching the validated filters before limit** (`analysis.rankingScope`), not merely returned rows or the entire market. Rank is a unique 1-based ordinal by rounded score descending, then numeric demand ID descending. `sort` controls response order independently; a bounty-ordered first row need not have rank 1. Changing only sort or limit preserves scores/ranks; changing filters can change both. No score/rank is a cross-pool benchmark. Free uses all indexed statuses with zero minimums, so its legacy score may differ from a filtered paid score.

Percentile tables are prepared once per evaluated pool with sorting and exact integer comparisons; scoring/ranking is O(N log N), and premium explanations/economic calculations are generated only for up to 50 returned rows. Both endpoints reuse the same bounded index and add no RPC requests.

Historical Mainnet E2E acceptance passed for USD₮0, USDC and USDG at commit `cb346e2a73de917a01e2555363d6b54f4e4a58a7`, with empty opportunity results because no OPEN demands matched. The additive intelligence contract is verified with synthetic fixtures and mock settlement; it has not received new live Mainnet acceptance. No payment settlement logic is changed for this response differentiation.

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

API responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a server-generated `X-Request-ID`. CORS allows configured exact origins, exposes `link`, `payment-required`, and `payment-response`, and permits `idempotency-key`.

See the canonical [error reference](ERRORS.md) and [operational limits](SELF_HOSTING.md#limits-and-bounded-work).

The market is unavailable until an operator supplies a reviewed contract, token address and token decimals. Before market reads, the API verifies RPC chain ID, contract code, immutable `token()` and token `decimals()`; mismatches fail closed. Each index is bound to `(chainId, contract)` and ranks only that deployment.
