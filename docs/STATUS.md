# Verification Status

Date: 2026-09-24

Status: **PARTIAL — THE DEMAND MARKET REMAINS ON X LAYER TESTNET; THE A2MCP x402 RAIL ADVERTISES X LAYER MAINNET. An unpaid Mainnet challenge was rechecked on 2026-09-24; paid-Mainnet replay and settlement remain unverified. The latest recorded OKX.AI listing/review status is from 2026-09-23. Wallet-provider E2E and an independent contract audit remain outstanding.**

## Read-only public recheck (2026-09-24)

These checks were made while updating the documentation. No wallet transaction or paid x402 replay was sent.

| Check | Result |
| --- | --- |
| Frontend | [https://frontend-omega-beige-33.vercel.app](https://frontend-omega-beige-33.vercel.app) returned HTTP 200 |
| Deployed frontend asset | Loaded JavaScript includes the Overview / Fund / Build & Review tab labels and current create, escrow, and reopen action labels. |
| `GET /health` | HTTP 200; chain `1952`, contract `0x7c51457235cFFBae862493D788137BFf1EF07e2E` |
| `GET /v1/demands` | HTTP 200; chain `1952`, same contract; sampled at `2026-09-24T03:41:05Z`, block `41762426`; 4 demand records |
| Unpaid `POST /v1/opportunities` | HTTP 402; x402 v2, `exact`, `eip155:196`, mainnet USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `10000`, payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978` |
| Paid Mainnet replay | Not performed in this check. No paid-Mainnet replay evidence is recorded in this repository; the challenge check alone does not establish settlement. |
| Frontend-origin CORS | Requests with origin `https://frontend-omega-beige-33.vercel.app` returned no `Access-Control-Allow-Origin` header for `/health`, `/v1/demands`, or the `/v1/demands` preflight. Browser cross-origin access from the deployed frontend is therefore not verified. |
| OKX.AI listing/review | Latest repository evidence is the 2026-09-23 check below: ASP `13853` / Service `40842` was unlisted and review had not been submitted. No newer approval evidence was found for this update. |

## Production network split deployment (2026-09-23)

The core market remains on X Layer Testnet (`CHAIN_ID=1952`): AgentDemand reads/indexing, frontend writes, escrow token, and demand health/readback. Only `POST /v1/opportunities` uses `X402_CHAIN_ID=196` for A2MCP billing. Production explicitly sets `X402_CHAIN_ID=196`; `CHAIN_ID`, `XLAYER_RPC_URL`, `DEMAND_CONTRACT`, `DEMAND_DEPLOY_BLOCK`, and `PAYMENT_TOKEN` were not changed. The official OKX exact-scheme SDK selects the mainnet token by network; application code does not hardcode a billing-token override.

The local deployer signer was checked offline: its derived address matches payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978`. No private key was displayed, written to Vercel, or used to sign a transaction.

Backend-only Vercel deployment:

| Item | Result |
| --- | --- |
| Project / runtime | `backend`, Express on Vercel Node.js 24 |
| Deployment | `dpl_HWDy1bPJXN11e1yKMK2RpXScG35n`, READY, Production |
| Production endpoint | [https://unmet-api.vercel.app](https://unmet-api.vercel.app) |
| Source | branch `feat/unmet-x402-network`, commit `ef0c249f7381bc35a0ef2fe3e467948484ebd8b0`, pushed as the first commit of [PR #2](https://github.com/riyannode/UNMET/pull/2) |
| `GET /health` | HTTP 200; chain `1952`, contract `0x7c51457235cFFBae862493D788137BFf1EF07e2E` |
| `GET /v1/demands` | HTTP 200; chain `1952`, same contract, 3 live demands; latest sampled block `41717352` |
| Unpaid `POST /v1/opportunities` | HTTP 402; x402 v2, `exact`, `eip155:196`, mainnet USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `10000`, payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978` |
| Mainnet readback | RPC chain ID `196`; fee-token bytecode present, symbol `USD₮0`, decimals `6`; payTo is an EOA and its address matches the locally derived deployer signer |
| Repeated checks | Three rounds returned the same health, demand, and challenge results |
| Vercel runtime errors | No error records in the last 30 minutes for the new deployment; no `block range greater than 100 max` match |
| Payment / chain transaction | None in this migration; paid mainnet x402 was not tested |
| ASP / service | ASP `13853`, Service `40842`; not listed, review not submitted |

The first CLI upload from `backend/` failed because the Vercel project root is the repository's `backend/` directory; deploying from the repository root fixed the source layout. The pre-existing `unmet-api.vercel.app` alias was still pointed at the old Testnet-payment deployment, so it was retargeted to the new backend production deployment and then verified at the public alias. The failed upload did not change the production alias.

## Production incident: demand indexing RPC range (2026-09-20)

The live `GET https://unmet-api.vercel.app/v1/demands` regression was independently reported as HTTP 503. Vercel logs identified `eth_getLogs` failing with `block range greater than 100 max`. The backend issued one log request spanning `lastIndexedBlock + 1` through the current head; X Layer Testnet RPC permits at most 100 inclusive blocks per request.

The backend fix chunks that inclusive range into windows of at most 100 blocks, merges decoded demand IDs across windows, and leaves the checkpoint and reorg-triggered rebuild rules intact. Regression coverage exercises a 100-block request, multi-window requests and merged IDs, empty ranges, a simulated 151-block index lag, and a changed indexed-block hash that must rebuild rather than query logs. The first Vercel build from the fix commit was READY, and its unique deployment URL returned HTTP 200 for `/v1/demands`; however, the public alias still returned 503. Vercel runtime logs confirmed those alias requests were served by the old deployment (`dpl_DCoAMDD9oJKuzUNoTTnf2DzLYMEx`), while the first fixed deployment was `dpl_5cbb1R2XGHYX83MiMpXv2ebkvp5a`. The backend project had no repository declaration for `unmet-api.vercel.app`, so `backend/vercel.json` now declares the alias. The subsequent deployment `dpl_3Qvp7UE8jr1TqwcifFzj1yTeuSv7` is READY from commit `4c65b1bbebe16aef9d6a46a8cf2994cc57cb1dad`, lists `unmet-api.vercel.app` as an alias, and has `aliasError=null`.

Production recovery evidence on `https://unmet-api.vercel.app`:

| Check | Result |
| --- | --- |
| `GET /health` | HTTP 200; chain `1952`, existing contract `0x7c51457235cFFBae862493D788137BFf1EF07e2E`; initial latest block `41464810` |
| Baseline `GET /v1/demands` | HTTP 200; checkpoint `41464811`; 3 demands; Vercel log recorded `index_rebuilt` at this block |
| >100-block idle gap | `/health` reached block `41464928`, 117 blocks after the baseline checkpoint |
| `GET /v1/demands` after gap | Three consecutive HTTP 200 responses at blocks `41464938`, `41464942`, `41464945`, each with 3 demands; all ran on `dpl_3Qvp7UE8jr1TqwcifFzj1yTeuSv7`. Vercel logs show no `index_rebuilt` on those requests, consistent with the incremental refresh path. The exact chunk boundaries are covered by the backend regression tests. |
| Limit error in new deployment | No `block range greater than 100 max` matches and no `/v1/demands` runtime errors in the post-deploy log query |
| Unpaid `POST /v1/opportunities` | HTTP 402; x402 v2, `exact`, `eip155:1952`, USD₮0 asset `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount `10000`, payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978` |

No chain transaction or paid x402 request was performed while fixing or verifying this incident. Earlier contract and payment evidence below remains historical and was not repeated.

The API checks above record the current network split. The deployment and x402 checks below describe earlier releases; their `eip155:1952` payment challenges are historical and are not the active production billing configuration.

**At the 2026-09-23 network-split verification:** deployed X Layer Testnet contract configuration and funded flows had successful receipts and state readbacks; local browser E2E, public frontend/API smoke checks, and one public UNMET seller 402 → payment → replay → 200 flow passed. Local checks are recorded below.

**Unresolved at that check:** a paid mainnet x402 replay had not been performed; automated production wallet connection/write verification, OKX.AI listing/review, and an independent contract audit remained. Earlier paid Testnet replay evidence below does not verify mainnet settlement. This repository is not production-ready. See the dated read-only recheck above for the latest public endpoint state.

In the earlier contract/payment E2E run recorded below, all chain writes used X Layer Testnet (`eip155:1952`); mainnet (`196`) and real assets were not used. The current network-split migration made no chain writes or payments. Private keys remain in the ignored local `.env` and were not copied into the browser. One test supporter key was accidentally included in a diagnostic tool output; that signer was not used afterward and must be replaced before reuse. No key value is recorded here.

## Previous public Vercel deployment and smoke verification

Both projects are production deployments from repository `riyannode/UNMET`, branch `main`, deployment source SHA `de77198aef994feae84059e1ae7413852a99326e`.

| Project | URL | Deployment ID | Runtime/build |
| --- | --- | --- | --- |
| Frontend | [https://unmet-ai.vercel.app](https://unmet-ai.vercel.app) | `dpl_B6dHSuUcdB6V4EMUY2rELjB3N4qC` | Vite; `READY` |
| Backend | [https://unmet-api.vercel.app](https://unmet-api.vercel.app) | `dpl_DCoAMDD9oJKuzUNoTTnf2DzLYMEx` | Express, Node.js 24; `READY` |

The backend deployment is configured without `DEPLOYER_PRIVATE_KEY`.

| Public check | Result |
| --- | --- |
| `GET /health` | HTTP 200; `ok=true`, chain `1952`, contract `0x7c51457235cFFBae862493D788137BFf1EF07e2E`, block `41461618` |
| `GET /v1/demands` | HTTP 200; chain `1952`, same contract, block `41461619`, 3 live demand records |
| Unpaid `POST /v1/opportunities` | HTTP 402; x402 v2, scheme `exact`, network `eip155:1952`, USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount `10000`, payTo `0x237481F7Fd0A6F87f548FB3030015a82784e8978`, EIP-712 name/version `USD₮0` / `1` |
| CORS, frontend origin | `https://unmet-ai.vercel.app` is allowed |
| CORS, localhost and foreign origin | No `Access-Control-Allow-Origin` header for `http://localhost:5173` or `https://untrusted.example` |

The production browser loaded [https://unmet-ai.vercel.app](https://unmet-ai.vercel.app), rendered the live testnet demand board, showed chain `1952` and the configured contract/token, and reported no console errors or localhost requests. The headless browser had no `window.ethereum`/wallet provider; clicking Connect reported `WALLET_NOT_FOUND`. No public frontend transaction was submitted. The previously recorded browser E2E used the same application source against the same deployed contract; this release changed Vercel configuration and backend entrypoint only.

## Historical public production x402 payment on Testnet (before 2026-09-23 network split)

Under the previous production configuration, the public backend was checked with an unpaid request and then exactly one paid replay was sent using `@okxweb3/x402-core` and `@okxweb3/x402-evm`. This is historical Testnet evidence and does not verify the current Mainnet billing rail. The SDK produced `PAYMENT-SIGNATURE`; no custom payment header was constructed. The challenge was verified against the on-chain EIP-712 domain through `eip712Domain()` (name `USD₮0`, version `1`, chain ID `1952`, verifying contract equal to the token). The challenge amount was exactly 10,000 raw units (0.01 USD₮0).

| Evidence | Result |
| --- | --- |
| Paid production `POST /v1/opportunities` | HTTP 200; response body had `opportunities: []` |
| `PAYMENT-RESPONSE` | Present; status `success`, network `eip155:1952` |
| Payer | Builder test wallet `0xe83daba4A2601482a190e53dA08105f1d53CF1fB` |
| Treasury | `0x237481F7Fd0A6F87f548FB3030015a82784e8978` |
| Payment transaction | `0xb03a645fe2fecae7703a88e0ce6f8dd56ccad5b3bb432473d7bb0c4ede323bf2` |
| Receipt | Success (`0x1`), block `41462370`, X Layer Testnet chain `1952` |
| USD₮0 transfer | `10,000` raw units from payer to treasury |
| Payer balance | `24,300` → `14,300` raw units (`−0.01 USD₮0`) |
| Treasury balance | `9,975,700` → `9,985,700` raw units (`+0.01 USD₮0`) |

The receipt, transfer event and balances were read back at the receipt block. The direct local read-only facilitator `/verify` call failed with `ConnectionRefused` to `https://web3.okx.com` before any payment request was sent; the production Express middleware then verified and settled the single official SDK replay successfully. No retry or second payment was made.

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

## Local checks from the recorded testnet verification

| Command | Result |
| --- | --- |
| `bun run check` | Passed: backend and frontend typechecks, 6 backend tests (14 assertions), 19 Foundry tests, frontend production build |
| `forge fmt --check` | Passed |
| `forge build` | Passed; two test-analysis warnings about `block.timestamp` reads around `vm.warp` |
| `forge test -vvv` | Passed: 19 tests, 0 failures |

The Vite build reported the main JavaScript chunk at 523.40 KiB, above its 500 KiB warning threshold. No check failed.

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
| `bun install --frozen-lockfile` | Passed; 127 installs checked, no lockfile or package changes |
| `bun run check` | Passed after targeted fixes: backend/frontend typecheck, 8 backend tests (16 assertions), 19 Foundry tests, frontend production build |
| `forge fmt --check` | Passed |
| `forge build` | Passed; two existing `block.timestamp` / `vm.warp` test-analysis warnings |
| `forge test -vvv` | Passed: 19 tests, 0 failures |
| ABI comparison | Passed; all 32 backend and 14 frontend ABI fragments match the compiled contract artifact; no missing or mismatched fragment |
| Source audit | No TODO/FIXME/XXX markers or payment bypass in implementation; optional `PAY_TO_ADDRESS` is documented as a legacy alias for `OKX_PAY_TO` |

The backend now keeps `uint64` deadlines as `bigint` through status checks and ranking. ISO conversion returns `null` outside JavaScript's `Date` range, with out-of-range API deadlines sorted last; regression tests cover representable and `uint64`-maximum timestamps. The frontend compares deadlines as `bigint` and uses a safe display label outside the date range. The board and My Activity distinguish loading, RPC failure, and empty results; wallet position reads clear stale values and gate approval/refund actions until readback finishes. Mobile demand cards use one column at narrow widths.

The frontend production build reports a 525.04 KiB main JavaScript chunk, above Vite's 500 KiB warning threshold. The browser transaction E2E evidence remains the earlier verified testnet run above; this documentation/code cleanup did not submit transactions or repeat that browser flow.

## Repository and remaining work

- GitHub repository: [`riyannode/UNMET`](https://github.com/riyannode/UNMET), branch `main`.
- The deployment compatibility release is commit `de77198aef994feae84059e1ae7413852a99326e`. The final evidence-only documentation commit is reported with the completion result.
- The Vercel projects were built from the exact GitHub commit above; no contract deployment or contract code change was made during this public deployment task.
- The ignored local `.env` has mode `600`; no secret values are recorded here.
- The direct local read-only facilitator verification could not reach `https://web3.okx.com` from this WSL session. The official production middleware verified and settled the one public SDK replay successfully.
- Do not pay the Mock Merchant again while its USDC_TEST challenge still advertises `extra.version=1` for a token whose EIP-712 version is `2`. Its failure is separate from UNMET's successful public USD₮0 flow. Do not switch to chain 196.
- Replace the supporter test key that appeared in diagnostic output before using that signer again.
- Remaining before describing the project as production-ready: verify an injected wallet connection/write against the public frontend, publish the OKX.AI listing/integration, and obtain an independent contract audit. No open demand was available in the paid production response, so the endpoint returned an empty array.
