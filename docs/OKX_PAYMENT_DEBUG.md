# OKX Mock Merchant payment debug

Captured: **2026-09-20 01:58:36 Asia/Jakarta** (`Date: Sat, 19 Sep 2026 18:58:36 GMT`)

Network under test: **X Layer Testnet, CAIP-2 `eip155:1952`**. No request or transaction used mainnet `196`.

## Raw Mock Merchant response

Exact unauthenticated request used for each host:

```sh
curl --silent --show-error --max-time 20 --dump-header - --output - https://www.okx.com/api/v1/pay/mock-merchant/resource
curl --silent --show-error --max-time 20 --dump-header - --output - https://web3.okx.com/api/v1/pay/mock-merchant/resource
```

The commands ran in WSL with a temporary user/mount namespace resolver override (`1.1.1.1`, `8.8.8.8`); host DNS was not changed. These were GETs with no auth, payment, or cookie request headers.

### `https://www.okx.com/api/v1/pay/mock-merchant/resource`

```http
HTTP/2 402
date: Sat, 19 Sep 2026 18:58:36 GMT
content-type: application/json;charset=UTF-8
content-length: 706
b-locale: en_US
content-security-policy: frame-ancestors 'self'
x-brokerid: 0
cf-cache-status: DYNAMIC
set-cookie: [redacted ephemeral response cookie]
server: cloudflare
cf-ray: a3dad2a2bfa2b593-CGK
```

Raw response body (706 bytes; SHA-256 `3a9a4d7af722b38fe958814454ee2e81e6c1a2f42486d78a72614540c0a34aca`):

```json
{"x402Version":2,"accepts":[{"scheme":"exact","network":"eip155:1952","maxAmountRequired":"10000","asset":"0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d","payTo":"0x3509655ad99effc7f3f74205482b1cb337ca08f7","resource":"/api/v1/pay/mock-merchant/resource","mimeType":"application/json","maxTimeoutSeconds":60,"extra":{"name":"USDC_TEST","version":"1"}},{"scheme":"aggr_deferred","network":"eip155:1952","maxAmountRequired":"10000","asset":"0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d","payTo":"0x3509655ad99effc7f3f74205482b1cb337ca08f7","resource":"/api/v1/pay/mock-merchant/resource","mimeType":"application/json","maxTimeoutSeconds":60,"extra":{"name":"USDC_TEST","version":"1"}}],"error":"Payment Required"}
```

### `https://web3.okx.com/api/v1/pay/mock-merchant/resource`

```http
HTTP/2 402
date: Sat, 19 Sep 2026 18:58:36 GMT
content-type: application/json;charset=UTF-8
content-length: 706
set-cookie: [redacted ephemeral response cookie]
b-locale: en_US
content-security-policy: frame-ancestors 'self'
x-brokerid: 0
cf-cache-status: DYNAMIC
server: cloudflare
cf-ray: a3dad2a37f71db42-CGK
```

Raw response body (706 bytes; SHA-256 `9bb1d309efb5573695c2013c9f263e74356d89ae7aa0f2d04aa0a8109f67c676`):

```json
{"x402Version":2,"accepts":[{"scheme":"exact","network":"eip155:1952","maxAmountRequired":"10000","asset":"0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d","payTo":"0x3509655ad99effc7f3f74205482b1cb337ca08f7","resource":"/api/v1/pay/mock-merchant/resource","mimeType":"application/json","maxTimeoutSeconds":60,"extra":{"version":"1","name":"USDC_TEST"}},{"scheme":"aggr_deferred","network":"eip155:1952","maxAmountRequired":"10000","asset":"0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d","payTo":"0x3509655ad99effc7f3f74205482b1cb337ca08f7","resource":"/api/v1/pay/mock-merchant/resource","mimeType":"application/json","maxTimeoutSeconds":60,"extra":{"version":"1","name":"USDC_TEST"}}],"error":"Payment Required"}
```

The two official hosts return the same challenge values. JSON object-key order differs. Neither response contains a facilitator URL; both include `x-brokerid: 0`.

## Challenge fields

| Field | Live response |
| --- | --- |
| HTTP status / x402 version | `402` / `2` |
| Network | `eip155:1952` |
| Schemes | `exact`, `aggr_deferred` |
| Amount | `maxAmountRequired: "10000"` (0.01 at 6 decimals) |
| Asset | `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` |
| Asset `extra` | `name: USDC_TEST`, `version: 1` |
| `payTo` | `0x3509655ad99effc7f3f74205482b1cb337ca08f7` |
| Resource / MIME type | `/api/v1/pay/mock-merchant/resource` / `application/json` |
| Timeout | 60 seconds |
| Facilitator in challenge | None |
| Broker response header | `x-brokerid: 0` |

## On-chain token inspection

