# Frontend performance and UI hardening — 2026-10-28

Baseline: `bcbe0a7ed61ec293ddaa2b2025c540e4bf98d3c3` (fetched latest main before editing). Source patch: `49a5912`. Implementation: GPT-6.1 Terra high; source review, browser measurement, and final diff review performed independently by the coordinating agent and separate Standards/Spec reviewers.

## Result and root causes

- RollText relied on an `aria-label` on a generic span while both animated layers were hidden from the accessibility tree. Chrome already resolved the names; a single visually hidden text node now supplies ordinary name-from-content semantics. Both animated layers, hover behavior, layout, and keyboard links remain unchanged.
- The decorative infrastructure PNG was eager-loaded and used a less efficient lossless PNG filter/compression choice. The final PNG is 1,692,288 bytes versus 2,268,767: **576,479 bytes / 25.4% smaller**. Raw decoded RGBA is identical. It retains 2172×724 intrinsic dimensions, existing object-fit/fixed container geometry, and uses native lazy loading. Desktop still fetches it within Chromium's preload distance; mobile defers the one request beyond the initial sample.
- The mobile How It Works container added padding to `width:100%` without border-box sizing. At 390px, step text ended at x414 and was clipped by the section. Mobile-only border-box sizing, shrinkable step copy, and wrapping social proof correct the existing overflow. Desktop rules are unchanged.
- Theme metadata was fixed at `#070b12`. Every SPA/Docs HTML entry now gets exactly one meta before prepaint bootstrap. Saved preferences, toggles and cross-tab storage updates use dark `#101010`; light retains `#070b12`.

## Controlled browser measurements

Chromium **156.0.8078.4**, Ubuntu WSL, headless, DPR 1, fresh context and disabled browser cache per navigation. CDP CPU throttle 4×, network latency 40ms, download 1,250,000 B/s, upload 625,000 B/s. No application builds or image encoding ran during these final paired samples. Baseline and final visits alternated on equivalent local Vite previews (4174/4173). Public font/icon CDN requests were retained; their response variation and software-renderer scheduling limit timing precision. All six expected font faces loaded, including original Satoshi 700 and Satoshi Headings 300–900.

Three samples per variant/case; tables show medians. Requests and transferred bytes are collected **before interactions/scrolling**, including external resources and HTTP headers. A verification GET confirmed gzip for the Vite preview main JavaScript response and identity encoding for the PNG. Network bytes reflect actual encoded responses plus headers; the raw/gzip bundle figures below are computed separately. These local transfers are not estimates of production CDN delivery. LCP is the browser-reported candidate, usually an ecosystem logo on this animated landing, not a claim about heading completion. CLS uses session windows and excludes recent input. The recorded interaction column is the largest Event Timing duration with a nonzero interactionId per visit, then the median across visits. It uses representative theme toggles, mobile menu and How It Works step selection; it is a **lab INP-like sample, not field INP or a production p75**. Zero on workspace rows means interactions were not sampled there, not a zero-latency result.

| Landing case | LCP ms, before → after | CLS | Requests | Transferred B | Lab interaction ms |
| --- | --- | --- | --- | --- | --- |
| desktop-light | 960 → 968 | 0.03738 → 0.03738 | 27 → 27 | 3,894,279 → 3,317,973 | 248 → 312 |
| desktop-dark | 1076 → 1156 | 0.03722 → 0.03417 | 27 → 27 | 3,318,011 → 2,741,709 | 232 → 264 |
| mobile-light | 992 → 900 | 0.00918 → 0.00969 | 27 → 26 | 3,894,280 → 1,625,415 | 144 → 136 |
| mobile-dark | 1016 → 1016 | 0.00969 → 0.00918 | 27 → 26 | 3,318,026 → 1,049,142 | 152 → 144 |

| Direct route (desktop/light) | LCP ms, before → after | CLS | Requests | Transferred B | Lab interaction ms |
| --- | --- | --- | --- | --- | --- |
| /market | 1040 → 948 | 0.00150 → 0.00150 | 15 → 15 | 1,459,306 → 1,459,467 | 0 → 0 |
| /create-demand | 1080 → 1096 | 0.00002 → 0.00002 | 15 → 15 | 1,459,306 → 1,459,477 | 0 → 0 |
| /analytics | 1032 → 1004 | 0.00009 → 0.00009 | 15 → 15 | 1,459,305 → 1,459,477 | 0 → 0 |

