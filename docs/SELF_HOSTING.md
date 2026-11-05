# Self-hosting unmet

## Gate-0 validator and signer

The validation overlay also starts a discovery observer in the web network namespace. It has no signer socket, signer credentials, payment database or OKX credentials. The API and observer communicate through a dedicated Unix socket volume; only the observer accesses provider HTTPS targets using the Gate-0 transport. Recreate the observer together with web when replacing the shared network namespace. The observer requires `DISCOVERY_POLICY_FILE`, a read-only JSON file with `managementAddresses` and `deployments` using the validation deployment policy fields except `verifier`; it does not require signer paths. Review the policy and RPC endpoints before use.

The observer policy has the shape `{"managementAddresses":[],"deployments":[{"escrowChainId":"...","escrowContract":"...","escrowRpcUrl":"...","demandPriceAsset":{...},"paymentProfiles":[{...,"paymentRpcUrl":"..."}]}]}`. Populate it with reviewed policy values and RPC URLs; the ellipses are explanatory and are not valid JSON. Enabled profile assets are checked for chain, code and decimals on startup. The configured demand denomination must retain the historical meaning for that deployment.

The API owns `/data/discovery.sqlite` separately from `/data/payments.sqlite` on the existing persistent volume. Preserve both databases and their WAL/SHM files through restart; use a SQLite-consistent backup. Discovery records are operational cache and never replace chain state or settlement records. The API runs as UID/GID 1000; observer runs as 10001:1000. The dedicated socket directory uses 10001:1000 mode 2770 and the socket mode 0660. Inspect existing volume ownership before deployment.

Discovery timing defaults are a 30-second tick, five-minute refresh, fifteen-minute stale threshold, two concurrent probes and a ten-second provider timeout. The overlay mounts `DISCOVERY_CONFIG_FILE` read-only into both API and observer at `/run/config/discovery.json`; it defaults to the repository's empty `config/discovery.json`. Fields are `tickMs`, `refreshMs`, `staleMs`, `maxInFlight`, and `timeoutMs`; malformed, unknown, out-of-range or inconsistent settings fail startup. Without the observer socket, service reads retain canonical data and show pending/unavailable discovery. No provider calls occur on a service GET.

All settings are integer values. Inclusive bounds are `tickMs` 1,000–3,600,000, `refreshMs` 1,000–86,400,000, `staleMs` 1,000–604,800,000, `maxInFlight` 1–16, and `timeoutMs` 1–10,000. The values must satisfy `tickMs <= refreshMs < staleMs`.

The refresh interval makes a record eligible; it does not guarantee that every service is observed in each interval. Work is bounded per tick and ordered by oldest attempt, so a large registry or unavailable dependencies can cause observations to become stale. After restart, persisted records are eligible for bounded revalidation before being presented as current.

The opt-in `compose.validation.yaml` overlay extends the API/web images with one reusable validation image, run as validator, signer and observer services. Use this topology locally and on a later approved VPS; target-host security still needs independent validation.

```bash
UNMET_ENV_FILE=.env.gate0-local # Use the reviewed private environment file on each host.
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml config --quiet
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml build
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml up -d --no-build --force-recreate --wait
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml ps
```

Set `IMAGE_TAG` to the reviewed source plus a packaging revision. Local-only port overrides can publish only `127.0.0.1:18080:8080`; the base configuration also maps its configured HTTPS port. Do not reuse unrelated Compose projects or volumes.

