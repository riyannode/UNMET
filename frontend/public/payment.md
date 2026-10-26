# UNMET API payment guide

Only `POST /v1/opportunities` is paid. It sells demand ranking and interpretation through OKX x402. Payment does not fund a demand, buy capability execution, or change escrow.

## Request flow

Start with an unpaid JSON request. An empty object is valid and uses the documented defaults:

```sh
API_ORIGIN=https://unmetxyz.my.id
curl -i "$API_ORIGIN/v1/opportunities" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data '{}'
```

For a self-hosted instance, set `API_ORIGIN` to that instance's public origin.

For machine requests, the server returns HTTP `402` and an x402 v2 challenge in the `PAYMENT-REQUIRED` response header. The challenge identifies the accepted network, token, amount, recipient, timeout, and scheme. Use those returned terms with an x402 v2 compatible client; do not copy a recipient or offer from documentation into a payment.

Machine clients should send `Accept: application/json`. The pinned x402 SDK has a browser-specific branch: when a request includes both `Accept: text/html` and a Mozilla browser user agent, it may return an HTML payment page without `PAYMENT-REQUIRED`.

The source configuration currently advertises three exact Mainnet options on `eip155:196`, each costing `10000` atomic units (6 decimals), or `$0.01`:

| Token | Contract on X Layer Mainnet |
| --- | --- |
| USD₮0 | `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| USDC | `0xb6ceceab302e2e4948951ee7843fc24e92933061` |
| USDG | `0x4ae46a509f6b1d9056937ba4500cb143933d2dc8` |

The challenge returned by the running service is authoritative; supported options may differ between releases or environments. In particular, never infer the receiver from the token or contract treasury. Clients need x402 v2 and native EIP-3009 exact-payment support for an offered chain and token; OKX operates the service's facilitator, but the client does not have to use an OKX-specific wallet.

After the client authorizes an offered option, it replays the same method, path, and JSON body with the standard `PAYMENT-SIGNATURE` header. A successful response returns the paid JSON and a base64-encoded settlement result in `PAYMENT-RESPONSE`. Decode that result as x402 metadata; it is not by itself proof of Ethereum L1 finality.

## Responses and retries

- `200`: paid opportunity analysis was returned. The matching pool can be empty.
- `400`: invalid JSON, filters, or payment authorization. Correct the request before another attempt.
- `402`: payment is required or the submitted authorization was not accepted. Follow the returned challenge; do not treat it as a receipt.
- `409`: a payment operation or authorization conflicts with an existing operation. Do not submit a fresh payment to get around it.
- `413` / `415`: the request is too large or is not `application/json`.
- `429`: the process-local request quota was reached. The request is rejected before payment verification; respect the `Retry-After` header before retrying.
- `503`: the service or payment-storage path is unavailable. An unsigned request can be retried after recovery. If a signed request had an ambiguous result, resolve that operation before considering another authorization.

Never automatically resubmit a payment after a timeout or ambiguous `503`. A fresh authorization has a new nonce and can charge again even when the earlier result is unknown. The client must not assume the original paid response will be replayed.

## Idempotency and recovery

Self-hosted durable mode optionally accepts `Idempotency-Key`: 1–128 printable non-space ASCII characters. The key binds the verified payer, network, and validated operation. It prevents conflicting retained operations from being treated as unrelated requests, but it does not replay the original paid response, and it is not a substitute for checking payment status.

When a self-hosted operation is `UNKNOWN`, recovery queries official OKX settlement status and verifies the stored transaction against canonical X Layer Mainnet L2 receipt evidence. Recovery is status-only: it never submits settlement again. Missing or ambiguous evidence remains blocked for operator investigation. The confirmation check establishes current canonical L2 inclusion, not safe/finalized status or Ethereum L1 finality. See the [payment recovery runbook](https://github.com/riyannode/UNMET/blob/main/docs/PAYMENT_RECOVERY.md) for operator procedures.
