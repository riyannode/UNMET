# Production runbook

## 1. Toolchain

Required verified WSL toolchain:
- Bun `1.4.2`
- Foundry Forge `1.8.3`
- Solidity `0.8.37`

```bash
bun --version
forge --version
```

## 2. Dependency install

```bash
bun install --frozen-lockfile

cd backend
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std.git lib/forge-std
cd ..
```

OpenZeppelin Contracts v5.6.1 and forge-std v1.16.1 are checked out at the dependency tags used by this repository. This version statement is not an independent security audit.

## 3. Pre-deploy verification

```bash
bun run typecheck
bun run test:backend
bun run test:contract
bun run build:frontend
```

Do not deploy if any command fails.

Contract tests must cover at minimum:
- exact duplicate prevention
- fixed ceil-rounded quorum snapshot
- approver and rejection weights use pre-submission commitments
- a supporter cannot approve and reject the same submission
- rejection threshold, `SubmissionRejected` event and reopen progress reset
- refund cannot shrink quorum
- approval nonce isolation
- replacement of expired demand
- replacement cannot be cleared by old refund
- fee/payout accounting
- pull refunds and double-refund prevention
- token accounting invariant

## 4. X Layer Testnet

### 4.1 Verify the official OKX Mock Merchant

Use the current OnchainOS buyer flow and official Mock Merchant first:

```text
https://www.okx.com/api/v1/pay/mock-merchant/resource
```

Use the official OnchainOS `payment quote` flow. Review the actual network, asset, amount, recipient, and EIP-712 token domain before signing. Do not hand-build the payment header. A successful result requires a transaction hash with a successful receipt and a replayed resource response. The seller SDK's `eip155:196` default is mainnet; use `eip155:1952` for testnet.

The currently documented buyer example expects test USD₮0, but the live Mock Merchant may return different terms. Record the raw response and inspect the returned token on X Layer Testnet before payment. If the token is not available from an official testnet faucet or the domain metadata does not match the on-chain token, do not pay that challenge; continue independent UNMET contract and seller checks. See [OKX_PAYMENT_DEBUG.md](OKX_PAYMENT_DEBUG.md) for the reproduced `USDC_TEST` / EIP-712 version mismatch.

Set `.env`:

```text
CHAIN_ID=1952
XLAYER_RPC_URL=https://testrpc.xlayer.tech/terigon
PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
UNMET_TREASURY=0x...
DEPLOYER_PRIVATE_KEY=0x...
```

Deploy:

```bash
cd backend
bun run admin.ts deploy-testnet
```

Record:
- deployment tx hash
- contract address
- deployment block
- constructor readback

Then configure both:

```text
DEMAND_CONTRACT=0x...
VITE_DEMAND_CONTRACT=0x...
```

Inspect:

```bash
cd backend
bun run admin.ts inspect
```

`inspect` must find bytecode and return the expected token, treasury, fee (`200` bps), quorum (`6000` bps), minimum commitment and review period.

## 5. Contract E2E

Use at least two supporter wallets and one builder wallet.

Prove with successful receipts + state readback:
1. create demand
2. second wallet supports
3. builder submits
4. supporters approve or reject; verify rejection threshold and progress reset on reopen
5. supporters approve to threshold
6. finalize
7. only explicit approver funds are settled: approved amount less fee to builder, fee to treasury
8. non-approver funds remain in escrow and can be individually refunded after fulfillment
9. aggregate supporter count and expected calls remain historical after refunds
10. status is `FULFILLED`

Separate fixture:
1. create demand
2. let it expire without valid quorum
3. each supporter pulls its own refund
4. final state closes when committed amount reaches zero
5. exact same capability/spec can be created again

A submitted transaction hash alone is not evidence of success.

## 6. OKX x402 service

Required backend env:

```text
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
OKX_PAY_TO=0x...
OPPORTUNITY_PRICE=0.01
X402_CHAIN_ID=1952 # optional locally; otherwise inherits CHAIN_ID
```

`OKX_PAY_TO` is canonical. `PAY_TO_ADDRESS` remains a legacy fallback for existing local configuration; use `OKX_PAY_TO` for new setup.

The server intentionally refuses to start the paid production path without these credentials.

Run:

```bash
bun run --cwd backend start
```

Verify:

```bash
curl -i http://127.0.0.1:8787/health
curl -i -X POST http://127.0.0.1:8787/v1/opportunities \
  -H 'content-type: application/json' \
  -d '{"minBounty":"0","minSupporters":1,"sort":"bounty","limit":5}'
```

Second request must produce the official x402 HTTP 402 challenge. Complete a real OKX-supported payment with an x402 client, replay the same request, and retain:
- 402 response headers/body
- paid request
- settlement/payment evidence
- HTTP 200 result

There is no demo-payment bypass. If facilitator credentials are unavailable, payment verification is **incomplete**, not passed.

