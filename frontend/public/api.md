# UNMET Demand API

UNMET exposes public chain-derived demand data and a separate paid intelligence endpoint. Demand-market reads and escrow use the configured market chain. The intelligence endpoint uses OKX x402 billing and does not fund demands or buy service execution.

## Endpoints

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /v1/demands` | Free | Up to 50 current public demands, sorted by current escrow descending and demand ID descending. |
| `POST /v1/demands/prepare` | Free | Validate a structured demand and return unsigned transaction data. |
| `POST /v1/opportunities` | OKX x402 payment required | Filtered and ranked demand intelligence. |

See [OpenAPI](./openapi.json) for request and response schemas, or [Payment guide](./payment.md) for the paid request flow. API clients should send `Accept: application/json`. Markdown negotiation does not change API responses. The pinned x402 SDK can return an HTML payment page for requests that include both `Accept: text/html` and a Mozilla browser user agent; this browser-specific 402 may omit `PAYMENT-REQUIRED`.

## GET /v1/demands

Returns `chainId`, `contract`, `blockNumber`, `generatedAt`, and `demands`. Each demand row contains its public accounting, review, legacy `score` fields and raw onchain `specification` unchanged, including historical plain text and unknown versions. The response is capped at 50 and has no pagination or query-filter contract. This endpoint never returns paid-only analysis fields.

## POST /v1/demands/prepare

Free unsigned preparation for the configured escrow deployment. Send an uncompressed UTF-8 `application/json` object, at most 32 KiB, with exactly these fields. Duplicate keys, unknown fields and malformed JSON are rejected before RPC work.

| Field | Required value |
| --- | --- |
| `chainId` | Positive safe JSON integer, exactly the configured escrow chain |
| `contract` | Nonzero EVM address, exactly the configured escrow contract |
| `capability` | Canonical lowercase slug, at most 64 characters; letters/digits separated by single hyphens |
| `specification` | Exactly `{ "schemaVersion": "unmet-rfq-v1", "description": "..." }` |
| `maxUnitPrice` | Positive uint96 decimal integer string in raw Mainnet USDC units (6 decimals), independent of escrow collateral |
| `expectedCalls` | Positive uint64 decimal integer string |
| `deadline` | Absolute Unix seconds as a uint64 decimal integer string, at least the current chain block timestamp plus 3,600 seconds |
| `initialCommitment` | Positive uint96 decimal integer string in raw configured escrow-token units, at least the current contract `minCommitment` |

Integer strings have no leading zeros, signs, whitespace, decimal points or exponent notation. Maximum uint96 is `79228162514264337593543950335`; maximum uint64 is `18446744073709551615`.

Both this endpoint and the human frontend use `shared/rfq.ts` to trim leading/trailing description whitespace, reject empty/invalid Unicode descriptions and JCS-serialize exactly the v1 object. The stored specification must fit 2,048 UTF-8 bytes, including JSON escaping and metadata. Economic fields remain separate contract arguments. No document, URI, hash or retrieval is involved.

Success is HTTP 200 with exactly `{ chainId, to, data, value: "0" }`. `data` encodes existing `createDemand(capability, specification, maxUnitPrice, expectedCalls, deadline, initialCommitment)`. The endpoint verifies chain, contract bytecode, token and token decimals, then reads the current chain timestamp and pinned `minCommitment`. It shares the demand quota and request admission limit and does not access the demand index, payment middleware, private keys, signing, broadcasting or ERC-20 approvals.

Preparation reserves nothing and is not an execution guarantee. The caller must review decoded arguments and target, use the intended account/chain, arrange any required token allowance, and recheck deadline, deployment and current contract state before explicitly signing. Account, allowance, active duplicate demand and contract state can change after preparation. An active duplicate may revert at execution. Demand identity still depends on exact capability and specification bytes; economics do not change that key.

## POST /v1/opportunities

Send an `application/json` object with optional `minBounty` (decimal string, up to six fractional digits), `minSupporters` (uint32), `status` (`open`, `submitted`, `ready`, `rejected`, `expired`, `fulfilled`, or `closed`), `sort` (`bounty`, `supporters`, `calls`, `deadline`, `score`), and `limit` (1–50). Defaults are `0`, `1`, `open`, `bounty`, and `10`. Status comparisons are case-insensitive; omit `status` to use the default filter. A supplied `null` is invalid.

The `200` response includes chain metadata, paid `analysis` metadata, and ranked `opportunities`. For machine requests, send `Accept: application/json`; an unpaid request receives HTTP `402` with an x402 v2 challenge in the `PAYMENT-REQUIRED` header. Browser-like requests (`Accept: text/html` and a Mozilla user agent) may instead receive an HTML payment page without that header. Follow the JSON challenge and replay the same JSON request with `PAYMENT-SIGNATURE`; do not treat the challenge itself as a payment or as a Markdown document.

## Fulfilled services

`GET /v1/services` returns up to 50 fulfilled demands as services, ordered by descending numeric demand ID. `GET /v1/services/:id` reads any fulfilled demand in the index. The ID is a canonical positive decimal uint256; invalid IDs return 400, missing or nonfulfilled demands return 404, and unavailable index or chain returns 503. Both routes are free.

Each response includes chain ID, contract, snapshot block number and hash, and generation time. Each service contains demandId, capability, raw specification, builder, original serviceUrl and evidenceHash. Snapshot hash and generation time are not fulfillment block or time. A listing does not assert current provider availability or compatibility.
