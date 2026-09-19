# Verification Status

Date: 2026-09-20

Status: **PARTIAL — TESTNET CONTRACT/BROWSER AND UNMET X402 PAID FLOW PASS; MOCK CHALLENGE DEFECT AND SELLER REPLAY FAILURE REPRODUCED**

All chain writes in this run used X Layer Testnet (`eip155:1952`). Mainnet (`196`) and real assets were not used. Private keys remain in the ignored local `.env` and were not copied into the browser. One test supporter key was accidentally included in a diagnostic tool output; that signer was not used afterward and must be replaced before reuse. No key value is recorded here.

## Verified WSL environment

- Ubuntu 24.04 on WSL2
- Bun 1.4.2
- Foundry Forge 1.8.3
- Solidity 0.8.37
- RPC: `https://testrpc.xlayer.tech/terigon`

## Deployment and readback

| Field | Verified value |
| --- | --- |
| Chain ID | `1952` |
| Deployment receipt | Success, block `41369800` |
| Deployment transaction | `0x11cf1b6415dba756c98c88f8d1c174b2e38c0c2b0f8fb5ba61dac930ebc94284` |
| Contract | `0x7c51457235cFFBae862493D788137BFf1EF07e2E` |
| Bytecode | Present, 13,440 bytes |
| Payment token | USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Treasury | Test wallet `0x237481F7Fd0A6F87f548FB3030015a82784e8978` |
| Fee / quorum | 200 / 6,000 bps |
| Minimum commitment | 10,000 token units (0.01 USD₮0) |
| Review period | 86,400 seconds |

`bun --env-file=../.env run admin.ts inspect` read the deployed bytecode and constructor values from chain after all flows. `nextDemandId` is 4, `totalEscrowed` is 0, and the 13,440-byte contract runtime remains present.

## Funded contract flows

### Demand #2: payout and non-approver refund

Every transaction below has a successful receipt.

| Step | Block | Transaction |
| --- | ---: | --- |
| Create demand | 41370435 | `0x6c7c350dfb00aa9b8d5a1af2ce26f0ab3616f4277baaf70c11e03dfea158d12e` |
| Second wallet supports | 41370504 | `0x6f8a9e2092db1bf9b7a062872783d9fdf6aeafff819d2e1355011700bb5fbb70` |
| Builder submits | 41370562 | `0xe6267737d9a720eaff2f2c733620de8aad8b086343044db307427c5360efdd43` |
| Creator approves | 41370676 | `0xefb1648d8d632725bccc9ab43bbb848f7ec774894c33fc407061431f00150773` |
| Finalize | 41370679 | `0x05170f11c5534c4e86f41e74d6c4378ddecac85f8a61401c1b5f16b9d44bc05e` |
| Non-approver refund | 41370683 | `0x2f878392e5987d5ff554a8c1fce0979154f8a64e374218b82612af1e6557ddef` |

Readback showed the demand fulfilled, the builder received 0.0147 USD₮0, the treasury received 0.0003 USD₮0, and the non-approving supporter recovered 0.01 USD₮0. This is a separate successful refund transaction.

### Demand #3: real browser E2E on the deployed contract

The local browser used a localhost-only EIP-1193 test provider. Signing stayed in a WSL process, and the provider allowlist enforced chain 1952, the three test wallets, contract/token targets, and approvals capped at 0.01 USD₮0.

| Step | Receipt block | Transaction |
| --- | ---: | --- |
| Creator approves exact 0.01 allowance | 41371809 | `0x68f49d310bc0d916b0294629db27e8968b71b006e0a152b75649bdbecf9e3d1c` |
| Create demand | 41371810 | `0x0fdc7074a6c62853a4fba3ba5c3dee3b26ecf7907194f2a26d698afc58507f77` |
| Supporter approves exact 0.01 allowance | 41371891 | `0xe24fd20eb9cff3bfdb4bdfe1c579cf05401e598e5171fa81b2171f6b041fde3c` |
| Second wallet supports | 41371892 | `0x34551bab981984609beed3a351341a8b001bc2ef08468841290cc082af440070` |
| Builder submits service | 41372065 | `0xbb49e2c0334f1807e4ec88b82dfd3aaf4d73cf1e18a3ddd4af33af84a1355e74` |
| Second wallet approves | 41372227 | `0x88ee2cccabe67130ca385648385b6d93fdb71273b0ba97e904d1f93f740f0309` |
| Creator approves | 41372285 | `0xe2ad6590f39af5a91fedf631c7a8d1495764e5cbf728964d24c44b53b9be5c96` |
| Finalize in browser | 41372377 | `0x8fa5b789c5e4aebcb688cafc9d42f210c03f5ad75cbb56c6436b2348ab476663` |

Final on-chain readback for demand #3: `FULFILLED`; two supporters; `reviewCommitted=20,000`; approval weight 20,000 against a 12,000 threshold; quorum true; committed escrow zero. The builder address is `0xe83daba4A2601482a190e53dA08105f1d53CF1fB`. The browser reloaded and displayed the fulfilled demand; the browser error log was empty.

