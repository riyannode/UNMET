# Repository cleanup audit

## 2026-10-27 implementation update

- Baseline: clean WSL2 worktree at 691ff4493d9fa5cd9de46865b61070c097685288, branch chore/remove-legacy-vercel-20261027.
- Scope: remove the retired Vercel deployment path, retain payment and proxy guarantees, and align operating documentation with Docker Compose, Bun and Caddy. The earlier 2026-10-23 cleanup below is historical context; its validation does not apply to this change.
- No payment price, asset order, chain mapping, payment state machine, storage guarantees, contract, ABI, wallet workflow or production setting was changed; only the stale SSR metadata fallback origin changed.

| Classification | Finding | Evidence | Change |
| --- | --- | --- | --- |
| SAFE TO REMOVE | backend/vercel.json and frontend/vercel.json | No supported deployment or delivery path depends on either file; frontend docs are built by Vite and served by Caddy. | Removed both files and the obsolete Vite docs test that read the hosting-specific rewrite. Existing Vite/Caddy packaging coverage remains. |
| SAFE TO REMOVE | Platform-specific API identity selector | Caddy is the supported ingress and Express already applies TRUSTED_PROXIES. Platform-header selection bypassed this common trust policy. | Removed selector; use Express req.ip/socket identity. Regressions cover trusted proxy IPv4/IPv6 quotas, malformed forwarded identity and forged headers from untrusted peers. |
| SAFE TO REMOVE | PAYMENT_DB_PATH platform guard | Absolute-path validation is a general storage invariant; platform flags are not part of the runtime. | Retained absolute-path validation and removed the platform exception. |
| SAFE TO REMOVE | VERCEL_ENV production override | NODE_ENV is the runtime production signal; preview-specific override could let a production process bypass the explicit Mainnet billing requirement. | Production now requires explicit X402_CHAIN_ID=196 based on NODE_ENV alone. Legacy strings remain only in negative regression tests. |
| SAFE TO REMOVE | Vercel-only source/config references | Lazy payment middleware, Express app exports, no-storage guard, discovery-before-storage ordering and admission lifecycle are shared runtime behavior. | Removed only hosting-specific configuration and renamed the cached payment middleware promise generically. Shared behavior remains. |
| NEEDS UPDATE / SAFE TO REMOVE | SSR origin and orphan CSS | SSR fallback pointed at retired unmet.vercel.app; exact .jr-hide-scrollbar selectors had no class producer. | Updated the fallback to unmetxyz.my.id and removed the two selectors. Other dynamic landing classes remain. |
| NEEDS UPDATE | Deployment and operations documentation | The supported path is Docker Compose/Caddy; current docs use frontend/docs/index.html and layout-managed routes. | Updated setup, routing, historical framing and operational ownership. Preserved dated payment receipts and useful security/indexing evidence. |
| MUST PRESERVE | Payment, wallet, contract and shared API behavior | Payment prices/assets and state machine, durable SQLite recovery, Express exports, lazy initialization, no-storage guard and discovery-before-storage ordering have active consumers or safety responsibilities. | Kept unchanged. No payment/network/contract/ABI or wallet workflow changed. |

### Retained items

- The negative VERCEL_ENV and x-vercel-forwarded-for regressions deliberately retain legacy strings to prove those values cannot change production requirements or untrusted request identity. The old audit section below predates this change; its retained Vercel configuration entries are superseded.
- .gitignore/.dockerignore .vercel exclusions remain artifact hygiene. Bun lock optional peer metadata can contain Vercel-named packages through live Reown/unstorage dependencies; the lockfile was not edited.
- Historical payment receipts, contract deployment evidence and dated security/indexing findings remain when they document lasting behavior. They are not current deployment or availability proof.
- No further removable module or dependency was proven. Keep the required ethers peer for Reown, dynamic landing class producers, payment operator commands, CI/browser fixtures and tests. Keep frontend/public/unmet-logo.png because external consumers are possible and its lack of internal imports does not establish it is unused.
- The Express default/named exports and lazy payment initialization remain because they are shared/test-consumed interfaces. The no-storage payment guard and discovery-before-storage/facilitator ordering remain intact.

