# Frontend design conventions

The current sources are `frontend/main.tsx`, `frontend/App.tsx`, `frontend/CreateDemandChat.tsx`, `frontend/components/examples/c-sidebar-1.tsx` and their styles. This reference replaces the older dark workspace / Three.js network-background brief; that renderer is no longer mounted.

## Routes and structure

The landing page at `/` uses `UnmetLanding`, `MagicRings`, `UnmetHowItWorks`, `UnmetNavigation` and `UnmetFooter`. `/docs` is a Coming Soon page. App routes share the ReUI sidebar: `/market`, `/market/:demandId`, `/create-demand`, `/analytics`. See [product behavior](PRODUCT.md).

Demand details keep Request Details, Escrow & Support, and Builder Proposal together. The create route uses a deterministic guided chat and six-term review. Preserve wallet session, receipt/readback, pending recovery, error, empty and loading behavior.

## Tokens and components

`frontend/app.css` scopes the light app theme to `.unmet-app-shell`: white background/card/sidebar, `#192800` foreground/primary, `#dbffa6` accent and `#52663b` muted foreground. Reuse existing semantic variables, ReUI/Base UI primitives and components. Inter Tight is the app text font; addresses and transaction values use existing numeric/monospace styles. Landing typography/styles live in the `frontend/unmet-*.css` files.

Legacy selectors still style active demand content. A legacy-looking selector or filename is not evidence that it can be removed.

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