Read-only JSON-RPC calls went to `https://testrpc.xlayer.tech/terigon`; `eth_chainId` returned `1952`.

| Check | Result |
| --- | --- |
| Token bytecode | Present, 1,798 bytes |
| Runtime bytecode hash | `0xc2059a483ceeca165dfcc9727922e7c8c7b99710e84eca06cf765c235b133893` |
| `name()` / `symbol()` | `USDC_TEST` / `USDC_TEST` |
| `decimals()` | `6` |
| EIP-712 `version()` | **`2`** |
| Builder test wallet balance | `0` raw / `0` USDC_TEST |
| Dedicated deployer/payer balance | `10,000,000` raw / `10.000000` USDC_TEST |
| Dedicated payer native balance before test | `0.197903606555180328` OKB |
| Mock merchant recipient balance before test | `1,100,000` raw / `1.100000` USDC_TEST |
| E2E supporter balance | `0` raw / `0` USDC_TEST |
| EIP-3009 call probe | The token dispatches the `transferWithAuthorization` selector; a read-only call reverted with `FiatTokenV2: authorization is expired.` No transaction was sent. |

The current [OKX buyer testnet guide](https://web3.okx.com/onchainos/dev-docs/payments/payment-use-buyer) describes USD₮0 (`0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`) for this Mock Merchant flow. The [seller guide](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk) also lists test USD₮0 from the X Layer faucet. The live Mock response instead names `USDC_TEST`. The official faucet page is [here](https://web3.okx.com/xlayer/faucet); its published guide does not identify a faucet source for this specific `USDC_TEST` address. The builder balance is zero, but the dedicated deployer wallet had 10.0 USDC_TEST; the later bounded settlement using that wallet is documented below. The source of the existing test balance is unknown.

## SDK, skill, and facilitator comparison

### Installed UNMET packages

| Package | Installed version |
| --- | ---: |
| `@okxweb3/x402-core` | `0.1.0` |
| `@okxweb3/x402-evm` | `0.2.1` |
| `@okxweb3/x402-express` | `0.1.1` |
| `viem` | `2.56.7` |
| OnchainOS CLI | `4.6.2` |

The current official [`okx/payments` TypeScript source](https://github.com/okx/payments/tree/master/typescript/bu-payments) contains `@okxweb3/app-x402-core@0.2.2`, `@okxweb3/app-x402-evm@0.2.2`, and `@okxweb3/app-x402-express@0.2.0`. The current seller documentation's Node example still names the installed `@okxweb3/x402-*` family. Both the installed signer and current official `app-x402-evm` source construct EIP-3009 from the selected requirement's `amount`, `asset`, `payTo`, `network`, and `extra.name` / `extra.version`; neither hardcodes USD₮0 for a returned challenge.

The official current [`okx-agent-payments-protocol` skill](https://github.com/okx/onchainos-skills/blob/main/skills/okx-agent-payments-protocol/SKILL.md) routes accepts-based requests through `onchainos payment quote`. Running `onchainos payment quote https://www.okx.com/api/v1/pay/mock-merchant/resource` with isolated temporary XDG state succeeded and reported `0.01 USDC_TEST` on X Layer Testnet. It returned `walletError: login_required` and both candidate balances as unavailable; no signing or payment occurred. The official CLI therefore parses this live body even though the strict TypeScript SDK schema does not parse it directly.

Current official TypeScript x402 v2 schema requires top-level `resource: {url, mimeType?}` and per-accept `amount`. The live response instead has no top-level resource, uses per-accept `resource` / `mimeType`, and uses `maxAmountRequired` while claiming `x402Version: 2`. The installed schema check reproduced three issues: top-level `resource` missing and `accepts[0/1].amount` missing. Normalizing those fields into the official v2 shape passed schema validation. This is a secondary wire-shape inconsistency; the official CLI quote compatibility path handled it.

The official `OKXFacilitatorClient` source uses:

- `GET https://web3.okx.com/api/v6/pay/x402/supported`
- `POST https://web3.okx.com/api/v6/pay/x402/verify`
- `POST https://web3.okx.com/api/v6/pay/x402/settle`

The authenticated `/supported` call returned x402 v2 `exact`, `aggr_deferred`, and `upto` kinds for `eip155:1952`; the response does not enumerate token addresses. A later bounded 0.01 USDC_TEST diagnostic settlement via the official `/settle` method is recorded below.

## Reproduction and result

The initial unpaid seller request was:

```http
GET /api/v1/pay/mock-merchant/resource HTTP/2
Host: www.okx.com
```

The same unauthenticated GET to `web3.okx.com` returned the same terms. A later buyer replay used the SDK-generated `PAYMENT-SIGNATURE` header; the command, response, and evidence are recorded below.

The first verifier probes used the builder signer, whose USDC_TEST balance is zero. The follow-up used the funded deployer signer with the key read only in process memory. No key, signature, nonce, or authorization was logged or saved.

| Signed EIP-712 domain | Facilitator `/verify` |
| --- | --- |
| Challenge `name=USDC_TEST`, `version=1` | `isValid=false`, `invalidReason=invalid_signature`, `invalidMessage=Signature verification failed` |
| On-chain `name=USDC_TEST`, `version=2` | `isValid=true` for the same token, network, amount, and `payTo` |

The on-chain version was used for a corrected-domain verifier probe and official Mock replay. The replay still returned HTTP 402. The subsequent facilitator settlement and receipt are documented below.

## Expected response and root cause

The current official buyer guide describes `exact`, X Layer Testnet `eip155:1952`, USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount `10000`, recipient `0x3509655ad99effc7f3f74205482b1cb337ca08f7`, and timeout 60. The live response differs in asset and also gives a bad EIP-712 version for its actual token.

**Confirmed root cause:** the live Mock Merchant's EIP-712 `extra.version` is `1`, but the returned token reports `version() == "2"`. The exact SDK follows the server's `extra.version`, so the signer produces the wrong EIP-712 domain and OKX's facilitator rejects it as `invalid_signature`. Signing with the on-chain version verifies successfully and the official facilitator settles exactly 10,000 units on chain. This is a Mock Merchant challenge metadata defect, not a hardcoded UNMET token or a local signer-format defect.

The token mismatch is a separate documentation/API inconsistency: published testnet docs say USD₮0, while both live official Mock hosts return `USDC_TEST`. The official facilitator verified and settled an EIP-3009 signature for this `USDC_TEST` contract when its domain version was correct, so this exact test asset works through the broker. The deployer wallet already held 10 USDC_TEST; its source was not determined in this run. There is no evidence that the public faucet supplies this specific address.

The seller-side rejection reason remains opaque: both the corrected pre-settlement proof and the already-settled proof replay received the same generic HTTP 402 body, with no `PAYMENT-RESPONSE`. The first proof was independently verified valid by the facilitator; the second proof's authorization is marked used on chain. The response does not distinguish challenge-version mismatch from another Mock Merchant replay check. This proves the published Mock flow is incompatible as served, while keeping the exact internal seller rejection mechanism a hypothesis.

UNMET configuration was not the cause. The live UNMET seller returned HTTP 200 health on chain 1952 and a standard unpaid `POST /v1/opportunities` HTTP 402 challenge for exact USD₮0, amount `10000`, and its configured treasury. A separate prior UNMET seller test already has successful USD₮0 settlement evidence in `docs/STATUS.md`.

## Experiments attempted

1. Fetched both Mock Merchant hosts twice; response stayed HTTP 402 with the same token, amount, recipient, schemes, and bad version.
2. Read chain ID, token bytecode/hash, name, symbol, decimals, EIP-712 version, and builder token balance from X Layer Testnet.
3. Probed the token's EIP-3009 method using `eth_call` only.
4. Ran official OnchainOS CLI `payment quote`; it parsed and named `USDC_TEST`, but wallet login was unavailable and no payment ran.
5. Compared strict installed/current official x402 v2 schema with the live body; raw body failed schema validation, canonical v2 form passed.
6. Queried authenticated official facilitator `/supported`, then `/verify` with challenge version 1 and on-chain version 2. Challenge version failed; on-chain version passed.
7. Started UNMET locally on `127.0.0.1:8787`, confirmed healthy chain 1952 and an unpaid 402 with USD₮0, then stopped the process and confirmed the port closed.
8. Used the funded deployer signer through the official x402 SDK. The challenge-faithful signature again failed `/verify` as `invalid_signature`; the on-chain-version signature verified `isValid=true`.
9. Replayed the corrected, facilitator-valid proof to the official Mock Merchant using `x402HTTPClient.encodePaymentSignatureHeader`. It returned HTTP 402 with the same challenge fields, no `PAYMENT-RESPONSE`, no tx hash, and no token balance change.
10. Called official `OKXFacilitatorClient.settle` once for 10,000 USDC_TEST units. The response initially said `status=timeout` while returning a tx hash. The tx receipt succeeded, emitted `AuthorizationUsed` and `Transfer`, and a later `/settle/status` poll returned `success`.
11. Reconstructed the already-settled EIP-3009 proof from public transaction calldata in memory and encoded it with the official SDK. Replaying that already-used authorization to Mock Merchant still returned HTTP 402; there was no new matching transfer or balance change.

## Funded testnet settlement and paid-proof replay

Follow-up captured 2026-09-20 02:23 Asia/Jakarta. The operation remained on X Layer Testnet `eip155:1952`. The deployer/payer `0x237481F7Fd0A6F87f548FB3030015a82784e8978` already had `10,000,000` raw USDC_TEST (10.0 tokens) and `0.197903606555180328` OKB. No faucet request or token transfer was used to fund it.

The reproducible one-time command was run from `backend/`; the resolver override existed only in the user/mount namespace and did not change WSL host DNS:

```sh
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions timeout:2 attempts:1\n' > /tmp/unmet-resolv.conf
unshare --user --map-root-user --mount bash -c 'mount --bind /tmp/unmet-resolv.conf /etc/resolv.conf && timeout 180s bun --env-file=../.env run payment-debug.ts --settle-facilitator'
```

The script first fetched the real challenge and checked network, recipient, token bytecode, token metadata, available balance, and OKB gas. It signed the challenge terms with the installed official SDK, confirmed `/verify` rejected version `1`, then confirmed `/verify` accepted the same token/amount/recipient with the on-chain domain version `2`. It submitted one corrected-domain `PAYMENT-SIGNATURE` replay to the Mock Merchant; that response remained HTTP 402, so the script submitted exactly one 10,000-unit settlement through the official facilitator. It refuses that settlement if the replay reveals a transaction or either balance has changed.

The real seller replay response was:

| Field | Result |
| --- | --- |
| Request | `GET https://www.okx.com/api/v1/pay/mock-merchant/resource`, SDK-generated `PAYMENT-SIGNATURE` (encoded value omitted; 1,028 characters) |
| HTTP status | `402` |
| `date` / `x-brokerid` | `Sat, 19 Sep 2026 19:17:39 GMT` / `0` |
| `content-length` / `cf-ray` | `706` / `a3daee8a68388a9a-CGK` |
| `PAYMENT-RESPONSE` | Absent |
| Body | Same 402 challenge terms recorded above: `USDC_TEST`, 10,000, `eip155:1952`, recipient `0x3509655ad99effc7f3f74205482b1cb337ca08f7`, `extra.version=1` |
| Tx hash in response / new transfer | None / none |
| Payer / recipient delta | `0` / `0` raw |

The independent official facilitator settlement call produced this response and on-chain evidence:

| Field | Result |
| --- | --- |
| Initial settlement API `success` / `status` | `true` / `timeout` (transient; not treated as completion) |
| Settlement transaction | `0x780b5e8b4637c931cd7a7c95fc2b96a736cd2ab66dd74ffd020d5ea7f81a2914` |
| Receipt | Success (`0x1`), X Layer Testnet block `41386624` |
| Receipt logs | `AuthorizationUsed`; `Transfer(payer, payTo, 10000)` |
| Readback before at block `41386620` | payer `10,000,000`; payTo `1,100,000` raw |
| Readback at receipt block `41386624` | payer `9,990,000`; payTo `1,110,000` raw |
| Balance deltas | payer `−10,000` (−0.01); merchant `+10,000` (+0.01) USDC_TEST |
| Authorization state | Used (`true`) |
| Later official `/settle/status` | `success` for the same hash |

The first immediate post-receipt `balanceOf` call was served from a stale RPC view and showed zero delta, despite the successful receipt. A block-anchored read at blocks `41386620` and `41386624` and a later latest-state read both confirmed the 10,000-unit transfer. The debug harness now reads balances at the receipt block and polls broker status for up to 30 seconds. No payment was repeated to resolve this read lag.

The already-settled authorization was then replayed once to the same Mock URL using the SDK encoder and the original on-chain EIP-3009 signature, reconstructed in memory from the public transaction calldata. The chain reported `authorizationState=true` before replay. At `Sat, 19 Sep 2026 19:23:21 GMT`, the Mock again returned HTTP 402 with `x-brokerid: 0`, no `PAYMENT-RESPONSE`, and the same challenge terms (`cf-ray: a3daf6e3df62ca88-CGK`). There were zero new matching transfer logs and both balance deltas were zero. The signature and authorization were not printed or saved.

This settles the token/facilitator question: the exact USDC_TEST asset and official facilitator work on testnet when signed with the on-chain EIP-712 version. The Mock Merchant remains incompatible at its HTTP seller boundary: it advertises version `1` for a version-`2` token, rejects the SDK-valid corrected replay with another 402, and also rejects the replay of the already-paid authorization. This is separate from UNMET's own previously successful USD₮0 paid flow.

## Next experiment

There is now a reproducible external failure proof, so do not pay this Mock again while it still returns the same challenge. The next payment-dependent check is to rerun the **read-only GET and `/verify` probes** after OKX changes the Mock challenge to `extra.version=2` and makes its seller accept the official SDK `PAYMENT-SIGNATURE` replay. Only after that unpaid proof passes should another paid test be considered. Do not use mainnet or substitute USD₮0 for the Mock's different asset.

No secrets, cookies, signed payloads, or private-key values are stored in this report.