### Reviewed validation — 2026-10-27

Source checks used Bun 1.4.3, Forge 1.8.3 and pinned Solidity dependencies; production images retain Bun 1.4.2 and Caddy 2.11.2.

| Check | Result |
| --- | --- |
| Frozen install; bun run typecheck | Pass; frontend and both backend configurations |
| bun run test:frontend | 130 pass, 0 fail; only the obsolete hosting-config assertion removed |
| bun run test:backend | 59 API/hardening + 66 SQLite/payment tests pass, 0 fail |
| TypeScript --noUnusedLocals --noUnusedParameters | Frontend and both backend configurations pass |
| forge fmt --check; forge build; forge test -vv | Pass; 19 contract tests, 0 fail, 0 skipped |
| bun run build:frontend | Pass; existing large-chunk advisory remains |
| bun run sync:payment-discovery; bun run check:payment-discovery | Pass; published OpenAPI remains byte-identical, Mainnet 196 at $0.01 |
| Isolated docker compose config --quiet and API/web builds | Pass with synthetic inputs; runtime users remain bun and web |
| Packaged API discovery smoke, network disabled, non-root/read-only | Pass; mismatches rejected before storage writes or facilitator calls |
| Packaged API startup/HTTP smoke, network disabled | Synthetic RPC and supported-kinds fixtures: live/health/ready 200, free demands 200 on 1952, unknown API 404, unsigned 402 with three ordered 196 offers at 10000 atomic units; SQLite integrity/WAL pass; no verify/settle calls |
| Packaged Caddy discovery/Docs acceptance | 644 checks pass: article aliases/HEAD/assets, JSON/payment headers, forwarded identity replacement and no proxy retries |
| Web image Caddy validation as UID 10001 | Pass |
| Markdown file/anchor links; shell syntax | 27 Markdown files, 152 relative links and 23 shell blocks pass |
| External Markdown links | 68 URLs returned HTTP 200; no retired deployment host remains linked |
| Historical receipt preservation | No previously recorded 32-byte hexadecimal value removed from Markdown |
| Diff integrity and protected-source comparison | Pass; contracts/ABIs, payment state/store/identity/confirmation/recovery, Compose/Caddy/Dockerfiles, manifests/lockfile and public discovery documents unchanged |

No lint command is defined; no lint pass is claimed. Trailmark 0.7.1 parsed 80 TypeScript/Solidity/Python source files with no parse diagnostics and ran pre-analysis. No SARIF/weAudit input was supplied or tracked, so no augmentation result is claimed. Static graph edges, unresolved calls and unused checks were supporting evidence, never sufficient deletion proof.

Local fixtures establish packaging and regressions, not current public RPC/facilitator acceptance or paid settlement. No paid transaction, deployment, merge, VPS access, production environment/SSH/database/volume change occurred. Test listeners and task-owned containers exited; no persistent validation volume was created. CI results belong to the Draft PR checks, separately from these local results.

---

# Pre-deployment cleanup audit — 2026-10-23

## Baseline and scope

- Repository: `riyannode/UNMET`; native Ubuntu-24.04 WSL2 checkout `/home/acer/projects/UNMET`.
- Fresh branch: `chore/pre-deployment-repository-cleanup`.
- Baseline: `b7bc564eca3420a9419e68a86f58cf40236dea3a`, fetched and matched to remote `main`. GitHub confirmed PR #13 and PR #14 merged. Checkout was clean; no existing user changes were overwritten.
- No applicable repository/ancestor `AGENTS.md`, tracked CI workflow, glossary or ADR was found. Review spec is the cleanup task; contributor standards are in `CONTRIBUTING.md`.
- Inspected frontend/backend, shared primitives, contract tooling/tests, all Markdown, manifests/lockfile, environment template, Docker/Compose/Caddy, Vercel entrypoints and package commands.

