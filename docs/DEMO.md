# UNMET demo (2–4 minutes)

Final submission video:
[https://youtu.be/6eCRf7iAbFo](https://youtu.be/6eCRf7iAbFo)

This is the final edited judge-facing demo; the reproducible walkthrough below remains the technical demo guide.

## Current status

The demand contract and funded lifecycle evidence are on X Layer Testnet (`eip155:1952`). The live frontend is [frontend-omega-beige-33.vercel.app](https://frontend-omega-beige-33.vercel.app); the public API is [unmet-api.vercel.app](https://unmet-api.vercel.app). Current deployment readbacks are in [STATUS](STATUS.md).

The unpaid `POST /v1/opportunities` request currently returns an x402 v2 challenge on X Layer Mainnet (`eip155:196`). Show the challenge only; no paid Mainnet replay is documented. A successful paid Testnet replay is historical evidence in [STATUS](STATUS.md) and does not prove Mainnet settlement. The latest recorded OKX.AI status, dated 2026-09-23, is unlisted with review not submitted; no newer approval evidence was found for this update.

## Judge path through the frontend

1. **Market Requests** — compare capability, escrow, expected calls, supporting wallets, max price, and status.
2. **Open a market request** — select a row. It opens a dedicated Demand view and keeps the source page available through its back action.
3. **Request Details** — show the request details and current market state.
4. **Escrow & Support** — show current escrow, the connected wallet's commitment, and the amount/call inputs. The **Support This Request** and eligible refund actions stay with this demand.
5. **Builder Proposal** — show the builder, service URL, evidence, proposal controls, commitment-weighted approval/rejection progress, and settlement actions only when eligible. When open, the **Submit Service Proposal** action is available here.
6. **Post a Request** — show the Request, Economics, and Initial Escrow sections and the **Post Request & Commit Escrow** action.
7. **My Activity** — select a position to open its Demand view; use the back action to return to My Activity.

## Optional Testnet lifecycle walkthrough

Use pre-funded test wallets and Testnet USD₮0 only. Production wallet transaction signing has not been verified.

1. Wallet A creates a demand with a capability, price ceiling, expected calls, deadline, and initial commitment.
2. Wallet B commits additional funds to the same demand.
3. Wallet C submits a service URL and evidence hash from **Builder Proposal**.
4. Supporters review the candidate. Approval weight comes from commitments made before submission; one wallet is not one vote.
5. After the fixed approval quorum is reached, any account can finalize. Read back that only explicit approver funds settle: the builder receives the approved amount less the fee, and the treasury receives the fee.
6. Show non-approver refunds when eligible. For an unsuccessful candidate, reopen is available only when the contract's rejection/review and deadline conditions allow it.

The successful receipts, state readbacks, and token deltas are recorded in [STATUS](STATUS.md). Do not demonstrate paid Mainnet behavior as if it were verified.

## Demand Intelligence endpoint

Send an unpaid request to `POST https://unmet-api.vercel.app/v1/opportunities` and show the HTTP 402 challenge terms for `eip155:196`. Do not pay the challenge during this demo. Never use a fake payment header or local bypass. The historical paid Testnet replay is recorded separately in [STATUS](STATUS.md).

## Evidence checklist

- [x] Contract tests and backend tests passed in the recorded verification
- [x] Typecheck and frontend production build passed in the recorded verification
- [x] X Layer Testnet deployment and immutable configuration readback
- [x] Create/support and submit/approve/finalize receipts and readbacks
- [x] Builder/treasury balance deltas and a separate refund receipt
- [x] Local browser E2E against the deployed Testnet contract
- [x] Public frontend and API smoke checks
- [x] Current unpaid Mainnet x402 challenge check; historical paid Testnet replay
- [ ] Paid Mainnet x402 replay and receipt (not verified)
- [ ] Production wallet-provider connection and write flow
- [ ] OKX.AI listing/integration URL; latest recorded status is unlisted and review not submitted
- [x] Security limitation documented: contract not independently audited

The official Mock Merchant seller replay is a separate known failure; it is not the UNMET seller flow. The project is not production-ready while paid Mainnet replay, production wallet verification, OKX.AI publication, and an independent contract audit remain outstanding. Detailed historical payment debugging is in [OKX_PAYMENT_DEBUG](OKX_PAYMENT_DEBUG.md).
