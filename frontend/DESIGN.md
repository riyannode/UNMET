# Frontend design conventions

The current sources are `main.tsx`, `App.tsx`, `CreateDemandChat.tsx`, `components/examples/c-sidebar-1.tsx` and their styles. This reference replaces the older dark workspace / Three.js network-background brief; that renderer is no longer mounted.

## Routes and structure

The landing page at `/` uses `UnmetLanding`, `MagicRings`, `UnmetHowItWorks`, `UnmetNavigation` and `UnmetFooter`. `/docs` is a Coming Soon page. App routes share the ReUI sidebar: `/market`, `/market/:demandId`, `/create-demand`, `/analytics`. `/my-activity` redirects to Analytics. See [product behavior](PRODUCT.md).

Demand details keep Request Details, Escrow & Support, and Builder Proposal together. The create route uses a deterministic guided chat and six-term review. Preserve wallet session, receipt/readback, pending recovery, error, empty and loading behavior.

## Tokens and components

`app.css` scopes the light app theme to `.unmet-app-shell`: white background/card/sidebar, `#192800` foreground/primary, `#dbffa6` accent and `#52663b` muted foreground. Reuse existing semantic variables, ReUI/Base UI primitives and components. Inter Tight is the app text font; addresses and transaction values use existing numeric/monospace styles. Landing typography/styles live in the `unmet-*.css` files.

Legacy selectors still style active demand content. A legacy-looking selector or filename is not evidence that it can be removed.

## Interaction and acceptance

Preserve responsive sidebar/sheet behavior, keyboard focus, semantic labels, announced transaction states, and access to every demand tab/action on narrow screens. Respect reduced-motion handling in existing animations. MagicRings and landing anime.js/framer-motion animations remain active; there is no optional GLB scene setting.

Frontend changes should verify desktop and mobile layout, keyboard access, loading/error/empty states and wallet receipt/recovery behavior. The [contributor guide](../CONTRIBUTING.md) lists automated tests and the real React session-race fixture. Visual checks alone do not prove signing or production wallet acceptance.