Reachability combined a Bun-parsed import/export inventory (68 baseline / 67 remaining TS/TSX modules), repository-wide symbol references, call-site inspection, TypeScript unused checks, HTML/test roots, lazy React routes, dynamic Reown/storage imports, SDK callbacks, CSS class producers and CLI/deployment entrypoints. No removal rests on static imports alone. No tests, public assets, Solidity, ABI entries, deployed addresses, payment/index state machines, proxy behavior or signing/recovery implementation were removed or rewritten.

## Removed module/dependencies/setting

| Item | Reason | Evidence | Action |
| --- | --- | --- | --- |
| frontend/NetworkBackground.tsx | Unreachable renderer | No route, HTML, dynamic import, fixture, registry, build or deployment entrypoint loads it; landing renders MagicRings. | Deleted |
| three; @types/three | Renderer-only dependencies | NetworkBackground was sole Three/GLTF consumer; no remaining runtime/type/script/deployment use. | Removed; Bun lock regenerated |
| Six orphan transitive packages | Only @types/three needed them | Bun pruned @dimforge/rapier3d-compat, @tweenjs/tween.js, @types/stats.js, @types/webxr, fflate, meshoptimizer; no remaining version changes. | Lock entries removed |
| VITE_NETWORK_SCENE_URL | Only unreachable renderer read it | Removed .env.example entry, Docker ARG, Compose build arg and Vite declaration. Current documentation was updated. | Removed wiring |

## Removed declarations

Baseline line numbers below; remaining lines shift after deletion.

| Item | Reason | Evidence | Action |
| --- | --- | --- | --- |
| frontend/App.tsx: short (L1610) | Unreachable internal declaration; no consumer or runtime registration. | short is local and unexported; tsc noUnusedLocals confirms declaration-only. Independent same-name helpers elsewhere remain. | Removed |
| frontend/components/ui/avatar.tsx: Avatar (L5); AvatarImage (L25); AvatarFallback (L38); AvatarBadge (L54) | Unreachable internal declaration; no consumer or runtime registration. | App imports only AvatarGroup/AvatarGroupCount; only these two are rendered. | Removed |
| frontend/components/ui/breadcrumb.tsx: BreadcrumbEllipsis (L94) | Unreachable internal declaration; no consumer or runtime registration. | ReuiAppShell imports explicit breadcrumb names; Ellipsis has no consumer. | Removed |
| frontend/components/ui/bubble.tsx: BubbleGroup (L7); bubbleReactionsVariants (L87); BubbleReactions (L107) | Unreachable internal declaration; no consumer or runtime registration. | CreateDemandChat imports only Bubble/BubbleContent; reactions variant is private to removed BubbleReactions. | Removed |
| frontend/components/ui/card.tsx: CardAction (L58); CardFooter (L81) | Unreachable internal declaration; no consumer or runtime registration. | App and Analytics import explicit active names; no CardAction/CardFooter consumers. | Removed |
| frontend/components/ui/dropdown-menu.tsx: DropdownMenuPortal (L12); DropdownMenuSub (L98); DropdownMenuSubTrigger (L102); DropdownMenuSubContent (L126); DropdownMenuCheckboxItem (L147); DropdownMenuSeparator (L222); DropdownMenuShortcut (L235) | Unreachable internal declaration; no consumer or runtime registration. | App uses explicit root/trigger/content/group/label/item/radio imports. Content keeps its own primitive portal. | Removed |
| frontend/components/ui/empty.tsx: emptyMediaVariants (L27); EmptyMedia (L42) | Unreachable internal declaration; no consumer or runtime registration. | App uses Empty/Header/Title/Description/Content; emptyMediaVariants belongs only to removed EmptyMedia. | Removed |
| frontend/components/ui/input-group.tsx: inputGroupButtonVariants (L68); InputGroupButton (L86); InputGroupTextarea (L135) | Unreachable internal declaration; no consumer or runtime registration. | App uses InputGroup/Addon/Text/Input; removed Button/Textarea wrappers and button variant have no consumer. | Removed |
| frontend/components/ui/sheet.tsx: SheetTrigger (L12); SheetClose (L16); SheetFooter (L91) | Unreachable internal declaration; no consumer or runtime registration. | Sidebar uses Sheet/Content/Header/Title/Description; live content keeps its primitive Close and internal portal. | Removed |
| frontend/components/ui/sidebar.tsx: SidebarRail (L280); SidebarInput (L318); SidebarGroupLabel (L393); SidebarGroupAction (L417); SidebarMenuAction (L553); SidebarMenuBadge (L583); SidebarMenuSkeleton (L600); SidebarMenuSub (L638); SidebarMenuSubItem (L652); SidebarMenuSubButton (L666) | Unreachable internal declaration; no consumer or runtime registration. | ReuiAppShell imports explicit active sidebar names; no removed named wrappers have consumers. | Removed |
| frontend/contract.ts: readDemandOnChain (L484); readBoard (L520); explorerAddress (L803) | Unreachable internal declaration; no consumer or runtime registration. | App uses readBoardSnapshot/synchronizeMarketBoard; readDemandWithClient remains behind the snapshot interface. explorerTx remains used. Test imports inspected. | Removed |
| App statusName import; detail-route lastTx binding | Unread bindings | Baseline tsc diagnostics L36/L1030; live statusName implementation and lastTx state/display retained. | Bindings removed |
| CreateDemandChat buildTurns step parameter/argument | Never read | Baseline tsc diagnostic L110; turns use answers/editingField only. | Parameter and call arg removed |

