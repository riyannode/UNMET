# Production runbook

## 1. Toolchain

Required:
- Bun `1.4.2`
- stable Foundry with Solidity `0.8.37`

```bash
bun --version
forge --version
```

## 2. Dependency install

```bash
bun install

cd backend
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std.git lib/forge-std
cd ..
```

OpenZeppelin `5.6.1` is deliberately used as the audited npm `latest` baseline for this release.

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
4. supporters approve to threshold
5. finalize
6. builder balance delta is correct
7. treasury fee delta is correct
8. status is `FULFILLED`

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
```

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

## 7. Frontend

Production build:

```bash
bun run --cwd frontend build
```

Set `VITE_*` values at build time. Never place secret/private OKX or wallet credentials in `VITE_*` variables.

Browser verification:
- connect wallet
- detect wrong chain
- create demand and wait receipt
- board readback
- support from second wallet
- submit HTTPS service + evidence
- approve
- finalize
- refund fixture
- explorer links open correctly

## 8. Public deployment

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

## 9. Mainnet gate

Mainnet is chain `196`; current configured USD₮0 default:
`0x779ded0c9e1022225f8e0630b35a9b54be713736`.

Only after every Testnet + x402 + browser check above passes:

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
