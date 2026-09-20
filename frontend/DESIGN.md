# UNMET — Market workbench

## Direction
A wide, left-anchored market workspace for funders and builders. Warm paper, dark ink, restrained green, and a translucent ambient wash that blends into the canvas. Figtree variable for interface typography; system monospace only for addresses and identifiers. Hierarchy comes from spacing, alignment and soft tonal surfaces instead of connector rules. No marketing hero, line art, simulated market data or card gallery.

## Layout
32px desktop outer inset, full available width. Persistent horizontal navigation. Demand rows compare capability, escrow, calls, wallets, price and status on soft tonal bands. A selected demand opens an inline right context panel; at tablet widths it moves below the board. Create uses a wide operational split between capability/specification and parameters; activity reuses the ledger rows. Mobile reflows fields without removing actions.

## References inspected
- https://reui.io/components — data-grid hierarchy, aligned columns, explicit interactive states and compact controls.
- https://www.awwwards.com/websites/ — typography and consistent editorial grouping from the directory; no single portfolio style copied.
- https://saffron-griflan.netlify.app/ — metric hierarchy, separated sections and financial table labels. Exclude its marketing-length content and illustrative treatment.
- https://gdrinkme.com/ — assertive brand typography and short navigation. Exclude product imagery, large promotional compositions and decorative movement.
- https://animejs.com/ — use the official v4 API for a low-contrast ambient drift and short lifecycle-scoped reveals.

## Motion and access
Anime.js adds a slow, low-contrast ambient background drift and short row/context-panel entrances. The background motion never captures input and is disabled for reduced-motion preferences; entrance animations are canceled on unmount. Visible keyboard focus, semantic buttons, persistent field labels and live status feedback. Smooth in-page scrolling only when motion is permitted.

## Boundaries
Do not modify contract.ts, ABI, contract/backend behavior or network configuration. Preserve real data and all existing transaction functions. Local browser validation never broadcasts transactions.
