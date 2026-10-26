# UNMET Demand API

UNMET exposes public chain-derived demand data and a separate paid intelligence endpoint. Demand-market reads and escrow use the configured market chain. The intelligence endpoint uses OKX x402 billing and does not fund demands or buy service execution.

## Endpoints

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /v1/demands` | Free | Up to 50 current public demands, sorted by current escrow descending and demand ID descending. |
| `POST /v1/opportunities` | OKX x402 payment required | Filtered and ranked demand intelligence. |

See [OpenAPI](./openapi.json) for request and response schemas, or [Payment guide](./payment.md) for the paid request flow. API clients should send `Accept: application/json`. Markdown negotiation does not change API responses. The pinned x402 SDK can return an HTML payment page for requests that include both `Accept: text/html` and a Mozilla browser user agent; this browser-specific 402 may omit `PAYMENT-REQUIRED`.

## GET /v1/demands

Returns `chainId`, `contract`, `blockNumber`, `generatedAt`, and `demands`. Each demand row contains its public accounting, review, and legacy `score` fields. The response is capped at 50 and has no pagination or query-filter contract. This endpoint never returns paid-only analysis fields.

## POST /v1/opportunities

Send an `application/json` object with optional `minBounty` (decimal string, up to six fractional digits), `minSupporters` (uint32), `status` (`open`, `submitted`, `ready`, `rejected`, `expired`, `fulfilled`, or `closed`), `sort` (`bounty`, `supporters`, `calls`, `deadline`, `score`), and `limit` (1–50). Defaults are `0`, `1`, `open`, `bounty`, and `10`. Status comparisons are case-insensitive; omit `status` to use the default filter. A supplied `null` is invalid.

The `200` response includes chain metadata, paid `analysis` metadata, and ranked `opportunities`. For machine requests, send `Accept: application/json`; an unpaid request receives HTTP `402` with an x402 v2 challenge in the `PAYMENT-REQUIRED` header. Browser-like requests (`Accept: text/html` and a Mozilla user agent) may instead receive an HTML payment page without that header. Follow the JSON challenge and replay the same JSON request with `PAYMENT-SIGNATURE`; do not treat the challenge itself as a payment or as a Markdown document.