Browser E2E ran against the live testnet contract at `http://127.0.0.1:5173` using the local test signer bridge. This is a local validation URL, not a public frontend deployment. The on-chain service URL was the fixture `https://example.com/unmet-browser-e2e`.

USD₮0 balance deltas across finalize (6 decimals):

| Account | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Builder | 14,700 | 34,300 | +19,600 (0.0196) |
| Treasury/creator | 9,955,300 | 9,955,700 | +400 (0.0004) |
| Supporter | 0 | 0 | 0 |
| Contract escrow | 30,000 | 10,000 | −20,000 (0.02) |

The 2% fee and builder payout match the contract readback and token balances. These token deltas exclude OKB gas.

### Demand #1: expiry refund fixture

Demand #1 was created with 0.01 USD₮0 and refunded from the browser after its deadline (`1789833004`). The browser displayed `refund success`; a fresh page readback displayed `CLOSED`, 0 escrow, 0 creator commitment, and no refund action.

| Evidence | Verified value |
| --- | --- |
| Refund transaction | `0xd70d104b2b3248b676e030356414301fe1686c9e8b3eff58df4d8513344bc244` |
| Receipt | Success (`0x1`), block `41374315` |
| Emitted events | `DemandClosed(1)` and `Refunded(1, creator, 10000)` |
| `isRefundable(1, creator)` after refund | `false` |
| `commitmentOf(1, creator)` after refund | `0` |
| `totalEscrowed` / contract USD₮0 balance | `0` / `0` |

USD₮0 balance delta for the expiry refund (6 decimals): creator increased from 9,955,700 to 9,965,700 units (+10,000 = 0.01 USD₮0); contract escrow decreased from 10,000 to 0 units (−10,000 = 0.01 USD₮0).

## Local checks

| Command | Result |
| --- | --- |
| `bun run check` | Passed: backend and frontend typechecks, 6 backend tests (14 assertions), 19 Foundry tests, frontend production build |
| `forge fmt --check` | Passed |
| `forge build` | Passed; two test-analysis warnings about `block.timestamp` reads around `vm.warp` |
| `forge test -vvv` | Passed: 19 tests, 0 failures |

The Vite build reports the main JavaScript chunk at 523.40 KiB, above its 500 KiB warning threshold. No check failed.

## OKX x402 verification and Mock Merchant diagnosis