Network separation: `CHAIN_ID=1952` and `PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` keep the UNMET demand market on X Layer Testnet. Only `POST /v1/opportunities` uses `X402_CHAIN_ID`; production must explicitly set `X402_CHAIN_ID=196`. The official exact-scheme SDK selects mainnet USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736` from that network and converts `$0.01` to `10000` atomic units. Never change `CHAIN_ID` to move the billing rail.

Do not sign or replay the current production mainnet challenge as part of smoke verification. Unpaid `402` verification does not spend funds. A paid mainnet replay needs separate authorization and a receipt-based check.

## 7. Frontend

Production build:

```bash
bun run --cwd frontend build
```

Set `VITE_*` values at build time. Never place secret/private OKX or wallet credentials in `VITE_*` variables.

Browser verification:
- connect wallet
- detect wrong chain
- show loading/error states distinctly from an empty demand board
- create demand and wait receipt
- board readback
- support from second wallet
- submit HTTPS service + evidence
- approve
- finalize
- refund fixture
- explorer links open correctly

## 8. Public deployment

### Current network split (2026-09-23)

Backend-only production deployment `dpl_HWDy1bPJXN11e1yKMK2RpXScG35n` is on Express / Node.js 24 and serves [https://unmet-api.vercel.app](https://unmet-api.vercel.app). It was deployed from branch `feat/unmet-x402-network`, commit `ef0c249f7381bc35a0ef2fe3e467948484ebd8b0`, now pushed as the first commit of [PR #2](https://github.com/riyannode/UNMET/pull/2). The production `X402_CHAIN_ID=196` variable is set; `CHAIN_ID=1952` was left unchanged.

The current public frontend URL is [https://frontend-omega-beige-33.vercel.app](https://frontend-omega-beige-33.vercel.app).

Three verification rounds returned `/health` HTTP 200 and `/v1/demands` HTTP 200 with chain `1952`, contract `0x7c51457235cFFBae862493D788137BFf1EF07e2E`, and 3 live demands. Unpaid `POST /v1/opportunities` returned x402 v2 HTTP 402, scheme `exact`, network `eip155:196`, asset `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `10000`, payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978`. No payment or chain transaction was made. ASP `13853` / Service `40842` remain unlisted; review is pending.

### Earlier production state (before network split)

The public X Layer Testnet deployment is live from GitHub commit `de77198aef994feae84059e1ae7413852a99326e`:

| Project | URL | Deployment | Runtime |
| --- | --- | --- | --- |
| Frontend | [https://unmet-ai.vercel.app](https://unmet-ai.vercel.app) | `dpl_B6dHSuUcdB6V4EMUY2rELjB3N4qC` | Vite static deployment |
| Backend | [https://unmet-api.vercel.app](https://unmet-api.vercel.app) | `dpl_DCoAMDD9oJKuzUNoTTnf2DzLYMEx` | Express on Node.js 24 |

Verified production requests: `/health` and `/v1/demands` return HTTP 200 on chain `1952`; unpaid `POST /v1/opportunities` returns an x402 v2 HTTP 402 challenge for exact USD₮0 at `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount `10000`, and the configured treasury. One official SDK replay returned HTTP 200 and `PAYMENT-RESPONSE` status `success`; the successful receipt and token deltas are in [STATUS.md](STATUS.md). The paid request returned an empty opportunity list because no open demands were available.

Production CORS returns `Access-Control-Allow-Origin: https://unmet-ai.vercel.app`; it does not allow `http://localhost:5173` or an arbitrary foreign origin. The backend runtime does not include `DEPLOYER_PRIVATE_KEY`. The headless browser smoke test loaded live chain state without console errors or localhost requests; it had no injected wallet provider, so production wallet transaction signing remains unverified.

### Deployment configuration

Backend:
- bind to `0.0.0.0`
- terminate TLS at platform/reverse proxy
- `NODE_ENV=production`
- set exact `FRONTEND_ORIGIN`
- secrets only in platform secret store
- health check `/health`

Frontend:
- static HTTPS deployment
- correct main/testnet build-time variables

## 9. Mainnet demand-market gate

Mainnet is chain `196`; its USD₮0 address is:
`0x779ded0c9e1022225f8e0630b35a9b54be713736`.

The A2MCP x402 rail already uses this network, but that does **not** move the demand market or authorize a mainnet contract deployment. Keep core `CHAIN_ID=1952`, `PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, the existing contract, and frontend chain on Testnet. A future demand-market migration requires its own explicit scope, authorization, and full verification. Only for that separate release, after every Testnet + x402 + browser check above passes:

```bash
export ALLOW_MAINNET_DEPLOY=1
# switch CHAIN_ID/RPC/token and re-check treasury/deployer
cd backend
bun run admin.ts deploy-mainnet
```

Start with tiny values. Repeat full receipt/state/balance verification.

## 10. Incident behavior

RPC/contract unavailable:
- `/health` returns 503
- paid data endpoint must not fabricate stale canonical state
- contract remains independently accessible through another RPC/explorer

Chain reorg:
- backend verifies indexed block hash
- mismatch triggers full derived-index rebuild

Facilitator unavailable:
- paid service fails closed; never bypass verification

Frontend unavailable:
- contract remains usable directly; no funds depend on frontend availability
