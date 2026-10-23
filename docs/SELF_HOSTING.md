# Self-hosting unmet

One Compose stack runs a Bun/Express API and Caddy containing the production React/Vite build. The contract remains the source of truth. Browsers still read/write the configured X Layer contract directly through their RPC/wallet; the backend is the separate demand index and paid opportunities endpoint.

Run Compose from the repository root. It keeps `context: .` and builds with `Docker/Dockerfile.api` and `Docker/Dockerfile.web`; the web image copies `Docker/Caddyfile` into `/etc/caddy/Caddyfile`. Root `compose.yaml`, `.dockerignore` and `.env.example` remain the entrypoints for local configuration.

## WSL2 prerequisites

On Windows, enable Ubuntu WSL2 and Docker Desktop integration for that distribution. Alternatively use a compatible Docker Engine and Compose plugin inside Linux; do not start a second daemon alongside working Docker Desktop integration.

Run all commands in the Linux shell from the native Linux filesystem (/home/<user>/projects/UNMET, never /mnt/c). Confirm uname -a, docker version and docker compose version. Source checks additionally need Bun and Foundry. Docker pins Bun 1.4.2 and Caddy 2.11.2; only Linux AMD64 was validated.

Start with at least 2 CPU cores / 2 GiB RAM and additional build headroom; this is an estimate, not measured production capacity. Runtime limits are 1 CPU / 512 MiB for API and 0.5 CPU / 128 MiB for Caddy. Build memory is not governed by those runtime limits.

Obtain your own OKX API key, secret, passphrase, API fee recipient address, RPC access/quota, intended deployed demand/token addresses, and Reown project with your localhost/domain origins allowed. No deployment key is needed.

## Configure and start

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
| CHAIN_ID | Public, default 1952 | Demand chain; supported values 1952 and 196 |
| XLAYER_RPC_URL | Required API runtime | HTTP(S) RPC; may contain a private provider credential; never reuse it as a public build input |
| DEMAND_CONTRACT, PAYMENT_TOKEN | Required, public addresses | Nonzero valid EVM addresses on the intended market chain |
| DEMAND_DEPLOY_BLOCK | Optional nonnegative integer | Existing metadata; index rebuild reads current contract state |
| X402_CHAIN_ID | Required API runtime | **Must be 196 in production containers**, independently of Testnet market 1952 |
| OPPORTUNITY_PRICE | Public, default 0.01 | Existing decimal API price, at most six decimals |
| OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE | Required private API runtime | Your official OKX facilitator credentials |
| OKX_PAY_TO | Required public nonzero address | API fee recipient; does not change contract treasury/escrow beneficiary |
| FRONTEND_ORIGIN | Required API runtime | Comma-separated exact browser origins including scheme/port |
| PORT, HOST, NODE_ENV | Standalone Bun runtime | Compose fixes these to 8787, 0.0.0.0, production |
| TRUSTED_PROXIES | Standalone runtime; empty by default | Explicit IP/CIDR allowlist; Compose trusts only Caddy's internal /32 |
| VITE_CHAIN_ID, VITE_DEMAND_CONTRACT, VITE_PAYMENT_TOKEN | Public build inputs | Match the demand market, not the independent x402 rail |
| VITE_XLAYER_RPC_URL | Required public build input | Browser-accessible RPC; no confidential provider credentials |
| VITE_REOWN_PROJECT_ID | Required public build input | Your Reown project ID; allow your site origin in Reown |
| VITE_MARKET_SYNC_INTERVAL_MS | Public build input, default 60000 | Existing browser synchronization setting |

VITE_* values are embedded in public JavaScript at build time: rebuild web after changes. Private OKX inputs are passed only through the API's explicit runtime environment allowlist, never build arguments. Neither image contains .env or .git. Neither runtime receives DEPLOYER_PRIVATE_KEY; keep deployment credentials in a separate ignored file outside normal runtime.

Docker host/daemon administrators can inspect runtime environment values. Docker is not a secret vault. Restrict file permissions, daemon/socket access, backups and log access. If credentials leak, revoke/rotate them through the provider, replace private configuration and recreate api; rotation is an operator action.

