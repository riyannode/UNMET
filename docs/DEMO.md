# OKX Dev Day demo (2–4 minutes)

## Evidence setup

Have ready:
- X Layer contract address
- deployment tx
- requester wallet A
- supporter wallet B
- builder wallet C
- test USD₮0 + OKB
- public backend HTTPS URL
- public frontend HTTPS URL
- OKX.AI listing/integration URL

## 1 — Problem

“Agent marketplaces show builders what already exists. They do not show capabilities agents repeatedly need but cannot buy.”

## 2 — Fund missing demand

Wallet A creates `vendor-kyb-singapore` with max price, expected calls and real test USD₮0 commitment.

Show successful receipt and onchain readback.

Wallet B supports the same demand. Show committed value, supporting-wallet count and expected calls increase.

## 3 — Paid machine demand intelligence

Call the public `POST /v1/opportunities` endpoint without payment.

Show:
- HTTP 402
- standard x402 `PAYMENT-REQUIRED`

Complete the actual OKX x402 payment and replay. Show:
- successful paid request
- chain-derived ranked opportunity
- chain ID / contract / block
- payment/settlement evidence

Do not use a fake header or local bypass.

## 4 — Builder turns demand into supply

Wallet C submits a public HTTPS service URL and evidence hash. Show review snapshot and fixed approval requirement.

## 5 — Supporters decide

Wallets with pre-submission commitments approve. Show commitment-weighted progress.

Explain: “One wallet is not one vote. Approval weight is the money committed before the candidate was submitted.”

## 6 — Settlement

After quorum, finalize.

Show:
- successful finalize receipt
- builder token balance increase
- protocol treasury fee increase
- demand state `FULFILLED`

## 7 — Safety fixture

Briefly show an expired non-approved demand where each supporter can pull only its own refund.

## Closing

“UNMET turns missing machine demand into funded market opportunities.”

## Submission evidence checklist

- [ ] contract tests pass
- [ ] backend tests pass
- [ ] TS typecheck passes
- [ ] frontend production build passes
- [ ] testnet deploy receipt
- [ ] immutable config readback
- [ ] create/support receipts + readback
- [ ] real 402 challenge
- [ ] real paid replay + settlement evidence
- [ ] submit/approve/finalize receipts
- [ ] payout/fee balance deltas
- [ ] refund receipt
- [ ] public URLs
- [ ] OKX.AI listing/integration URL
- [ ] security disclaimer