For every five-service operation, retain both Compose files, the same project name, private environment file and any host-specific `-f` overrides. Follow [update, rollback and stop](#update-rollback-and-stop) for the complete lifecycle. Whenever web is replaced, validator and observer must also be recreated because they share web's network namespace. The `up --force-recreate` procedure recreates all five containers while preserving named volumes.

The five services have these boundaries:

| Service | Network / ingress | Private storage |
| --- | --- | --- |
| web | Only published ingress; Caddy serves frontend and proxies normal API traffic | Existing Caddy data/config volumes |
| api | Application bridge, no published port | Its own durable payment volume and read-only OKX credential file |
| validator | `network_mode: service:web`; unchanged `127.0.0.1:3001` listener | Read-only validator configuration, auth token and signer socket volume; no key or payment database |
| observer | `network_mode: service:web`; private Unix socket only | Read-only policy and settings, dedicated socket volume; no signer or payment storage |
| signer | `network_mode: none`; authenticated Unix socket only | Read-only signer configuration, key and auth token; writable socket volume |

Caddy routes exactly `/v1/x402/validate` to loopback only when the overlay sets `VALIDATION_UPSTREAM`. Without the overlay, that path retains the API upstream. Ordinary API routes still use `api:8787`. No internal service publishes a host port.

All runtimes use read-only roots, dropped capabilities and `no-new-privileges`. Validator runs as `10001:1000`; signer as `1000:1000`. The image initializes the socket directory as owner/group `1000:1000`, mode `2770`; signer uses umask `007`. Validator mounts that volume read-only. Bind-mounted file ownership/modes must allow the configured container identities to read them; local Compose mounts preserve host ownership rather than remapping secrets.

Keep these files outside the repository and build context, inside a mode-700 parent directory:

| Compose input | Contents / host permissions |
| --- | --- |
| `OKX_CREDENTIALS_FILE` | Mode 600, UID 1000; JSON containing exactly nonempty `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` strings |
| `VALIDATION_CONFIG_FILE` | Mode 640, group 1000; parsed by `parseValidationConfig` |
| `SIGNER_CONFIG_FILE` | Mode 600, UID 1000; exact signer deployment/policy allowlist and container file paths |
| `SIGNER_AUTH_TOKEN_FILE` | Mode 640, group 1000; 64–256 lowercase hexadecimal bytes, no newline |
| `SIGNER_PRIVATE_KEY_FILE` | Mode 600, UID 1000; raw verifier key, mounted only in signer |

The overlay removes the three OKX secret environment values and uses `OKX_CREDENTIALS_PATH=/run/secrets/okx-credentials.json`. The API entrypoint loads them for initialization, then removes them from `process.env` in `finally`. The official facilitator retains its private credentials in process memory to authenticate requests. Missing or conflicting credential sources fail closed. The base two-service environment-based startup remains supported. No secret is a build argument or a `VITE_*` input.

Validator configuration must use `/run/unmet-signer/signer.sock` and `/run/secrets/signer-auth.token`. Signer configuration must use those same paths plus `/run/secrets/operator.key`. Bind one exact lowercase escrow chain/contract/verifier and exact `validationPolicyId`; never use a wildcard. Its policy is SHA-256/JCS of the public envelope, excluding RPC URLs and secrets.

For the separately approved local deployment on chain 1952 at `0x4411c49f8a3efcc671a1b11e651cc82abeadace5`, the owner selected Mainnet `eip155:196` / USDC `0xb6ceceab302e2e4948951ee7843fc24e92933061` / 6 decimals as the service-price denomination in [Future Implementation §4.6](FUTURE_IMPLEMENTATION.md#46-price-denomination-policy). Testnet faucet `USDC_TEST` (`0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d`, six decimals) is escrow collateral only; it is not Circle native USDC. The approved local profile uses x402 v2 `exact`, EIP-3009 with its standard default, `authorization` with its standard default, token domain `USDC` / `2`, builder-authorized nonzero receivers, same-asset integer comparison, and an owner-approved 300-second maximum payment authorization timeout. USD₮0, USDG, Permit2, other flows and other networks are not enabled. The separate 900-second attestation lifetime is unchanged.

Evidence: [Circle's native USDC on X Layer listing](https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer), [EVM exact EIP-3009 method/default](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md), and [x402 v2 authorization-flow default](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md#61-asset-transfer-methods-and-payment-flow-models). Read-only Mainnet calls verified chain 196, token bytecode, name, six decimals, and the `DOMAIN_SEPARATOR` reconstructed from `USDC` / `2` / chain / address. The installed official `@okxweb3/x402-core` 0.1.0 uses `https://web3.okx.com`; profile facilitator metadata identifies that public base URL only. The denomination and timeout are explicit owner decisions. They are not derived from a synthetic vector or Demand Intelligence billing.

The public [Gate-0 Testnet policy envelope](gate0-testnet-policy.json) records the exact approved deployment/profile without RPC URLs, file paths or secrets. Its SHA-256/JCS `validationPolicyId` is `0xadd7277f7b08fa5cb3e56d045ff684567d708451e01dcd1ff36f9c6254c2d783`. Use its `demandPriceAsset` and `profile` unchanged when preparing the private validator config, adding the separately reviewed RPC URLs; the signer must allow only that exact deployment/policy tuple. Changing any public policy field requires review and a recomputed ID.

Build frontend with `VITE_VALIDATION_URL=/v1/x402/validate` and only the configured policy's networks after runtime readiness is proven. A builder endpoint must be public HTTPS and expose a compatible unpaid x402 challenge. PASS does not prove future payment settlement or service quality. Never use a private/local endpoint as passing evidence.

Healthchecks probe the validator's malformed-request rejection and the signer's unauthenticated rejection. These are liveness probes, not proof of a valid builder PASS. Independently verify chain/configuration, socket authentication, exact policy scope and failure paths. Recreate validator whenever web is recreated, because its network namespace belongs to web. A stale Unix socket after an abnormal exit must be investigated with signer stopped; do not blindly delete a live socket or change its permissions to world-writable.

For a later VPS, retain these images and topology. Change domain/origin, TLS, secret paths/ownership, and reviewed management-address denylist. Independently verify ingress firewall rules, namespace/mount separation, host/metadata/management denial, and egress controls outside the validator process; explicitly permit reviewed DNS/RPC control paths and checked public HTTPS targets. The application bridge is not an egress firewall. Local acceptance does not establish target-host G0.6 readiness or authorize VPS deployment.

### Persistent egress on the reviewed VPS

[The repository policy `ops/firewall/unmet-egress.nft`](../ops/firewall/unmet-egress.nft) is installed as `/etc/ufw/unmet-egress.nft` and owns only runtime `table bridge unmet_egress`. It enforces the **shared web/validator boundary**, not a per-process boundary: both use web's network namespace. Native bridge `prerouting` at priority `-100` covers same-bridge, host-local and routed traffic without enabling `br_netfilter`; `DOCKER-USER` alone misses some of these paths.

The reviewed production topology pins IPv4 sources `172.30.80.2` and `172.18.0.3`. Exact TCP exceptions for API `172.30.80.3:8787` and HOROI `172.18.0.2:3000` precede private/reserved/metadata denies; `43.156.68.254` is denied as the VPS public management address. Ingress replies, related traffic and public TCP HTTPS/443 remain allowed. Validator loopback and Docker DNS remain local; API egress is outside this policy and signer retains `network_mode: none`. Both reviewed bridge interfaces have IPv6 disabled: this IPv4 policy does not establish IPv6 protection. Review any IP, topology, port, dependency or IPv6 change before applying it elsewhere.

#### Install or update

This procedure targets the existing approved UFW host. Obtain the required operational approval and recovery access before mutation; a UFW reload can affect unrelated services. Record UFW, SSH, unrelated firewall tables/services and application health first. Securely back up the previous owned policy, `/etc/ufw/after.init` (including ownership, mode and existing cases/license), and the owned runtime table, recording whether each existed. Prepare and review rollback before proceeding; keep these host-specific backups outside Git.

From the reviewed checkout, install the policy as root with mode `0600` and check it before reload:

```bash
sudo install -o root -g root -m 0600 ops/firewall/unmet-egress.nft /etc/ufw/unmet-egress.nft
sudo nft --check --file /etc/ufw/unmet-egress.nft
```

Integrate only these commands into the existing `/etc/ufw/after.init` case arms; do not replace the hook or its other cases/license. Keep it executable and preserve its existing error handling. The `start` arm must stop on a failed check/load:

```sh
# Inside the existing start) arm:
/usr/sbin/nft --check --file /etc/ufw/unmet-egress.nft || exit 1
/usr/sbin/nft --file /etc/ufw/unmet-egress.nft || exit 1
printf 'UNMET_EGRESS bridge policy loaded\n'

# Inside the existing status) arm:
/usr/sbin/nft list table bridge unmet_egress || exit 1
```

The file atomically adds/deletes/recreates its own table, so repeated loads are idempotent; it has no saved counter values and never flushes the host ruleset. Use the existing UFW lifecycle, with no new service or firewall framework:

```bash
sudo ufw reload
systemctl is-active ufw
sudo ufw status
sudo nft list tables
sudo nft list table bridge unmet_egress
```

Verify the checks below directly after reload, then after the [canonical four-service recreation](#update-rollback-and-stop), which recreates web and validator together using both Compose files. Do not manually reapply nft rules after recreation. On 2026-11-02, this reviewed host passed UFW reload, canonical web/validator recreation and reboot autoload through the existing UFW hook, with required paths and deny counters verified after each and no manual reapplication after recreation or reboot. Repeat this acceptance for future deployments; these results apply only to the tested host and topology.

The one-time migration from historical `unmet-g06.nft` / `bridge unmet_g06` must load and verify the canonical table before deleting the superseded owned table. Remove the old file only after required-path and deny probes succeed. Normal updates use only the canonical names.

#### Verify and roll back

Require exactly one `bridge unmet_egress` table with **2 sets, 2 chains and 9 rules**. Verify SSH, public ingress, API, HOROI, Docker DNS, RPC, public HTTPS, validator and signer health; compare unrelated host services/firewall state with the baseline. Test all nine deny classes: metadata, host private addresses, Docker gateway, reserved addresses, HOROI wrong port, API wrong port, VPS public management, public HTTP/80 and unapproved external DNS/53. Include direct UDP DNS and require increasing host deny counters, not only connection timeouts. Repeat after recreation and the separately approved reboot. Use unpaid/read-only probes; no paid or onchain writes.

For rollback, restore the saved owned policy and hook with their original permissions, syntax-check and atomically apply the saved policy **before** retiring any superseded owned table. Verify recovery traffic, required paths, denies and unrelated state; confirm persistence through the restored UFW hook. On first install, absence of a prior policy is not a normal rollback that permits deleting protection: retain the reviewed fallback or maintenance boundary until protection is restored. Never flush the host ruleset, remove persistent volumes or use a namespace policy loader during normal deployment; any namespace fallback is confined to the reviewed emergency rollback.

One Compose stack runs a Bun/Express API and Caddy containing the production React/Vite build. The contract remains the source of truth. Browsers still read/write the configured X Layer contract directly through their RPC/wallet; the backend is the separate demand index and paid opportunities endpoint.

Run Compose from the repository root. It keeps `context: .` and builds with `docker/Dockerfile.api` and `docker/Dockerfile.web`; the web image copies `docker/Caddyfile` into `/etc/caddy/Caddyfile`. Root `compose.yaml`, `.dockerignore` and `.env.example` remain the entrypoints for local configuration.

The public frontend build includes `robots.txt`, `sitemap.xml`, an RFC 9727 API catalog, OpenAPI, and Markdown API/payment guides. The default canonical metadata and public URLs use `https://unmetxyz.my.id`. For another public origin, inventory source and published URLs—including all Docs article canonicals, `frontend/public/openapi.json`, `frontend/public/api.md`, `frontend/public/payment.md` and Reown metadata—with `git grep -n 'unmetxyz.my.id' -- frontend scripts/check-discovery.py`. Configure Caddy `SITE_ADDRESS`, `WWW_SITE_ADDRESS` and `CANONICAL_ORIGIN` as described in the configuration matrix. `sync:payment-discovery` synchronizes payment metadata, not origin URLs; `check:payment-discovery` validates price, assets and network. Run `bun run test:frontend` to verify canonical metadata and generated docs routes. Caddy serves known public files before its SPA fallback and returns 404 for unsupported `/.well-known/*` paths; ACME challenge paths remain available to Caddy's certificate handler.

## WSL2 prerequisites

On Windows, enable Ubuntu WSL2 and Docker Desktop integration for that distribution. Alternatively use a compatible Docker Engine and Compose plugin inside Linux; do not start a second daemon alongside working Docker Desktop integration.

Run all commands in the Linux shell from the native Linux filesystem (/home/<user>/projects/UNMET, never /mnt/c). Confirm uname -a, docker version and docker compose version. Source checks additionally need Bun and Foundry. Docker pins Bun 1.4.2 and Caddy 2.11.2; only Linux AMD64 was validated.

Start with at least 2 CPU cores / 2 GiB RAM and additional build headroom; this is an estimate, not measured production capacity. Runtime limits are 1 CPU / 512 MiB for API and 0.5 CPU / 128 MiB for Caddy. Build memory is not governed by those runtime limits.

Obtain your own OKX API key, secret, passphrase, API fee recipient address, RPC access/quota, intended deployed demand/token addresses, and Reown project with your localhost/domain origins allowed. No deployment key is needed.

## Configure and start

The following commands start the base API/web stack only. Gate-0 deployments must instead use the [four-service procedure](#gate-0-validator-and-signer), including its lifecycle commands.

~~~bash
git clone https://github.com/riyannode/UNMET.git
cd UNMET
cp .env.example .env
chmod 600 .env
# Edit .env privately; fill the required blank fields.
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api web
~~~

Never paste resolved Compose configuration, .env, or container environment inspection into public logs. The --quiet config check does not print secrets.

Local defaults serve http://localhost and bind host ports only to 127.0.0.1. For another free local port, set HTTP_PORT=18080 and FRONTEND_ORIGIN=http://localhost:18080; keep SITE_ADDRESS=http://localhost. No domain or certificate is required. The API has no published host port. Caddy reaches api:8787 on the application bridge. This bridge allows outbound RPC/OKX HTTPS and is not egress-isolated.

### Configuration matrix

| Input | Required / visibility | Meaning |
| --- | --- | --- |
| SITE_ADDRESS | Public, default http://localhost | Caddy site address; future public hostname enables TLS |
| WWW_SITE_ADDRESS | Public, default http://localhost:8081 | Alias serving a permanent 308 redirect; default port is not published |
| CANONICAL_ORIGIN | Public, default http://localhost | Redirect destination origin, without trailing slash; preserves path and query |
| WEB_BIND_IP, HTTP_PORT, HTTPS_PORT | Public, defaults 127.0.0.1, 80, 443 | Host ingress binding |
| IMAGE_TAG | Public, default local | Set to an immutable release/commit identifier when updating |
| APP_SUBNET, CADDY_INTERNAL_IP, API_INTERNAL_IP | Public, defaults 172.30.80.0/24, 172.30.80.2, 172.30.80.3 | Choose a nonconflicting subnet and unused addresses inside it, changing all three together |
| CHAIN_ID | Public, default 1952 | Demand chain; X Layer presets 1952/196, or explicit custom chain metadata |
| XLAYER_RPC_URL | Required API runtime | HTTP(S) RPC; may contain a private provider credential; never reuse it as a public build input |
| DEMAND_CONTRACT, PAYMENT_TOKEN | Required for market runtime, public addresses | Reviewed canonical contract and immutable token on the same chain; no experimental address fallback |
| PAYMENT_TOKEN_SYMBOL, PAYMENT_TOKEN_DECIMALS | Public escrow metadata | Faucet USDC_TEST acceptance token; explicit decimals checked against token; independent of x402 billing |
| CHAIN_NAME, CHAIN_EXPLORER_URL, CHAIN_NATIVE_NAME, CHAIN_NATIVE_SYMBOL, CHAIN_NATIVE_DECIMALS | Required for custom chains | Chain metadata bound to the deployment; use matching VITE_ inputs for browser builds |
| DEMAND_DEPLOY_BLOCK | Optional nonnegative integer | Existing metadata; index rebuild reads current contract state |
| X402_CHAIN_ID | Required API runtime | **Must be 196 in production containers**, independently of Testnet market 1952 |
| X402_RPC_URL | API runtime, public default `https://rpc.xlayer.tech` | Bounded Mainnet receipt confirmation RPC; must return chain ID 196; a credential-bearing provider URL is private configuration; never use the market RPC |
| OPPORTUNITY_PRICE | Public, default 0.01 | Mainnet must remain exactly `0.01`; other values fail configuration |
| OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE | Required private API runtime | Your official OKX facilitator credentials |
| OKX_PAY_TO | Required public nonzero address | API fee recipient; does not change contract treasury/escrow beneficiary |
| FRONTEND_ORIGIN | Required API runtime | Comma-separated exact browser origins including scheme/port |
| PORT, HOST, NODE_ENV | Standalone Bun runtime | Compose fixes these to 8787, 0.0.0.0, production |
| TRUSTED_PROXIES | Standalone runtime; empty by default | Explicit IP/CIDR allowlist; Compose trusts only Caddy's internal /32 |
| VITE_CHAIN_ID, VITE_DEMAND_CONTRACT, VITE_PAYMENT_TOKEN, VITE_PAYMENT_TOKEN_SYMBOL, VITE_PAYMENT_TOKEN_DECIMALS | Public build inputs | Match the demand deployment; an unset canonical contract disables escrow actions |
| VITE_VALIDATION_URL, VITE_VALIDATION_NETWORKS | Public build inputs | Public validator URL and approved comma-separated CAIP-2 networks; missing config disables builder submission |
| VITE_XLAYER_RPC_URL | Required public build input | Browser-accessible RPC; no confidential provider credentials |
| VITE_REOWN_PROJECT_ID | Required public build input | Your Reown project ID; allow your site origin in Reown |
| VITE_MARKET_SYNC_INTERVAL_MS | Public build input, default 60000 | Existing browser synchronization setting |

VITE_* values are embedded in public JavaScript at build time: rebuild web after changes. Private OKX inputs are passed only through the API's explicit runtime environment allowlist, never build arguments. Neither image contains .env or .git. Neither runtime receives DEPLOYER_PRIVATE_KEY; keep deployment credentials in a separate ignored file outside normal runtime.

Docker host/daemon administrators can inspect runtime environment values. Docker is not a secret vault. Restrict file permissions, daemon/socket access, backups and log access. If credentials leak, revoke/rotate them through the provider, replace private configuration and recreate api; rotation is an operator action.

The template pins the reviewed faucet-supported Testnet AgentDemand at `0x4411c49f8a3efcc671a1b11e651cc82abeadace5`, deployment block `45074702`, and escrow `USDC_TEST` at `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` with six decimals; see [deployment evidence](ARCHITECTURE.md#faucet-supported-testnet-acceptance-deployment). It retains independent Mainnet x402 billing and does not authorize payment or wallet actions. Testnet 1952 retains its existing challenge configuration, while durable paid acceptance is currently Mainnet-only; Compose preserves the production X402_CHAIN_ID=196 invariant.

Paid responses require a healthy durable SQLite store. Without `PAYMENT_DB_PATH`, unpaid requests retain the official 402 challenge, but submitted payment headers fail with `503 PAYMENT_STORAGE_UNAVAILABLE`; `/ready` also fails closed. Mainnet responses are released after the official facilitator reports strict success and `X402_RPC_URL` confirms a matching successful canonical L2 inclusion. This check does not wait for safe/finalized or L1 finality.

## Routing and proxy trust

Caddy serves the API catalog and `/docs` static documentation before other handlers, then handles `/v1`, `/v1/*`, `/live`, `/ready` and `/health` before SPA fallback. Unsupported `/.well-known/*` routes return 404, except ACME challenge paths. Unknown versioned API endpoints return Express JSON 404. Other paths use `index.html`, preserving existing React routes and its UI 404. Hashed `/assets/*` are cached for one year; HTML revalidates after deployment.

Caddy replaces X-Forwarded-For with the actual TCP peer address. Express trusts only Caddy's fixed internal IP, not an arbitrary hop count. Direct access from an untrusted API peer ignores spoofed forwarding headers. Keep api without published ports and do not attach arbitrary containers to its network. Another CDN/proxy requires a separately designed trusted client-IP chain. CORS is not authentication or abuse protection.

Rate limits use Express req.ip under the configured TRUSTED_PROXIES policy.

Caddy forwards x402 headers/statuses unchanged. Its upstream response-header deadline is 90 seconds; RPC/facilitator calls have shorter independent deadlines. Interrupted paid requests may have ambiguous settlement state: never automatically replay signed payments.

Both runtimes use non-root users and read-only root filesystems. Caddy binds unprivileged container ports 8080/8443, mapped to host 80/443. Its process probe uses unpublished port 8090. Only certificate/config volumes and small temporary filesystems are writable.

### Cloudflare proxy activation gate

Cloudflare proxying is a production change and requires separate operational authorization before changing production DNS from DNS-only to proxied. The current deployment is DNS-only. Do not enable the proxy until staging/runtime evidence demonstrates all of the following for the actual ingress and origin path:

- Cloudflare ingress is authenticated/restricted as designed, and the complete trusted-proxy chain through Cloudflare and Caddy/Express assigns the original client IP. Test spoofed `CF-Connecting-IP` and `X-Forwarded-For` values from direct or untrusted requests to confirm they cannot alter identity or bypass limits.
- Per-client quotas remain correct behind shared Cloudflare edges; clients do not collapse into an edge-wide quota.
- WAF permits real programmatic JSON requests without JavaScript challenges or CAPTCHA, while application validation and quotas remain active.
- API responses bypass caching and use `no-store`, including 402 challenges, paid 200 responses, and errors, regardless of payment headers.
- Payment request headers and response status, body, and payment headers are preserved. The proxy does not retry requests or risk double settlement; ambiguous/unknown payment outcomes remain fail-closed.

Record the tested configuration and runtime evidence before requesting the production DNS change. Local fixtures and DNS-only public checks do not pass this gate or establish proxied behavior. Synthetic fixtures may validate forwarding without a real payment; live paid acceptance requires separate explicit authorization.

## Limits and bounded work

| Setting | Default | Allowed range / effect |
| --- | --- | --- |
| RATE_WINDOW_MS | 60000 | 100..3600000 ms, fixed window per route/client |
| RATE_DEMANDS | 60 | 1..100000 demands requests/window/IP |
| RATE_OPPORTUNITIES | 20 | 1..100000 opportunities requests/window/IP, including unpaid challenges |
| RATE_MAX_KEYS | 10000 | 1..1000000 live route/IP keys; new keys get 503 when full |
| MAX_IN_FLIGHT | 16 | 1..256 admitted requests, no waiting queue |
| RPC_MAX_IN_FLIGHT | 16 | 4..128 outbound RPC transports shared process-wide |
| RPC_TIMEOUT_MS | 5000 | 100..30000 ms, aborts transport/body; zero automatic retries |
| UPSTREAM_MAX_BYTES | 2097152 | 1024..16777216 bytes/RPC or facilitator response |
| INDEX_BATCH_SIZE | 4 | 1..32 demands/wave, three parallel reads/demand |
| INDEX_MAX_DEMANDS | 10000 | 1..100000; explicit unavailable if exceeded |
| INDEX_MAX_LOG_WINDOWS | 100 | 1..10000 windows of at most 100 blocks; larger gaps rebuild current state |
| INDEX_BUDGET_MS | 15000 | 100..120000 ms checked between operations/waves; an active wave may add one RPC timeout |
| INDEX_REFRESH_MS | 5000 | 0..60000 ms reuse of a successful complete snapshot |
| DEPENDENCY_CACHE_MS | 5000 | 100..60000 ms health coalescing/cache and payment-initialization failure backoff |
| FACILITATOR_TIMEOUT_MS | 15000 | 100..60000 ms/official SDK HTTP call; settlement is attempted once |
| SHUTDOWN_TIMEOUT_MS | 20000 | 100..120000 ms drain deadline; keep Compose grace longer |

The effective batch size is clamped to the RPC capacity (three reads/demand, reserving three slots where possible). At the minimum RPC capacity of four, one demand can run at a time; concurrent health work may still receive a bounded capacity rejection. Excess RPC work rejects immediately. A single shared refresh promise avoids duplicated rebuilds. Successful snapshots are reused for five seconds and keep their indexed block number. Rebuilds/incremental updates read at a pinned block, verify its canonical hash, then publish a complete checkpoint atomically. Failed required refreshes return unavailable, retaining the old checkpoint internally; they do not return a fabricated complete/truncated dataset.

Expired limiter keys are removed in expiration order. Full state rejects new identities rather than evicting active quotas. NAT/shared-IP users share quotas. All limits/index caches are **process-local**, not globally shared.

Validation, rate limiting and admission precede official x402. Rejected inputs receive 400/413/415/429/503 before verification/settlement. Finish/close/error/abort marks the connection ended. Release occurs exactly once only after all admitted middleware and execution promises have completed, including asynchronous verification, settlement and lazy initialization. Disconnect never frees capacity while that work is still running. New asynchronous handlers must return their promise through admittedWork; detached background work is not part of this model. A disconnected request cannot start new chain execution/settlement after verification; a buffered error response completes the SDK without settlement. Settlement already in progress continues under the same slot until its promise completes. A closed HTTP connection does not cancel an ambiguous payment; RPC/facilitator transport caps remain held until work ends.

## Health, smoke checks and logs

- /live: cheap process liveness, no chain/payment call. Docker uses it to avoid restart loops on temporary RPC outages.
- /health: preserves chain/contract verification and success fields, with short shared caching; checks chain ID, bytecode, immutable token, token decimals and latest block.
- /ready: additionally checks configured durable storage and requires initialized payment middleware. It initiates no payment and does not promise future verify/settle success. Chain outages appear after the dependency cache expires.
- The first data request warms the index under a single-flight promise. Readiness is dependency readiness, not proof a cold index fits its budget. Alert separately on INDEX_* failures.
- Structured logs contain generated request IDs, registered method/route, status/duration and stable error codes. Application handlers omit raw bodies, payment headers, query strings and upstream exception text. The pinned official SDK lacks transport/log injection options: an async-local scope bounds its unchanged signed HTTP calls and replaces its warning/error diagnostics with a stable PAYMENT_SDK_DIAGNOSTIC record. Fetch and console calls outside that scope retain their original behavior.
- Compose rotates JSON logs at 10 MiB, three files/container. The restart policy restarts exited containers; Docker does not automatically restart a merely unhealthy live process.

The automated smoke script accepts only local HTTP origins (`localhost`, `127.0.0.1` or `[::1]`). For the default localhost configuration with HTTP_PORT=80:

~~~bash
BASE_URL=http://localhost bun scripts/smoke-unpaid.ts
~~~

For the custom local HTTP_PORT=18080 configuration above, use its actual origin instead:

~~~bash
BASE_URL=http://localhost:18080 bun scripts/smoke-unpaid.ts
~~~

For manual verification, choose the actual configured browser origin, including scheme and any nondefault port: for example `http://localhost:18080` locally or your configured `https://` domain publicly. Use one origin from FRONTEND_ORIGIN, not its entire comma-separated list. A public Caddy hostname requires requests to that hostname; `http://localhost` is not a substitute. The smoke/load scripts do not accept public domains or HTTPS, so use these curl checks for a separately authorized public deployment:

~~~bash
read -r -p 'Configured browser origin (no trailing slash): ' app_origin
curl -fsS "$app_origin/live"
curl -fsS "$app_origin/ready"
curl -fsS "$app_origin/health"
curl -fsS "$app_origin/v1/demands"
curl -i -H 'Content-Type: application/json' -d '{}' "$app_origin/v1/opportunities"
# Expect official HTTP 402 + PAYMENT-REQUIRED; no signed payment.
~~~

Refresh /docs, /market, /market/1, /create-demand and /analytics at that same origin directly in a browser. Wallet connection requires your Reown origin configuration. Do not sign transactions for deployment smoke testing.

The local-only bounded probe sends **no PAYMENT-SIGNATURE**. This example uses HTTP_PORT=18080; use `http://localhost` instead only for the default port 80. Do not point it at a public HTTPS origin:

~~~bash
BASE_URL=http://localhost:18080 REQUESTS=60 CONCURRENCY=4 bun scripts/load-unpaid.ts
docker stats --no-stream
~~~

At most 200 requests / 16 concurrent clients are permitted. The default unpaid opportunities path does not invoke verify/settle or index refresh after initialization. Do not load-test upstream public services. The probe reports counts and p50/p95/p99; 429 is expected after quota exhaustion. Backend tests separately verify overload with deterministic held requests on local infrastructure.

## Production deployment checklist

Use this checklist for initial deployments, redeployments, and future installations. The configuration below describes the intended operating setup; it does not by itself prove the state of a particular deployment. Record dated runtime verification separately, and repeat the acceptance checks after each deployment. Historical production results apply only to the revision and time recorded in that evidence.

1. Prepare Linux; allow only needed SSH and TCP 80/443, restrict SSH and Docker socket access. Do not expose 8787.
2. Configure domain DNS and inbound reachability. Set SITE_ADDRESS=unmetxyz.my.id, WWW_SITE_ADDRESS=www.unmetxyz.my.id, CANONICAL_ORIGIN=https://unmetxyz.my.id, WEB_BIND_IP=0.0.0.0, HTTP_PORT=80, HTTPS_PORT=443, FRONTEND_ORIGIN=https://unmetxyz.my.id. Caddy obtains certificates for both names, redirects HTTP to HTTPS and sends alias requests to the canonical origin with HTTP 308, preserving paths and queries. Keep both DNS records DNS-only and pointed at the same host. Use your own hostnames for another deployment.
3. Configure real Reown origin/project, public browser RPC and private provider quotas. Review independent payment network/recipient.
4. Rebuild/start the same stack. Public Caddy certificates require valid domain/DNS and reachable ports. The caddy_data/caddy_config volumes preserve certificate state. The web image runs Caddy as UID/GID 10001 and initializes `/data/caddy` and `/config/caddy` as owner 10001 with mode 0700. For existing named volumes, apply `chmod 0700 /data/caddy /config/caddy` inside the running web container after confirming those two directories are owned by 10001; do not recursively change permissions or ownership. Keep the fixed runtime UID when using these volumes.
5. Verify readiness, deep links, JSON API 404, unpaid 402, logs, resources, backups and alerting at the configured HTTPS origin using the [manual verification commands](#health-smoke-checks-and-logs). Paid settlement/replay requires separate authorization/evidence.

Local validation changes no DNS, production certificates or production configuration.

## Update, rollback and stop

Record the current commit/image tag before updating. Retain known-good images with an explicit tag and matching private configuration securely. Never commit .env.

These commands manage the five-service validation and discovery stack on local and VPS hosts. Set `UNMET_ENV_FILE` to that host's reviewed private environment file; retain the same project name and any extra host-specific Compose overrides on every command. Do not fall back to base Compose only. A base API/web installation without Gate-0 may omit the validation overlay.

~~~bash
UNMET_ENV_FILE=.env.gate0-local
git fetch origin
read -r -p 'Reviewed release commit: ' release_commit
git switch --detach "$release_commit"
# Set IMAGE_TAG to that reviewed commit in the selected environment file.
# Preserve its other settings and the matching private mounted configuration.
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml config --quiet
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml build --pull
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml up -d --no-build --force-recreate --wait
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml ps
~~~

After update or rollback, repeat the [health and unpaid verification](#health-smoke-checks-and-logs) against the actual configured origin. Use the automated smoke script only for a local HTTP origin with its configured port; use the manual curl checks for public HTTPS.

Rollback: restore the previous reviewed source/config combination and set IMAGE_TAG to its retained known-good tag. If the images are missing, rebuild that commit with the merged-file build command above. Recreate web, validator and observer together:

~~~bash
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml config --quiet
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml up -d --no-build --force-recreate --wait
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml ps
~~~

Never complete a web replacement without recreating validator and observer, even when their image/configuration is unchanged. Otherwise they can retain the previous web network namespace. Public frontend settings must match the selected build. The chain index rebuilds from the contract. Payment storage uses schema version 1; retain a schema-compatible image and the payment volume. Restoring an older snapshot can forget settled operations: follow [backup and rollback safety](PAYMENT_RECOVERY.md#backup-restore-and-rollback) before resuming paid traffic. Never roll back chain state.

For a graceful stop, manage all five services with the same merged configuration:

~~~bash
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml stop
~~~

Alternatively, remove this stack's containers/network while retaining its named volumes:

~~~bash
docker compose --env-file "$UNMET_ENV_FILE" -f compose.yaml -f compose.validation.yaml down
~~~

**Do not remove volumes** during update, rollback or shutdown: retain payment, Caddy and signer-socket volumes, plus private configuration. API drains for 20 seconds, then closes remaining connections and exits nonzero; Compose allows 25 seconds. Do not assume an interrupted paid request was unsettled.

## Troubleshooting and scaling

| Symptom | Check |
| --- | --- |
| Compose interpolation failure | Required fields and .env location; use config --quiet |
| API exits before listening | Nonzero contract/token/payee, own OKX credentials, HTTP(S) RPC and production payment chain 196 |
| PAYMENT_UNAVAILABLE/startup failure | Official facilitator credentials/network; initialization is bounded and lazy retries back off |
| /live 200 but /ready or /health 503 | RPC quota, wrong chain, missing bytecode; liveness is not readiness |
| INDEX_BUDGET_EXCEEDED/INDEX_CAPACITY | Cold-index cost, demand count, provider quota; tune measured bounds, never bypass completeness |
| 429 | Shared-IP traffic/quota; respect Retry-After |
| 503 OVER_CAPACITY/LIMITER_CAPACITY | Back off; inspect sustained traffic, RAM and RPC limits |
| API HTML or broken deep links | Current Caddy image, API-first handler and SPA fallback |
| CORS/Reown rejection | Exact origin/scheme/port, Reown allowlist and public build inputs; rebuild web |
| TLS failure | DNS, ports 80/443, public SITE_ADDRESS without HTTP scheme, volume permissions |
| Subnet/IP problems | Adjust subnet/Caddy/API IPs together, retain explicit proxy trust/header replacement |

Measure CPU/RAM, RPC quota, cold-index latency, p95/p99 and 429/503 before increasing limits. This targets one VPS and one API replica. Extra replicas duplicate RPC/index work and have separate quotas. Global rate policy, index ownership and official x402 verify/settle/idempotency under concurrent retry/failure need verification before horizontal scaling. There is no Redis, database server or worker. Local SQLite payment storage is required and is not a distributed payment guarantee.

## Durable payment storage

The Docker API requires native Bun SQLite on the persistent payment_data volume at /data/payments.sqlite. Preserve this volume across recreate, updates and rollback; never use docker compose down -v with real payment data. Without durable storage, unpaid challenges may be served, but requests carrying payment headers fail closed with `PAYMENT_STORAGE_UNAVAILABLE`.

SQLite uses WAL and synchronous=FULL; run exactly one Bun API replica with local storage. No automatic settlement retry or original paid-response replay is provided. Hashless ambiguous outcomes need operator investigation.

See [payment recovery operations](PAYMENT_RECOVERY.md) for state transitions, optional Idempotency-Key, duplicate/conflict responses, configuration, reconciliation, integrity checks, WAL-consistent backups, restore precautions and single-replica limitations.
