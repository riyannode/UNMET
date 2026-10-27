# Production runbook

All command blocks start at the repository root unless they explicitly change directory. Deployment and signed-payment procedures require their own authorization.

## 1. Toolchain

Manifest/image toolchain (local cleanup checks also passed with Bun 1.4.3):
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
bun run test:frontend
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

Contract deployment and signed-payment procedures below require separate explicit authorization. They are not contributor smoke checks. Use [CONTRIBUTING](../CONTRIBUTING.md) for local environment loading, offline checks and Docker validation; use [SELF_HOSTING](SELF_HOSTING.md) and [PAYMENT_RECOVERY](PAYMENT_RECOVERY.md) for current Compose operations.

## 4. X Layer Testnet

### 4.1 Verify the official OKX Mock Merchant

Use the current OnchainOS buyer flow and official Mock Merchant first:

```text
https://www.okx.com/api/v1/pay/mock-merchant/resource
```

Use the official OnchainOS `payment quote` flow. Review the actual network, asset, amount, recipient, and EIP-712 token domain before signing. Do not hand-build the payment header. A successful result requires a transaction hash with a successful receipt and a replayed resource response. The seller SDK's `eip155:196` default is mainnet; use `eip155:1952` for testnet.

The currently documented buyer example expects test USD₮0, but the live Mock Merchant may return different terms. Record the raw response and inspect the returned token on X Layer Testnet before payment. If the token is not available from an official testnet faucet or the domain metadata does not match the on-chain token, do not pay that challenge; continue independent UNMET contract and seller checks. See [OKX_PAYMENT_DEBUG.md](OKX_PAYMENT_DEBUG.md) for the reproduced `USDC_TEST` / EIP-712 version mismatch.

Use a separate private ignored `.env.deploy` file, loaded explicitly with Bun; never pass its key to runtime containers. Example fields:

```text
CHAIN_ID=1952
XLAYER_RPC_URL=https://testrpc.xlayer.tech/terigon
PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
UNMET_TREASURY=0x...
DEPLOYER_PRIVATE_KEY=0x...
```

Deploy:

```bash
bun --env-file=.env.deploy run backend/admin.ts deploy-testnet
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
bun --env-file=.env run backend/admin.ts inspect
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
X402_CHAIN_ID=196
X402_RPC_URL=https://rpc.xlayer.tech
```

Set `PAYMENT_DB_PATH` to an absolute file path inside a private directory that already exists.

`OKX_PAY_TO` is canonical. `PAY_TO_ADDRESS` remains a legacy fallback for existing local configuration; use `OKX_PAY_TO` for new setup.

The server intentionally refuses to start the paid production path without these credentials.

Run:

```bash
bun --env-file=.env run backend/start.ts
```

Verify:

```bash
curl -i http://127.0.0.1:8787/health
curl -i -X POST http://127.0.0.1:8787/v1/opportunities \
  -H 'content-type: application/json' \
  -d '{"minBounty":"0","minSupporters":1,"sort":"bounty","limit":5}'
```

Second request must produce the official x402 HTTP 402 challenge. A paid acceptance run requires explicit authorization, `X402_CHAIN_ID=196`, an independent Mainnet `X402_RPC_URL`, and durable SQLite at `PAYMENT_DB_PATH`. Complete an authorized OKX-supported payment with an x402 client, replay the same request, and retain:
- 402 response headers/body
- paid request
- settlement/payment evidence
- HTTP 200 result

There is no demo-payment bypass. If facilitator credentials are unavailable, payment verification is **incomplete**, not passed.

Network separation: `CHAIN_ID=1952` and `PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` keep the UNMET demand market on X Layer Testnet. Only `POST /v1/opportunities` uses `X402_CHAIN_ID`; production must explicitly set `X402_CHAIN_ID=196`. The application advertises three ordered native EIP-3009 exact Mainnet offers: USD₮0 (`0x779ded0c9e1022225f8e0630b35a9b54be713736`), USDC (`0xb6ceceab302e2e4948951ee7843fc24e92933061`), and USDG (`0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`). Each costs `10000` atomic units (6 decimals) and uses `OKX_PAY_TO`. Nonproduction `X402_CHAIN_ID=1952` may be used to inspect its existing Testnet challenge, but durable paid acceptance is Mainnet-only. Never change `CHAIN_ID` to move the billing rail.

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
- select a market request from Market Requests and confirm it opens the dedicated Demand view
- navigate Request Details, Escrow & Support, and Builder Proposal; return to the originating view with Back
- Create Demand collects six terms in the guided chat, supports review/edit, and shows Create & Fund Demand only after explicit create intent
- confirm Support This Request and Submit Service Proposal are visible only when their existing lifecycle conditions allow them
- Analytics opens a selected demand in the same Demand view
- support from a second wallet; read back the board and position
- submit an HTTPS service URL and evidence
- approve or reject and verify commitment-weighted progress
- finalize only after quorum; verify only approver funds settle
- verify Refund and Reopen Demand appear only when eligible
- explorer links open correctly

## 8. Production operations

Use the Docker Compose and Caddy deployment documented in [Self-hosting](SELF_HOSTING.md). The active public site is [https://unmetxyz.my.id](https://unmetxyz.my.id); confirm current availability directly rather than relying on dated status records.

For payment incidents, follow [Payment recovery](PAYMENT_RECOVERY.md). Preserve the persistent payment_data volume during updates and rollback; never infer settlement from a local build or smoke test.

## 9. Mainnet demand-market gate

Mainnet is chain `196`; its USD₮0 address is:
`0x779ded0c9e1022225f8e0630b35a9b54be713736`.

Production x402 billing is configured for this network, but that does **not** move the demand market or authorize a mainnet contract deployment, and does not imply a current public deployment or OKX.AI listing approval. Keep core `CHAIN_ID=1952`, `PAYMENT_TOKEN=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, the existing contract, and frontend chain on Testnet. A future demand-market migration requires its own explicit scope, authorization, and full verification. Only for that separate release, after every Testnet + x402 + browser check above passes:

```bash
export ALLOW_MAINNET_DEPLOY=1
# switch CHAIN_ID/RPC/token and re-check treasury/deployer
bun --env-file=.env.deploy run backend/admin.ts deploy-mainnet
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