## Export-only cleanup

Internally used declarations remain. Only unused export modifiers/aliases removed; every application/test-consumed export preserved.

| File | Export removed | Action |
| --- | --- | --- |
| frontend/analytics.ts | AnalyticsStatusCount | remove unused export modifier; internally used declaration retained |
| frontend/analytics.ts | GlobalAnalytics | remove unused export modifier; internally used declaration retained |
| frontend/components/ui/prompt-input.tsx | PromptInputStatus | remove unused export modifier; internally used declaration retained |
| frontend/components/ui/prompt-input.tsx | PromptInputProps | remove unused export modifier; internally used declaration retained |
| frontend/contract.ts | ensureChain | remove unused export modifier; internally used declaration retained |
| frontend/contract.ts | statusName | remove unused export modifier; internally used declaration retained |
| frontend/contract.ts | sortDemandsByFunding | remove unused export modifier; internally used declaration retained |
| frontend/contract.ts | MarketBoardSnapshot | remove unused export modifier; internally used declaration retained |
| frontend/contract.ts | MarketSyncResult | remove unused export modifier; internally used declaration retained |
| frontend/create-demand-chat-model.ts | PricingAnswer | remove unused export modifier; internally used declaration retained |
| frontend/create-demand-chat-model.ts | CreatedDemandMatch | remove unused export modifier; internally used declaration retained |
| frontend/transaction-lifecycle.ts | TransactionFailureState | remove unused export modifier; internally used declaration retained |
| frontend/transaction-lifecycle.ts | PendingTransactionState | remove unused export modifier; internally used declaration retained |
| frontend/transaction-lifecycle.ts | TransactionUpdate | remove unused export modifier; internally used declaration retained |
| frontend/transaction-lifecycle.ts | transactionStorageKey | remove unused export modifier; internally used declaration retained |
| frontend/components/reui/badge.tsx | export { Badge, badgeVariants, type BadgeProps } | remove unused export alias; implementation retained |
| frontend/components/ui/button.tsx | export { Button, buttonVariants } | remove unused export alias; implementation retained |
| frontend/components/ui/tabs.tsx | export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants } | remove unused export alias; implementation retained |
| frontend/components/ui/prompt-input.tsx | export default PromptInput; | remove unused export alias; implementation retained |

## Legacy CSS

Removed only exact selector arms in `frontend/app.css` with no JSX, runtime class construction, fixture or current UI producer. Current navigation is `components/examples/c-sidebar-1.tsx`; creation is `CreateDemandChat.tsx`.