Transfer reduction is repeatable. LCP, CLS and interaction point estimates vary in both directions with overlapping sample ranges; these small lab samples do **not** establish a general LCP/INP speedup. No field data was collected. Raw per-run candidates, resource timings, Event Timing entries, byte counts, console errors and conditions are in [measurements.json](measurements.json). All final sampled pages had zero page errors.

## Bundle analysis and rejected experiments

| Production JS chunk | Raw bytes, before → after | gzip bytes | Raw delta |
| --- | --- | --- | --- |
| main | 210,026 → 210,067 | 66,979 → 66,996 | +41 |
| theme | 305,561 → 305,714 | 99,174 → 99,219 | +153 |
| App | 615,894 → 615,894 | 185,169 → 185,170 | +0 |

Total emitted JS: 1,140,871 → 1,141,065 bytes. **No bundle reduction is claimed.** Landing stays eager to preserve its first-route loading behavior; Workspace already uses a shared lazy App module. A tested Create Demand/Analytics split reduced App from 615.89kB to 477.04kB but introduced an App→page request waterfall and new loading states. The trial's direct-route median LCP was 992→1204ms for Create Demand and 988→1248ms for Analytics, while total Market transfer saved only about 6kB. Timing values are lab observations, not isolated causal estimates. The split was fully reverted because it violated the no-waterfall constraint and lacked an acceptable benefit. App/main route registration remains unchanged.

WebP and AVIF were evaluated. Ordinary lossless WebP was 440,130B; exact-RGBA WebP was 1,238,234B; lossless AVIF was 1,516,615B. Local sharp decode observations were approximately 30ms for ordinary WebP versus 353ms for lossless AVIF (one local run, not a browser benchmark). Both WebP variants produced one-channel-level differences around resampled transparent edges in Chromium. They were rejected under the exact-appearance constraint. Lossy candidates were rejected for changed pixels. The retained PNG uses `sharp(...).png({compressionLevel:9,adaptiveFiltering:true,palette:false})`; no new runtime/build dependency or conversion step was added to the repository.

## MagicRings profile and lifecycle

No renderer code was changed. GPU renderer: ANGLE/Vulkan SwiftShader software device; EXT_disjoint_timer_query_webgl2 was unavailable. Hardware GPU time, GPU utilization and physical-device FPS cannot be established here. The CPU workload column is CDP renderer main-thread TaskDuration over each ~2s sample, not system-wide CPU percentage. Draw calls were instrumented identically in both versions. Frame samples use unthrottled network/CPU after loading, separately from the 4× loading samples. Reduced-motion samples follow a theme toggle, so those rows use the opposite theme from the initial profile name.

| Case | FPS before → after | Median frame ms | p95 frame ms | Main-thread task ms | GL draw calls |
| --- | --- | --- | --- | --- | --- |
| desktop-light / hero | 33.3 → 32.9 | 33.3 → 33.3 | 50.0 → 50.0 | 2098.0 → 2100.9 | 207 → 204 |
| desktop-light / offscreen | 59.7 → 59.6 | 16.7 → 16.7 | 16.8 → 16.8 | 137.6 → 123.6 | 0 → 0 |
| desktop-light / reduced-motion | 60.3 → 60.3 | 16.7 → 16.7 | 16.8 → 16.8 | 95.3 → 124.2 | 0 → 0 |
| desktop-dark / hero | 33.8 → 30.6 | 33.3 → 33.3 | 33.4 → 49.9 | 2066.9 → 2082.4 | 207 → 189 |
| desktop-dark / offscreen | 59.6 → 59.8 | 16.7 → 16.7 | 16.7 → 16.7 | 135.2 → 120.7 | 0 → 0 |
| desktop-dark / reduced-motion | 60.4 → 60.0 | 16.7 → 16.7 | 16.7 → 16.7 | 45.2 → 102.7 | 0 → 0 |
| mobile-light / hero | 60.0 → 59.9 | 16.7 → 16.7 | 16.7 → 16.8 | 1461.9 → 1399.3 | 363 → 363 |
| mobile-light / offscreen | 59.6 → 59.6 | 16.7 → 16.7 | 16.8 → 16.8 | 130.4 → 147.0 | 0 → 0 |
| mobile-light / reduced-motion | 60.0 → 59.6 | 16.7 → 16.7 | 16.7 → 16.7 | 145.9 → 149.7 | 0 → 0 |
| mobile-dark / hero | 59.9 → 59.9 | 16.7 → 16.7 | 16.8 → 16.8 | 1488.7 → 1379.5 | 363 → 363 |
| mobile-dark / offscreen | 59.9 → 59.5 | 16.7 → 16.7 | 16.8 → 16.7 | 135.6 → 132.5 | 0 → 0 |
| mobile-dark / reduced-motion | 59.9 → 60.0 | 16.7 → 16.7 | 16.8 → 16.8 | 143.6 → 147.6 | 0 → 0 |

