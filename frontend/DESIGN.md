# UNMET design system

Adapted from reference-derived design guidance for UNMET. This is not a copy of the source product's identity or layout.

## 1. Context and goals

UNMET is the market for what agents need but cannot buy yet. The frontend helps builders find funded demand, lets requesters create a market signal, and gives supporters a place to review and fund it. It is an operational market-intelligence interface, not a marketing site or a trading terminal.

Prioritize funded demand, capability, escrow, expected calls, supporting wallets, max unit price, status, candidate builder, approval/rejection progress, and eligible refund/finalization actions. Preserve actual chain data, wallet behavior, receipt-before-success handling, readback, explorer links, and all existing transaction semantics.

## 2. UNMET semantic tokens

Use semantic tokens from `app.css`; do not scatter one-off palette values through components.

| Role | Token | Current value |
| --- | --- | --- |
| Deep canvas | `--background-deep` | `#070b12` |
| Base canvas | `--background-base` | `#0a111b` |
| Default surface | `--surface-default` | `#101a28` |
| Elevated surface | `--surface-elevated` | `#152131` |
| Selected surface | `--surface-selected` | `#142640` |
| Primary text | `--text-primary` | `#e8eef8` |
| Secondary text | `--text-secondary` | `#bdc9da` |
| Muted text | `--text-muted` | `#95a4b9` |
| Inverse text | `--text-inverse` | `#06101b` |
| Primary signal | `--signal-primary` | `#91bdff` |
| Signal glow | `--signal-glow` | `#d8eaff` |
| Success | `--signal-success` | `#75d5ac` |
| Warning | `--signal-warning` | `#eac878` |
| Danger | `--signal-danger` | `#f18f96` |
| Default border | `--border-default` | `#253449` |
| Strong border | `--border-strong` | `#5779a5` |

Blue is reserved for current selection and primary actions. Green, amber, and red communicate state. Keep non-selected surfaces low contrast without lowering text contrast.

## 3. Layout system

The desktop shell is a left-anchored two-column grid: a 184px workspace rail and a flexible market workspace. The shell fills the viewport width up to an 1880px left-aligned safety cap; it is never centered with auto margins. At 1440px, content begins within 24px of the left edge and uses the remaining workspace for the market table or the selected Demand view.

Use a compact sticky top bar for X Layer, refresh, and wallet controls. Keep the demand board as a wide comparison table. Selecting a demand from Demand Board or My Activity opens a dedicated Demand view in the workspace, with Overview, Fund, and Build & Review tabs. Keep all demand-specific actions in that view and retain a back action to the originating page. Create Demand is an operational split form. My Activity is an event ledger, not a card gallery.

## 4. Typography

Use Figtree Variable for interface text. Use the system monospace stack only for addresses, demand IDs, transaction hashes, and tabular numeric values. Keep the scale compact and stable: section titles about 23px, body and controls 11–13px, supporting labels 10–11px. Numeric columns use tabular figures. Long capabilities and addresses wrap or truncate without pushing the grid wider.

## 5. Components and states

- **Workspace navigation:** visible labels, consistent icons, clear selected, hover, focus, and disabled states.
- **Demand board:** capability, committed amount, expected calls, wallets, max price, and status remain comparable in aligned columns. Mobile rows expose the same values with visible labels.
- **Demand view:** Overview contains request and market information; Fund contains escrow, the connected wallet's commitment, and funding/refund controls; Build & Review contains proposal information, vote progress, and eligible lifecycle actions.
- **Create form:** persistent labels, native input behavior, bounded text lengths, visible focus, and clear submit state.
- **Activity ledger:** role, demand, escrow, and effective status remain scannable as a chronological-style record.
- **Wallet and network:** Reown AppKit remains the configured wallet UI; X Layer chain ID remains visible.
- **Status and transaction feedback:** preserve loading, empty, error, pending, success, transaction hash, explorer link, and readback failure states.
- **Controls:** define default, hover, focus-visible, active, disabled, loading, and error behavior where the state exists. Do not imply a successful write before receipt and readback.

## 6. Interaction and motion

Use anime.js for orchestration only: a restrained ambient camera/group drift and short row or demand-view transitions. Three.js is the renderer. Keep transitions around 150–250ms and never delay task controls.

The background is an `aria-hidden`, pointer-transparent canvas. It loads an optional Blender-exported GLB from `VITE_NETWORK_SCENE_URL`; until one is provided, a deterministic procedural node-and-edge field renders as the fallback. If WebGL or the optional GLB is unavailable, keep the product usable and retain the fallback or plain canvas. Do not fetch a model when the URL is unset.

Respect `prefers-reduced-motion`: stop the animation loop and anime.js drift, render one static scene, and keep UI state feedback usable. Pause rendering when the document is hidden. Do not add motion to convey invented market activity.

## 7. Responsive rules

- **Wide desktop:** left rail and flexible board or selected Demand view; retain the left anchor at 1440px and 1920px.
- **Tablet:** keep the rail while space allows and simplify the create form to one main column.
- **Mobile:** move navigation above the workspace, stack form fields, and render demand entries as labeled rows. Keep all Demand view tabs, actions, and explorer links reachable. Maintain 44px minimum targets for the main navigation and mobile actions.
- Avoid horizontal page overflow at 320px. Long strings wrap within their own cells.

## 8. Accessibility acceptance

Target WCAG 2.2 AA. Maintain at least 4.5:1 contrast for body text and controls, visible keyboard focus, semantic headings and tables, labeled fields, accessible button names, live status announcements, keyboard-operable navigation/actions, a skip link, and reduced-motion behavior. The background must never capture pointer or keyboard input.

## 9. Anti-patterns

- Centered narrow containers, giant hero blocks, or symmetric empty desktop margins.
- Code wallpaper, decorative grid overlays, bright centered blobs, or high-opacity network lines.
- Repeated cards for every section, marketing-length helper copy, or duplicated labels.
- Neon/purple crypto glow, large gradients, glass panels, decorative shadows, or status color without meaning.
- Animation that obscures data, moves continuously under reduced motion, or delays interaction.
- Fake market data, fabricated activity, or visual claims unsupported by chain state.

## 10. QA checklist

- [ ] At 1440px and 1920px, the shell is left-anchored and the market workspace uses the available width.
- [ ] At tablet and 320–430px widths, no page-level horizontal overflow occurs and every action remains reachable.
- [ ] Real demand values and status states remain visible; loading, empty, and error states remain understandable.
- [ ] Wallet connect, chain state, receipt/readback behavior, and explorer links are unchanged.
- [ ] The background cluster stays left/upper-left, subdued, transparent, and behind readable UI.
- [ ] Optional GLB loading works without making the GLB a requirement; the procedural fallback works without external assets.
- [ ] Reduced-motion mode produces a static scene and no ornamental drift.
- [ ] Focus, contrast, form labels, and live status feedback remain accessible.
- [ ] No contract, backend, API, approval, rejection, refund, x402, or chain configuration behavior changed.