| Item | Reason | Evidence | Action |
| --- | --- | --- | --- |
| `.network-background` and canvas/overlay/responsive rules | Only unreachable renderer produced the class | Deleted renderer; landing uses MagicRings | Removed |
| `.app-shell`, `.nav-rail`, `.rail-brand`, `.brand-mark`, `.rail-nav`, `.nav-item`, `.rail-note`, `.signal-dot`, `.app-main` | Superseded navigation | Explicit current ReUI slot/classes; no old class producer | Removed exact rules/arms |
| `.topbar`, `.network`, `.topbar-actions`, `.wallet-box`, `.refresh`, `.wallet-connect`, `.wallet-connect-mark`, `.wallet-connect-chevron` | Old controls are not rendered | Current controls use different classes; words appearing as variables/messages are not class consumers | Removed exact rules/arms |
| `.market-main`, `.create-panel`, `.demand-id`, `.create-form`, `.create-core`, `.create-terms`, `.form-section-heading`, `.create-submit` | Superseded layout/form | Current routed views/chat never produce these tokens | Removed exact rules/arms |

Shared live rule bodies and arms such as `.panel`, `.workspace`, `.board-title`, `.unit`, `.workflow-summary` and `.legacy-content` remain. Empty obsolete media block removed. Browser comparison below checks representative active rendering after CSS/Tailwind pruning.

## Documentation

| Item | Reason | Evidence | Action |
| --- | --- | --- | --- |
| `docs/errors.md` | Split payment reference duplicated error ownership | Combined all payment rows with API/wallet/contract errors | Deleted after consolidation into `docs/ERRORS.md`; canonical links use uppercase path |
| README/database and network descriptions | No-persistent-database claim predates PR #14 | Compose payment volume and `payment-store.ts`; independent network resolver | Clarified escrow authority, operational SQLite, Testnet market and Mainnet billing |
| Architecture/API | Missing storage/health routes and wrong settle-before-execution order | `server.ts`, `durable-payment.ts`, actual Express SDK buffering and tests | Updated diagram, deployment paths, route/schema/status/header details and no-replay limits |
| Self-hosting/recovery | Rollback/no-database prose and unscoped performance evidence | Schema v1, named volume, WAL/FULL and dated PR #14 report | Corrected rollback/storage language; linked historical disk measurement |
| Runbook | Bare env loading, omitted frontend tests, shell placeholder | Actual package scripts; isolated Bun env-loading probe; `bash -n` | Root-relative env/entrypoint commands, full check list, executable release-commit prompt |
| `docs/DESIGN.md` (formerly `frontend/DESIGN.md`) / PRD | Dark Three.js/form brief no longer matches current routes/theme | Light ReUI app, guided chat and styles | Replaced obsolete design reference; corrected PRD routes/storage without UI changes |
| `CONTRIBUTING.md` / `docs/README.md` | No contributor entrypoint/categories | Actual commands and runtime requirements | Added setup, offline checks, local Compose, PR standards and reference/operations/history index |

Historical records retained: all of STATUS's original September facts/dates/receipts, DEMO, SUBMISSION, OKX_PAYMENT_DEBUG, SELF_HOSTING_VALIDATION, PAYMENT_VERIFICATION, the submission video/URLs, frontend attribution and `.hallmark` records. Added explicit historical/version framing; did not relabel old verification as October release evidence or assert that an old endpoint is live. No historical evidence file moved or deleted.

Files deleted: `frontend/NetworkBackground.tsx`, `docs/errors.md`. Direct dependencies removed: `three`, `@types/three`; six orphan lock entries pruned, with no upgrades. No other manifest/script/config removal had sufficient evidence.

## Validation

Tools: source Bun 1.4.3, Forge 1.8.3 / Solidity 0.8.37, Docker 29.7.2 / Compose 5.5.1; production images retain pinned Bun 1.4.2 and Caddy 2.11.2.

