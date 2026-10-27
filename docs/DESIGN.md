# Frontend design conventions

The current sources are `frontend/main.tsx`, `frontend/App.tsx`, `frontend/CreateDemandChat.tsx`, `frontend/components/examples/c-sidebar-1.tsx` and their styles. This reference replaces the older dark workspace / Three.js network-background brief; that renderer is no longer mounted.

## Routes and structure

The landing page at `/` uses `UnmetLanding`, `MagicRings`, `UnmetHowItWorks`, `UnmetNavigation` and `UnmetFooter`. `/docs` serves the public API documentation from `frontend/docs/index.html`. App routes share the ReUI sidebar: `/market`, `/market/:demandId`, `/create-demand`, `/analytics`. See [product behavior](PRODUCT.md).

Demand details keep Request Details, Escrow & Support, and Builder Proposal together. The create route uses a deterministic guided chat and six-term review. Preserve wallet session, receipt/readback, pending recovery, error, empty and loading behavior.

## Tokens and components

`frontend/app.css` scopes the light app theme to `.unmet-app-shell`: white background/card/sidebar, `#192800` foreground/primary, `#dbffa6` accent and `#52663b` muted foreground. Reuse existing semantic variables, ReUI/Base UI primitives and components. Inter Tight is the app text font; addresses and transaction values use existing numeric/monospace styles. Landing typography/styles live in the `frontend/unmet-*.css` files.

`frontend/theme.css` owns shared light defaults and dark overrides and is loaded by the SPA and every docs page. Keep the `--unmet-theme-*` names centralized there: `page` (`#101010`), `surface` (`#191919`), `surface-raised` (`#202020`), `text` (`#ededed`), `muted` (`#bcbcbc`), `subtle` (`#a8a8a8`), `border` (`#353535`), `accent` (`#dfffad`), `accent-text` (`#18210f`), `interactive` (`#a4cc7a`), `success` (`#93d4a8`), `warning` (`#e4c77e`) and `error` (`#f09595`). The Tailwind/ReUI dark aliases are also owned in `theme.css`; their `html[data-theme="dark"]:root` selector overrides the app's light `:root:has(...)` values. The `green-text` alias remains for existing app selectors. The theme controller and prepaint bootstrap own preference application and prepaint only; component colors belong to their component stylesheets, including `frontend/create-demand-chat.css` for Create-specific states. Put new palette values in `theme.css`, then consume them from `.css` files rather than adding local copies.

Dark theme exceptions stay scoped: landing gradients and glow treatment live in `unmet-landing.css`, “How it works” colors and monochrome avatar filters in `unmet-how-it-works.css`, footer colors in `unmet-footer.css`, and app routes in `app.css`. Preserve original light gradients, images, and animation behavior. Apply logo filters only to monochrome assets; retain multicolor artwork unchanged.

Landing typography uses `Satoshi Headings` at 500 for “Agent Demand Market” and 600 for “What AI Agents Need?” and “From Request to Funding”. The original `Satoshi` 700 face remains isolated for the UNMET wordmark; do not replace it with the variable face. Sizes, line heights and responsive rules stay in the owning landing/How stylesheets. The heading alias references the original, unmodified Fontshare variable WOFF2 with a 300–900 weight axis and `font-display: swap`; its internal default weight is 900, so always specify the approved CSS weight.

Keep the existing Fontshare CDN delivery and sans-serif fallback. [ITF Free Font License 2.0](https://www.fontshare.com/licenses/itf-ffl) permits website use and self-hosting, but CDN availability is not guaranteed. The current approach avoids bundling or altering font software and retains the original wordmark resource. If CSP is introduced, allow the Fontshare stylesheet and font origins (`api.fontshare.com`, `cdn.fontshare.com`) alongside the existing Google font origins; account for the prepaint bootstrap separately. Revalidate rendered fonts, fallback and layout after any hosting change.

The ecosystem marquee uses the unmodified transparent USDC token SVG from [Circle’s brand kit](https://www.circle.com/pressroom#brand-kit) and USDG token PNG from [Global Dollar’s brand resources](https://globaldollar.com/brand). Their adjacent text inherits the theme foreground; keep the official icon colors, existing track spacing and animation.

The `.unmet-workspace-content` selectors style active demand content. Preserve the selectors and their scope when changing workspace styles.

## Interaction and acceptance

Preserve responsive sidebar/sheet behavior, keyboard focus, semantic labels, announced transaction states, and access to every demand tab/action on narrow screens. Respect reduced-motion handling in existing animations. MagicRings and landing anime.js/framer-motion animations remain active; there is no optional GLB scene setting.

## Responsive acceptance

- Check desktop layouts at 1440px and 1920px, tablet, and mobile at 320–430px. Prevent page-level horizontal overflow at 320px; wrap or truncate long capabilities and addresses within their cells.
- Preserve the responsive sidebar/sheet navigation and stack fields or controls where needed on narrow screens. Keep all demand tabs, actions and explorer links reachable, and retain visible labels for market values in mobile rows.
- Maintain 44px minimum touch targets for main navigation and mobile actions. State, error and recovery information must remain readable without relying on hover.

## Accessibility acceptance

Retain WCAG 2.2 AA as an acceptance target, not a claim of verified compliance. Normal body text and control labels should have at least 4.5:1 contrast. Keep visible keyboard focus, semantic headings/tables, persistent field labels, accessible button names, live status announcements, keyboard-operable navigation/actions and a skip link. Communicate status with text as well as color.

Decorative backgrounds must not capture pointer or keyboard input. Reduced-motion mode must suppress ornamental motion while preserving usable state feedback; animations must not delay controls or imply invented market activity.

Acceptance checks should cover keyboard-only navigation, focus visibility, contrast, field labels and announced loading/error/transaction states on desktop and mobile. These rules preserve the earlier accessibility/mobile requirements without restoring its obsolete renderer, theme or layout.

Frontend changes should verify desktop and mobile layout, keyboard access, loading/error/empty states and wallet receipt/recovery behavior. The [contributor guide](../CONTRIBUTING.md) lists automated tests and the real React session-race fixture. Visual checks alone do not prove signing or production wallet acceptance.
