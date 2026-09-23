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

The contract and local browser E2E passed on X Layer Testnet (`eip155:1952`). The public frontend and backend are live. The current unpaid x402 challenge uses X Layer Mainnet (`eip155:196`) to match A2MCP registration; one earlier paid production replay used the old Testnet challenge and is historical evidence only. No mainnet payment has been made. Receipts and current readback are in [STATUS.md](STATUS.md). OKX.AI listing/review remains pending.

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

The current challenge is a mainnet payment request. Show its terms only; do not pay it during this demo without separate mainnet-payment authorization. The historical Testnet payment replay is documented in [STATUS.md](STATUS.md). For either authorized payment run, show:
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
- [x] public frontend and backend URLs
- [x] current public unpaid mainnet 402 challenge; historical paid Testnet replay with successful receipt
- [ ] paid mainnet x402 replay and receipt (not performed)
- [x] public browser load, chain state, and no-console-error smoke check
- [ ] production wallet-provider connection and write flow (headless browser had no injected provider)
- [ ] OKX.AI listing/integration URL
- [x] security disclaimer

The checked items are supported by the receipts and readbacks in [STATUS.md](STATUS.md). The official Mock Merchant seller replay is a separate known failure and does not substitute for or negate the passing UNMET seller flow. The project is not production-ready while wallet-provider verification, OKX.AI publication, and an independent contract audit remain outstanding.
