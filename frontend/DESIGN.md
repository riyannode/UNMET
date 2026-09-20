# UNMET — Market workbench

## Direction
A wide, left-anchored market workspace for funders and builders. Warm paper, dark ink, restrained green. Figtree variable for interface typography; system monospace only for addresses and identifiers. Compact rules, square controls and tabular numbers. No marketing hero, decorative art, simulated market data or card gallery.

## Layout
32px desktop outer inset, full available width. Persistent horizontal navigation. Demand rows compare capability, escrow, calls, wallets, price and status. A selected demand opens an inline right context panel; at tablet widths it moves below the board. Create uses a two-column operational form; activity reuses the ledger rows. Mobile reflows fields without removing actions.

## References inspected
- https://reui.io/components — data-grid hierarchy, aligned columns, explicit interactive states and compact controls.
- https://www.awwwards.com/websites/ — typography and consistent editorial grouping from the directory; no single portfolio style copied.
- https://saffron-griflan.netlify.app/ — metric hierarchy, separated sections and financial table labels. Exclude its marketing-length content and illustrative treatment.
- https://gdrinkme.com/ — assertive brand typography and short navigation. Exclude product imagery, large promotional compositions and decorative movement.
- https://animejs.com/ — use the official v4 animation API for short lifecycle-scoped reveals; no perpetual animation.

## Motion and access
Anime.js row entrance and contextual-panel entrance, 220–320ms. Cancel on unmount. Reduced-motion preference disables motion. Visible keyboard focus, semantic buttons, persistent field labels, live status feedback. Smooth in-page scrolling only when motion is permitted.

## Boundaries
Do not modify contract.ts, ABI, contract/backend behavior or network configuration. Preserve real data and all existing transaction functions. Local browser validation never broadcasts transactions.