The example uses Testnet demand state and Mainnet x402. It does not authorize payment. Local test billing on 1952 is available only for an explicitly configured nonproduction standalone process; Compose preserves the production X402_CHAIN_ID=196 invariant.

## Routing and proxy trust

Caddy handles /v1, /v1/*, /live, /ready and /health before static fallback. Unknown versioned API endpoints return Express JSON 404. Other paths use index.html, preserving existing React routes and its UI 404. Hashed /assets/* are cached for one year; HTML revalidates after deployment.

Caddy replaces X-Forwarded-For with the actual TCP peer address. Express trusts only Caddy's fixed internal IP, not an arbitrary hop count. Direct access from an untrusted API peer ignores forwarding headers, including forged Vercel identity headers. Keep api without published ports and do not attach arbitrary containers to its network. Another CDN/proxy requires a separately designed trusted client-IP chain. CORS is not authentication or abuse protection.

On Vercel, the platform-owned VERCEL=1 runtime flag selects a validated single-IP x-vercel-forwarded-for identity instead of the internal socket peer. Changing x-forwarded-for/x-real-ip cannot change that identity; missing, invalid or multi-IP platform identity returns CLIENT_IP_UNAVAILABLE (503) before payment rather than assigning a shared proxy quota. Merely sending Vercel-looking headers never selects this policy. Docker's explicit environment allowlist does not pass VERCEL, so its Caddy-only proxy policy remains unchanged. Do not manually set VERCEL=1 on a directly reachable standalone server. This relies on [Vercel's ingress header contract](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for); custom proxy arrangements need separate validation. Quotas still remain process-local across Vercel instances.

Caddy forwards x402 headers/statuses unchanged. Its upstream response-header deadline is 90 seconds; RPC/facilitator calls have shorter independent deadlines. Interrupted paid requests may have ambiguous settlement state: never automatically replay signed payments.

Both runtimes use non-root users and read-only root filesystems. Caddy binds unprivileged container ports 8080/8443, mapped to host 80/443. Its process probe uses unpublished port 8090. Only certificate/config volumes and small temporary filesystems are writable.

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
| FACILITATOR_TIMEOUT_MS | 15000 | 100..60000 ms/official SDK HTTP call; no settlement retry added |
| SHUTDOWN_TIMEOUT_MS | 20000 | 100..120000 ms drain deadline; keep Compose grace longer |

The effective batch size is clamped to the RPC capacity (three reads/demand, reserving three slots where possible). At the minimum RPC capacity of four, one demand can run at a time; concurrent health work may still receive a bounded capacity rejection. Excess RPC work rejects immediately. A single shared refresh promise avoids duplicated rebuilds. Successful snapshots are reused for five seconds and keep their indexed block number. Rebuilds/incremental updates read at a pinned block, verify its canonical hash, then publish a complete checkpoint atomically. Failed required refreshes return unavailable, retaining the old checkpoint internally; they do not return a fabricated complete/truncated dataset.

Expired limiter keys are removed in expiration order. Full state rejects new identities rather than evicting active quotas. NAT/shared-IP users share quotas. All limits/index caches are **process-local**, not globally shared.

Validation, rate limiting and admission precede official x402. Rejected inputs receive 400/413/415/429/503 before verification/settlement. Finish/close/error/abort marks the connection ended. Release occurs exactly once only after all admitted middleware and execution promises have completed, including asynchronous verification, settlement and lazy initialization. Disconnect never frees capacity while that work is still running. New asynchronous handlers must return their promise through admittedWork; detached background work is not part of this model. A disconnected request cannot start new chain execution/settlement after verification; a buffered error response completes the SDK without settlement. Settlement already in progress continues under the same slot until its promise completes. A closed HTTP connection does not cancel an ambiguous payment; RPC/facilitator transport caps remain held until work ends.

## Health, smoke checks and logs

- /live: cheap process liveness, no chain/payment call. Docker uses it to avoid restart loops on temporary RPC outages.
- /health: preserves chain/contract verification and success fields, with short shared caching; checks chain ID, bytecode and latest block.
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

## Future public VPS setup

This PR deploys nothing publicly. Before separately authorized deployment:

1. Prepare Linux; allow only needed SSH and TCP 80/443, restrict SSH and Docker socket access. Do not expose 8787.
2. Configure domain DNS and inbound reachability. Set SITE_ADDRESS=unmetxyz.my.id, WWW_SITE_ADDRESS=www.unmetxyz.my.id, CANONICAL_ORIGIN=https://unmetxyz.my.id, WEB_BIND_IP=0.0.0.0, HTTP_PORT=80, HTTPS_PORT=443, FRONTEND_ORIGIN=https://unmetxyz.my.id. Caddy obtains certificates for both names, redirects HTTP to HTTPS and sends alias requests to the canonical origin with HTTP 308, preserving paths and queries. Keep both DNS records DNS-only and pointed at the same host. Use your own hostnames for another deployment.
3. Configure real Reown origin/project, public browser RPC and private provider quotas. Review independent payment network/recipient.
4. Rebuild/start the same stack. Public Caddy certificates require valid domain/DNS and reachable ports. The caddy_data/caddy_config volumes preserve certificate state. The web image runs Caddy as UID/GID 10001 and initializes `/data/caddy` and `/config/caddy` as owner 10001 with mode 0700. For existing named volumes, apply `chmod 0700 /data/caddy /config/caddy` inside the running web container after confirming those two directories are owned by 10001; do not recursively change permissions or ownership. Keep the fixed runtime UID when using these volumes.
5. Verify readiness, deep links, JSON API 404, unpaid 402, logs, resources, backups and alerting at the configured HTTPS origin using the [manual verification commands](#health-smoke-checks-and-logs). Paid settlement/replay requires separate authorization/evidence.

Local validation changes no DNS, production certificates, Vercel environment or production configuration.

## Update, rollback and stop

Record the current commit/image tag before updating. Retain known-good images with an explicit tag and matching private configuration securely. Never commit .env.

~~~bash
git fetch origin
read -r -p 'Reviewed release commit: ' release_commit
git switch --detach "$release_commit"
# Set IMAGE_TAG to that reviewed commit in .env; preserve other settings.
docker compose build --pull
docker compose up -d --no-build
docker compose ps
~~~

After update or rollback, repeat the [health and unpaid verification](#health-smoke-checks-and-logs) against the actual configured origin. Use the automated smoke script only for a local HTTP origin with its configured port; use the manual curl checks for public HTTPS.

Rollback: restore the previous reviewed source/config combination, set IMAGE_TAG to its retained known-good tag, then run docker compose up -d --no-build. If missing, rebuild that commit first. Public frontend settings must match its build. The chain index rebuilds from the contract. Payment storage uses schema version 1; retain a schema-compatible image and the payment volume. Restoring an older snapshot can forget settled operations: follow [backup and rollback safety](PAYMENT_RECOVERY.md#backup-restore-and-rollback) before resuming paid traffic. Never roll back chain state.

Use docker compose stop for graceful stop, or docker compose down to remove this stack's containers/network. **Do not remove volumes** during update/rollback: retain certificates and private configuration. API drains for 20 seconds, then closes remaining connections and exits nonzero; Compose allows 25 seconds. Do not assume an interrupted paid request was unsettled.

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

The Docker API requires native Bun SQLite on the persistent payment_data volume at /data/payments.sqlite. Preserve this volume across recreate, updates and rollback; never use docker compose down -v with real payment data. Vercel keeps its existing payment behavior and has no durable SQLite guarantee.

SQLite uses WAL and synchronous=FULL; run exactly one Bun API replica with local storage. No automatic settlement retry or original paid-response replay is provided. Hashless ambiguous outcomes need operator investigation.

See [payment recovery operations](PAYMENT_RECOVERY.md) for state transitions, optional Idempotency-Key, duplicate/conflict responses, configuration, reconciliation, integrity checks, WAL-consistent backups, restore precautions and single-replica limitations.