The current [OKX buyer testnet guide](https://web3.okx.com/onchainos/dev-docs/payments/payment-use-buyer) specifies `eip155:1952`, USD₮0 at `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount 10,000, and recipient `0x3509655ad99effc7f3f74205482b1cb337ca08f7`. The [seller SDK guide](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk) distinguishes mainnet `196` from testnet `1952`.

Fresh GET requests to both official Mock Merchant hosts returned HTTP 402 for chain 1952 and the documented recipient/amount, but the live challenge uses `USDC_TEST` at `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` and offers both `exact` and `aggr_deferred`. On-chain token metadata reports `name/symbol=USDC_TEST`, 6 decimals, and EIP-712 `version()=2`; the challenge supplies `extra.version=1`. The official facilitator returns `invalid_signature` for the challenge version and `isValid=true` with the on-chain version. A corrected-domain SDK replay still received HTTP 402. Full raw responses, hashes, package/source comparison, transaction evidence, and commands are in [docs/OKX_PAYMENT_DEBUG.md](OKX_PAYMENT_DEBUG.md).

The official OnchainOS CLI 4.6.2 `payment quote` parsed the live challenge and reported 0.01 USDC_TEST on X Layer Testnet; its wallet status was `login_required`. The builder has 0 USDC_TEST, but the existing dedicated deployer/payer has 10.0 USDC_TEST and 0.197903606555180328 OKB, so no faucet request was needed. The official buyer/faucet documentation describes test USD₮0; the source of this already-present USDC_TEST balance is not established. The raw Mock 402 body also uses legacy `maxAmountRequired` and per-accept `resource` fields while claiming x402 v2; the official CLI quote accepts it, but the strict TypeScript v2 schema does not parse it without normalization.

One authorized 0.01 USDC_TEST settlement through the official facilitator succeeded on chain after using the token's EIP-712 version `2`. The first API response said `timeout` and a follow-up status was `pending`; later status became `success`. Receipt and block-anchored token readback prove the transfer. Before and after that settlement, the Mock seller replay returned HTTP 402 with no `PAYMENT-RESPONSE`; replay of the already-used paid proof also remained 402 and made no second transfer. This isolates the remaining failure to Mock Merchant seller delivery, not token support or facilitator settlement. Exact evidence is in [docs/OKX_PAYMENT_DEBUG.md](OKX_PAYMENT_DEBUG.md).

| Mock/facilitator evidence | Verified value |
| --- | --- |
| Testnet chain | `1952` (`eip155:1952`) |
| Corrected-domain facilitator verify | `isValid=true` for USDC_TEST v2, amount 10,000, Mock recipient |
| Mock replay before settlement | HTTP 402; no `PAYMENT-RESPONSE`; no transfer |
| Official facilitator settlement | `0x780b5e8b4637c931cd7a7c95fc2b96a736cd2ab66dd74ffd020d5ea7f81a2914` |
| Receipt | Success (`0x1`), block `41386624` |
| USDC_TEST deltas | Payer `−10,000`; Mock recipient `+10,000` raw (0.01 token) |
| Later official settlement status | `success` |
| Replay of already-settled proof | HTTP 402; zero new transfers; zero additional balance delta |

UNMET configuration is correct. A fresh local server run on `127.0.0.1:8787` returned healthy chain 1952 state and an unpaid `POST /v1/opportunities` HTTP 402 challenge for exact USD₮0, 10,000 units, and the configured treasury. The local server was stopped and port 8787 was confirmed closed.

The UNMET seller route previously completed a real 402 → payment → replay → 200 flow using the official `@okxweb3/x402-core` and `@okxweb3/x402-evm` client. `x402HTTPClient` emitted the standard base64 `PAYMENT-SIGNATURE`; the same POST replay returned HTTP 200 with `PAYMENT-RESPONSE` settlement status `success`. The challenge was exact, `eip155:1952`, USD₮0, 10,000 units (0.01), and the configured test treasury.

| Evidence | Verified value |
| --- | --- |
| Unpaid `POST /v1/opportunities` | HTTP 402, x402 v2 |
| Payer | Builder test wallet `0xe83daba4A2601482a190e53DA08105f1d53CF1fB` |
| Replay header | `PAYMENT-SIGNATURE`, emitted by official OKX SDK |
| Paid replay | HTTP 200; 0 opportunities in the returned result |
| Facilitator response | `PAYMENT-RESPONSE` status `success`, network `eip155:1952` |
| USD₮0 transaction | `0x0cefbdfbc8bade0442629fe3ba0531babb7ca10b441baef985cff8c323b079a9` |
| Receipt | Success (`0x1`), block `41376569` |
| Token events | `AuthorizationUsed` and `Transfer` of 10,000 units from payer to treasury |

Balance delta for the x402 payment (6 decimals): payer/builder decreased from 34,300 to 24,300 units (−0.01 USD₮0); treasury/creator increased from 9,965,700 to 9,975,700 units (+0.01 USD₮0). This tx hash was located from the matching token logs because the facilitator response did not expose a tx-hash field.

The three seller credentials supplied for this run are in ignored `.env` with mode `600`; values are not recorded here. The seller SDK initialized. Network calls used a temporary user-namespace resolver override (`1.1.1.1`, `8.8.8.8`) without changing host DNS configuration.

## Fresh validation on 2026-09-20

| Command / check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; no lockfile or package changes |
| `bun run check` | Passed: backend/frontend typecheck, 6 backend tests (14 assertions), 19 Foundry tests, frontend production build |
| `forge fmt --check` | Passed |
| `forge build` | Passed; two existing `block.timestamp` / `vm.warp` analysis warnings |
| `forge test -vvv` | Passed: 19 tests, 0 failures |
| `bun --env-file=../.env run admin.ts inspect` | Passed; chain 1952, contract bytecode present, constructor/config and accounting read back |
| Local unpaid seller request | Passed: health 200; `POST /v1/opportunities` 402 with `PAYMENT-REQUIRED` for USD₮0; server exited and port 8787 closed |
| `bun run typecheck` after adding payment debug harness | Passed |
| Official Mock replay / facilitator diagnostic | Facilitator verify and 0.01 USDC_TEST settlement passed with on-chain receipt/readback; Mock unpaid and paid replay both returned 402 |

The current pass did not repeat the browser transaction E2E recorded above. No `agent-browser`, Chromium, or Playwright binary is installed in this WSL checkout; Codex's remote Node REPL also rejected this workspace URI. No new browser result is claimed. Added `backend/payment-debug.ts` as a bounded, secret-redacting official-SDK reproduction and paid-proof replay harness; its updated version passed backend typecheck. The production build still warns that the main JS chunk is 523.40 KiB (over 500 KiB).

## Local changes and remaining work

- `backend/admin.ts` now preflights the configured chain before deployment, serializes the BigInt deployment config safely, and retries deployment readback after a successful receipt.
- `backend/server.ts` now honors an optional `HOST` environment variable; the default bind behavior remains unchanged. This allowed the temporary seller test server to bind to loopback.
- `backend/payment-debug.ts` normalizes the Mock's legacy-shaped x402 v2 body, checks live token/chain/wallet limits, uses the official SDK for signing and header encoding, optionally settles only under an explicit `--settle-facilitator` flag, and can replay an already-used on-chain authorization without another signature. Its balance verification is block-anchored and it polls delayed broker status.
- Local ignored `.env` contains testnet addresses/config, seller credentials, and signer keys; secret values are not recorded here.
- Root contains no Git metadata, so there is no repository diff or commit history to report.
- Do not pay the Mock again while it returns `extra.version=1` for this token. OKX needs to fix the Mock challenge and make the seller accept the official SDK proof; the deployed testnet token and facilitator settlement both worked with version `2`. Do not switch to chain 196.
- Replace the supporter test key that appeared in diagnostic output before using that signer again.