| Check | Before | After |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Pass | Pass |
| `bun run test:backend` | 41 API/hardening + 35 native SQLite/durable tests pass | Same 76 pass; no deletion/skip/assertion changes |
| `bun run test:frontend` | 100 pass / 282 assertions | Same 100 pass / 282 assertions |
| `bun run typecheck` | Both backend configurations + frontend pass | Pass |
| `bun run test:contract` | 19 pass, 0 skipped | Same 19 pass, 0 skipped |
| `bun run build:frontend` | Pass; existing >500 kB chunk advisory | Pass; same advisory |
| `bun run check` | Individual commands above | Full aggregate passes |
| `tsc --noEmit --noUnusedLocals --noUnusedParameters` | Four frontend unused diagnostics; backend clean | Frontend and both backend configurations pass |
| Compose config and production API/web image builds | Baseline source checks; earlier Docker evidence remains dated separately | `docker compose -p unmet-cleanup-20261023 config --quiet` and `build` pass |
| Local Caddy/API smoke | Not rerun before deletion | Eight SPA paths, three health probes, demands 200, JSON API 404, official unpaid 402 pass |
| Unpaid official challenge | No signed test | x402 v2, exact, eip155:196, amount 10000, mainnet USD₮0; actual official client |
| Docker persistence | Native baseline regressions pass | Synthetic in-flight operation survives API recreate as UNKNOWN; duplicate reserve blocked; integrity passes |
| Runtime storage/ingress | Existing configuration inspected | API bun/non-root/read-only/no published port; directory 0700 and DB/WAL/SHM 0600; Caddy localhost only |
| Browser comparison | Saved original production dist | Seven routes at widths 1440 and 390: identical body text, selected element geometry/computed style, zero page errors |
| Existing real React session-race fixture | Historical evidence retained | PASS: Suspense/create/verify/refresh isolation, reconnect renewal and draft preservation; no transactions |
| Markdown links / command syntax | Inspected source paths and commands | 21 Markdown files, 83 relative file/anchor links, 24 shell blocks: no broken local links or shell syntax failures |
| External links | Historical URLs retained | 25 URL variants checked with HTTP HEAD: 21 returned 200; four variants across three historical Vercel hosts returned 404, now explicitly labelled historical |
| Secret scan | No credentials printed | 176 source/build/log files and 33 saved-image blobs/layers checked against configured private values and encodings; source private-key/assignment patterns checked; zero findings |
| Diff integrity | Clean baseline | `git diff --check` passes; no tests, protected backend, Caddy or Vercel configuration changed |

A separate clean source copy without any `.env` or OKX environment variables also passed all 76 backend tests, confirming credential-free regression commands.

Browser comparison used blocked external network requests for deterministic error/empty UI; it is not live chain/provider/wallet acceptance. Landing static delivery is covered by Docker smoke; no pixel-equivalence claim is made for animated landing content.

The first Docker smoke harness inherited a Windows Bun shim and exited 127 before the smoke script ran. Re-running the harness in the WSL login shell selected Linux Bun and passed all checks; no application fix was needed. All reported final runtime checks used Linux Bun.

## Retained candidates and limits

- `frontend/public/unmet-logo.png` has no internal reference but a historical public URL may have outside consumers. It differs from `/logos/unmet.png`; retained, not called a duplicate.
- `ethers` is a required peer of the active Reown Ethers adapter. Other dependencies have runtime, CSS, build or type consumers. MagicRings/animejs/framer-motion/tw-animate-css remain live.
- Backend admin/payment-debug/payment-ops/start, unpaid smoke/load scripts, Vercel configs, active Input/Textarea/Skeleton, browser race fixtures and all security/payment tests are entrypoints/consumers, not dead code.
- Native AppKit disconnect-pending coverage and live paid settlement/finality/resource delivery remain separate acceptance work. No signed x402 request, onchain write, public deployment, production setting, DNS/firewall, merge or existing payment volume change occurred.
- No lint script or CI workflow exists; no lint/CI pass is claimed. The optional Matt issue-tracker configuration is absent; this task's supplied specification was used directly, without adding repository tooling.

Temporary Docker project, its containers/network and only its three newly-created labelled fixture volumes were removed. Existing volumes were preserved. Browser and recorded Vite process group exited; validation ports were confirmed closed. Reusable build images and private ignored `.env` were retained.
