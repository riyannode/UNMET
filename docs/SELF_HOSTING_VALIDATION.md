# Local self-hosting validation — 2026-10-23

Scope: Docker/API hardening on main 54b863d6edae59b0ee5397cfbfe2fd68274b02b2 (merged PR #12). No public deployment, signed x402 payment, or onchain write occurred.

## Environment

- Ubuntu-24.04, Microsoft WSL2 kernel 6.18.33.2, Linux AMD64.
- Checkout: /home/acer/projects/UNMET.
- Source checks: Bun 1.4.3; Docker build/runtime: pinned Bun 1.4.2.
- Docker Engine 29.7.2, Desktop 4.90.0, Compose v5.5.1; CLI executed inside WSL.
- Forge 1.8.3 / Solc 0.8.37; documented OpenZeppelin v5.6.1 and forge-std v1.16.1 dependencies.
- Caddy 2.11.2. Both base images pinned by version and manifest digest.
- Developer-supplied OKX credentials were imported privately into gitignored .env (mode 0600). Public Reown ID and API fee recipient were supplied separately. No values are reproduced here.

## Automated checks

| Command / check | Result |
| --- | --- |
| bun install --frozen-lockfile | Passed; no lockfile change |
| bun run typecheck | Passed backend + frontend |
| bun run --cwd backend typecheck | Passed final backend, tests and probe scripts |
| bun run test:frontend | 100 passed / 0 failed |
| bun run test:backend | 32 passed / 0 failed |
| bun run test:contract | 19 passed / 0 failed |
| bun run build | Passed; existing large-chunk warning remains |
| bun run --cwd frontend lint | Unavailable: Script not found "lint"; no linter configured |
| git diff --check | Passed |
| docker compose config --quiet | Passed without printing resolved secrets |
| docker compose build --no-cache | Both production images built; final API additionally rebuilt clean after backend fixes |
| caddy validate --config /etc/caddy/Caddyfile | Passed inside web container |

Initially contract tests failed because ignored Foundry dependency directories were absent. Installing the exact tags documented in RUNBOOK resolved that setup failure; no Solidity/ABI/address changes were made.

TDD evidence: the pre-change invalid-filter request returned 402 instead of expected 400. Final tests cover invalid JSON/unknown fields/filter values, 413/415, limiter expiration/separate routes/separate socket clients/key capacity, untrusted forwarded-IP spoofing, overload-before-payment, finish/error/abort slot recovery, bounded RPC time/bytes/capacity recovery, readiness caching, sanitized errors/request IDs, atomic index capacity failure, effective batch sizing, exhausted rebuild budgets and scoped SDK diagnostics.

A budget regression initially started one extra RPC after its deadline; the final test proves no additional call begins. A diagnostic regression initially printed injected private markers; the final scoped SDK logging test proves they are omitted while outside-scope console output remains intact.

## Actual Compose acceptance

One stack served localhost HTTP on loopback port 18080 (HTTPS mapping 18443 was inactive, with no public certificate request). Both services used production configuration, real official OKX initialization, Testnet demand state and Mainnet x402 billing.

| Check | Observed result |
| --- | --- |
| /live | 200; process-only |
| /ready | 200 after official payment initialization and chain checks |
| /health | 200; chain 1952 |
| /v1/demands | 200; six chain-derived demands |
| /v1/unknown | 404 JSON, not SPA HTML |
| Valid unpaid POST /v1/opportunities | Official 402 with PAYMENT-REQUIRED |
| Challenge | x402 v2; exact; eip155:196; amount 10000; asset 0x779ded0c9e1022225f8e0630b35a9b54be713736 |
| Malformed unsigned payment header | Official 402; private diagnostic marker absent from response/logs |
| Five distinct forged forwarding headers after quota exhaustion | All 429; did not bypass Caddy client-IP overwrite |
| Backend host port bindings | Empty object; no 8787 host publication |
| HTML cache | no-cache |
| Hashed asset cache | public, max-age=31536000, immutable |
| Missing credentials / invalid address / invalid limit | Each startup exited 1; no input value or stack trace in output |
| Restart | Both services returned healthy |
| Shutdown | Both exited 0; task containers/network removed |
| Final ports | 18080, 18443 and 8787 confirmed closed |

WSL Chromium direct-load + reload smoke passed for /, /docs, /market, /market/1, /create-demand, /analytics, /my-activity and /unknown-ui: HTTP 200, rendered page content, zero JavaScript page errors. The existing React UI 404 handles unknown UI paths. Browser PID 71193 exited after validation.

Chromium initially lacked libnspr4/libnss3/libasound. Distribution packages were downloaded/extracted only into the task scratch directory; no privileged/system install or Windows browser fallback was used.

Docker integration exposed and fixed two packaging issues: dynamic API allocation could occupy Caddy's trusted IP, so both addresses are now explicit; Caddy's inherited binary file capability conflicted with dropped container capabilities, so it is removed because the runtime uses unprivileged ports.

## Bounded local load

Final run against the actual Caddy/API stack, after API restart with an empty limiter:

~~~text
BASE_URL=http://localhost:18080 REQUESTS=60 CONCURRENCY=4 bun scripts/load-unpaid.ts
requests=60 concurrency=4
402=20 429=40 503=0 transport-errors=0
p50=2.13ms p95=24.23ms p99=29.56ms
~~~

The opportunity quota (20/IP/60 seconds) was the observed bottleneck. These are local unpaid challenge measurements, not paid settlement, RPC indexing throughput or production capacity. After initialization the unpaid challenge path does not invoke verify/settle or RPC. The small probe did not stress public OKX/RPC services.

A post-probe Docker snapshot showed API 37.48 MiB / 512 MiB, CPU 0.17%; Caddy 13.74 MiB / 128 MiB, CPU 0.00%. This snapshot is not a peak utilization or sustained-load measurement. Explicit overload 503 and recovery were exercised with local held-request regression fixtures, not by stressing the facilitator.

## Secret isolation and scope review

Exact-value scanning of all three supplied private OKX values found zero matches in the 117 tracked/new source files present at scan time, frontend build, validation logs, container logs, image history and saved image layer bytes. Newly written validation prose contains no credentials. API runtime environment omitted DEPLOYER_PRIVATE_KEY; web runtime omitted all OKX fields. Resolved secret-bearing Compose configuration was never printed.

This is a targeted secret-isolation check and code review, not an independent vulnerability audit. Final review found no remaining actionable issue within the inspected scope. Smart contracts, ABI constants, deployed addresses, frontend product/UI and existing Vercel configuration remain unchanged.

## Limits and remaining deployment gates

P0 and P1 implementation and feasible local checks are complete. These checks remain outside the evidence:

- No paid verify/settle/replay acceptance or wallet signing; no real payment/chain write was authorized.
- No interactive wallet connect/disconnect acceptance was attempted. Existing frontend wallet/transaction tests pass; real Reown Project ID was used for the final web build/browser smoke.
- No public VPS, DNS, public TLS certificate, production environment change or Vercel deployment.
- No ARM64 validation, distributed quotas/indexing or multi-replica payment idempotency claim.
- No frontend lint command exists; existing build chunk-size warning is unchanged.

Before public hosting, obtain separate authorization, configure real domain/DNS/firewall, verify Reown origin/provider quotas, retain known-good images/config and certificate volumes, and rerun health/deep-link/unpaid-402 checks on that deployment. Paid acceptance is a separate authorized task.

Task-owned containers/network and browser processes were stopped/removed. Private .env, reusable images and Caddy named volumes were retained; no original Windows checkout or unrelated resources were modified.
