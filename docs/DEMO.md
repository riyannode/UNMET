# OKX Dev Day demo (2–4 minutes)

## Evidence setup

Before a public submission, have ready:
- deployed X Layer Testnet contract address and receipt
- requester wallet A
- supporter wallet B
- builder wallet C
- test USD₮0 + OKB
- public backend HTTPS URL
- public frontend HTTPS URL
- OKX.AI listing/integration URL

The contract, local browser E2E, and UNMET x402 seller flow have already passed on X Layer Testnet (`eip155:1952`); their receipts and balance deltas are in [STATUS.md](STATUS.md). Public URLs and OKX.AI publication remain deferred. The official Mock Merchant's seller replay is a separate known failure; do not present it as the UNMET seller flow.

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
- builder token balance increase from explicit approver funds, net of fee
- protocol treasury fee calculated from the approved amount
- demand state `FULFILLED`

Funds from non-approvers remain refundable after fulfillment. Refunds do not reduce historical supporter count or aggregate expected calls.

## 7 — Safety fixture

Briefly show an expired non-approved demand where each supporter can pull only its own refund.

## Closing

“UNMET turns missing machine demand into funded market opportunities.”

## Submission evidence checklist

- [x] contract tests pass
- [x] backend tests pass
- [x] TS typecheck passes
- [x] frontend production build passes
- [x] testnet deploy receipt
- [x] immutable config readback
- [x] create/support receipts + readback
- [x] real UNMET 402 challenge
- [x] real UNMET paid replay + settlement evidence
- [x] submit/approve/finalize receipts
- [x] payout/fee balance deltas
- [x] refund receipt
- [x] browser E2E against the deployed testnet contract
- [ ] public URLs
- [ ] OKX.AI listing/integration URL
- [x] security disclaimer

The checked items are supported by the receipts and readbacks in [STATUS.md](STATUS.md). The official Mock Merchant seller replay is a separate known failure and does not substitute for or negate the passing UNMET seller flow. Public URLs and OKX.AI publication remain deferred.