Offscreen and reduced-motion samples perform no GL draws. The unchanged source retains document visibility gating, observers, pointer listener removal, RAF cancellation, WebGL resource deletion, context loss/restoration, and reduced-motion generation handling. No proven safe rendering optimization was retained; software GPU load is not evidence for changing the visual effect.

## Visual, accessibility and functional checks

- Desktop 1440×1000 Light/Dark full-page comparisons: **0 changed pixels**. Mobile 390×844 pixels above How It Works: **0 changed pixels**. The How section wraps correctly and moves downstream content by the amount required for previously clipped text.
- Deterministic comparisons use reduced-motion and disabled screenshot animations; only the existing internally animated OpenClaw SVG avatar is masked. Normal-motion, unmasked full-page and targeted screenshots are retained below. Full/hero/hover/focus/theme-switch/reduced-motion states and Market/Create/Analytics/Docs captures were inspected locally in all four profiles. The mask is measurement-only; no production animation was changed.
- How copy overflow checks pass at 320, 390, 430 and 760px. Existing overflow at 768 and 1024px is identical to baseline and remains outside the approved mobile fix; expanding it would change tablet/desktop layout.
- Live Chromium accessibility tree exposes meaningful RollText link names; keyboard Enter activates Market and renders its existing route. No physical NVDA/VoiceOver session was performed.
- Both SPA and Docs have one theme meta, correct dark/light values after toggling and cross-tab storage synchronization, and dark body RGB(16,16,16). Saved-theme prepaint and blocked-storage behavior are covered by tests.
- The ChatGPT in-app preview was additionally inspected for manual-review appearance. Quantitative results above are from the consistent WSL harness.
- Landing chat, replyFor, model interactions/demo text, wallet/payment/backend/contracts/databases were not changed. Browser checks used an unconfigured local workspace; no live wallet signing, payment or public-network acceptance is claimed.

| Profile | Full before | Full after | How target |
| --- | --- | --- | --- |
| desktop-light | [Before](desktop-light-before-full.png) | [After](desktop-light-after-full.png) | [Before target](desktop-light-before-how.png) / [After target](desktop-light-after-how.png) |
| desktop-dark | [Before](desktop-dark-before-full.png) | [After](desktop-dark-after-full.png) | [Before target](desktop-dark-before-how.png) / [After target](desktop-dark-after-how.png) |
| mobile-light | [Before](mobile-light-before-full.png) | [After](mobile-light-after-full.png) | [Before target](mobile-light-before-how.png) / [After target](mobile-light-after-how.png) |
| mobile-dark | [Before](mobile-dark-before-full.png) | [After](mobile-dark-after-full.png) | [Before target](mobile-dark-before-how.png) / [After target](mobile-dark-after-how.png) |

## Validation and review

Passed locally: `bun run lint` (0 warnings/errors); `bun run --cwd frontend typecheck`; `bun run typecheck` (frontend + both backend configurations); `bun run test:frontend` (136 tests, includes Vite dev/production Docs serving and meta order/uniqueness); targeted routing suite (20 tests after final image-path decision); `bun run test:backend` (59 + 66 tests); `bun run check:payment-discovery`; `bun run build:frontend`; `git diff --check`; deterministic comparison command. The existing Vite >500kB App chunk advisory remains. No tests were skipped, weakened or removed. Final CI is reported on the Draft PR; local results are not a claim that GitHub jobs passed.

Standards and Spec source reviews found zero actionable issues. An evidence-only commit receives a follow-up whole-diff review. Ponytail/code-simplification review found no safe, necessary complexity cut; no unrelated cleanup was applied. The user-provided scope is the spec source. `docs/agents/issue-tracker.md` is absent; run `/setup-matt-pocock-skills` before future tracker-based Ask Matt flows. It was not required to execute this explicit scope.

Preview 127.0.0.1:4173 is intentionally retained in WSL tmux session `unmet-frontend-perf` for manual review. The temporary baseline preview and all measurement browsers are stopped before delivery. No merge, deployment, VPS access, backend/live-configuration/data modification or transaction occurred.

PNG SHA-256 before: `126a44127d836dfc25cdc59e4fbe4d423791a9d62bfdae2c54612d4484511f35`. After: `93c0715458b93b950906c6f3b782636818da74a5a0559b058ea675f4696fd121`.
