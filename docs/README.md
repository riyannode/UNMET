# Documentation

Coding agents start with [AGENTS](../AGENTS.md). Repository setup and validation start in [CONTRIBUTING](../CONTRIBUTING.md). The website's `/docs` route is currently a Coming Soon page; the technical documentation lives here.

## Current reference

- [Product requirements](PRD.md): implemented demand model and explicitly future roadmap.
- [Architecture](ARCHITECTURE.md): chain authority, index, two network contexts and deployment paths.
- [API](API.md): public/paid routes, schemas and response behavior.
- [Frontend product](PRODUCT.md) and [design conventions](DESIGN.md).
- [Cleanup audit](CLEANUP_AUDIT.md): removal evidence, retained candidates and validation for the October cleanup.

## Operations and security

- [Self-hosting](SELF_HOSTING.md): Compose configuration, Caddy routing, bounded work and rollback.
- [Payment recovery](PAYMENT_RECOVERY.md): single-replica SQLite, duplicate protection, reconciliation and backups.
- [Errors](ERRORS.md): canonical API, payment, wallet and contract error reference.
- [Runbook](RUNBOOK.md): contract acceptance procedures and dated deployment records; execution requires its own authorization.
- [Wallet disconnect](WALLET_DISCONNECT.md): session transitions, regression fixture and native AppKit limitation.

## Historical evidence

These reports describe their recorded commits/dates, not guaranteed current endpoints or latest-release acceptance.

The cleanup's 2026-10-23 link check returned HTTP 404 for the three historical Vercel hosts. Their URLs remain in dated evidence; use local setup/self-hosting instructions for the current source.

- [Status](STATUS.md): September hackathon/deployment receipts and verification gaps; current implementation overview is separate at the top.
- [Self-hosting validation](SELF_HOSTING_VALIDATION.md): PR #13 local build/container and trust/admission evidence.
- [Payment verification](PAYMENT_VERIFICATION.md): PR #14 SQLite and deterministic payment regressions, with live-payment limits.
- [Demo](DEMO.md), [submission](SUBMISSION.md), and [video](https://youtu.be/6eCRf7iAbFo): September presentation artifacts; UI labels may differ today.
- [OKX Mock Merchant debugging](OKX_PAYMENT_DEBUG.md): September challenge mismatch, bounded Testnet settlement and failed seller replay evidence.

An old receipt remains useful evidence for its original version. Rerun checks for the proposed release; never infer current public hosting, paid delivery or finality from a historical report.
