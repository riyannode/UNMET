# UNMET Future Implementation Roadmap

Demand-to-Supply Protocol

Version: V2.0
Date: 24 October 2026
Repository: https://github.com/riyannode/UNMET

Status: PROPOSED — NOT IMPLEMENTED

## 0. DOCUMENT PURPOSE

This roadmap defines the future architecture and implementation requirements for UNMET.

It is intended for:

- project contributors
- smart contract developers
- frontend developers
- backend developers
- infrastructure developers
- independent reviewers
- service builders
- security auditors

The document must be understandable without requiring access to earlier private discussions.

Features described here are not automatically part of the current production system.

Current behavior must be verified against the repository before implementation.


### Implementation Stages

- Gate 0 — Escrow Security and Automatic x402 Validation
- Phase 1 — Machine-Readable RFQ
- Phase 2 — Fulfilled Demand Service Registry
- Phase 3 — x402 Service Discovery
- Phase 4 — Demand Intelligence Expansion
- Phase 5 — Automatic Capability Resolver

The stages must be implemented incrementally.

Do not implement the complete roadmap in one change.


### Authorization

This roadmap does not authorize:

- smart contract deployment
- fund migration
- production transactions
- live configuration changes
- database migration
- repository commits
- pull request merges
- production releases

Before modifying code:

1. Read AGENTS.md.
2. Inspect the target branch and latest main.
3. Inspect relevant open pull requests.
4. Read the affected implementation and tests.
5. Identify all affected consumers and dependencies.
6. Present a complete impact map.
7. Wait for explicit owner approval.


## 1. PRODUCT THESIS

UNMET is a demand-to-supply protocol for AI agents.

The protocol begins with unmet demand.

An agent or user identifies a capability that is missing, unavailable, or unsuitable among existing services.

The requester describes the required capability and commits funds through an onchain demand escrow.

Other supporters may contribute additional funding.

Builders discover funded requirements and independently develop services that satisfy them.

A builder develops and hosts an x402-compatible API before submitting it to UNMET.

An automatic validation Worker checks the proposed service's payment compatibility and required technical metadata.

The Worker issues a signed attestation when validation passes.

The builder submits the service and attestation to the non-upgradeable escrow contract.

Supporters review the accepted submission.

If commitment-weighted approval reaches the required quorum, the escrow settles the approving supporters' commitments.

The resulting service may become discoverable through the UNMET Service Registry.

Agents purchase future API usage directly from the builder through x402.

Verified market activity and appropriately attributed usage evidence improve future Demand Intelligence.


### Core Thesis

UNMET turns funded unmet demand into purchasable AI-agent services.


### Complete Lifecycle

```text
Unmet Capability
→ Machine-Readable Demand
→ Supporter Funding
→ Builder Develops API
→ Frontend Submission
→ Automatic x402 Validation
→ Signed Attestation
→ Onchain Submission
→ Supporter Review
→ Escrow Settlement
→ Service Registration
→ Service Discovery
→ Direct x402 Purchase
→ Evidence-Based Usage
→ Demand Intelligence
```


## 2. PRODUCT SURFACES

UNMET consists of three connected product surfaces.


### 2.1 Unmet Market

Purpose: Publish and fund capabilities that agents need.

Functions:

- create demand
- fund demand
- inspect specifications
- inspect commitment totals
- inspect deadlines
- discover funded opportunities
- submit completed services
- review submitted services
- approve or reject submissions
- finalize eligible submissions
- withdraw eligible refunds

Demand funds remain controlled by the escrow contract.

The frontend and backend must not custody demand funds.


### 2.2 Unmet Intelligence

Purpose: Provide machine-readable demand analytics.

Examples:

- funded opportunities
- capital distribution
- capability demand
- expected usage
- funding history
- submission history
- fulfillment history
- observed service adoption

The existing paid POST /v1/opportunities endpoint remains the initial Demand Intelligence payment surface.

Future API changes must preserve compatibility unless explicit API versioning is approved.


### 2.3 Unmet Services

Purpose: Make services originating from fulfilled demand discoverable and purchasable.

Service records connect:

- originating demand
- settlement provenance
- provider identity
- service endpoint
- x402 payment requirements
- compatibility observations
- availability observations
- usage evidence

The builder hosts and operates the service.

UNMET does not custody payments for future API consumption.


## 3. PAYMENT AND NETWORK ARCHITECTURE

### 3.1 Initial Integration

The initial implementation targets:

Blockchain: X Layer

Payment integration: OKX Payments / OKX Onchain OS

Payment protocol: x402

Initial payment scheme: exact

Validation runtime: Cloudflare Worker

Escrow: AgentDemandV2

The initial payment profile is X Layer-specific.

The validation implementation must not be permanently coupled to one chain, token, or scheme through hardcoded business logic.


### 3.2 Current Network Separation

The existing UNMET configuration distinguishes:

Demand escrow: X Layer Testnet, chain ID 1952.

Demand Intelligence billing: X Layer Mainnet, chain ID 196.

The escrow chain and the x402 payment network are separate fields.

They must never be treated as interchangeable.

A demand on Testnet may describe a service intended to accept payments on Mainnet.

In such cases:

- escrowChainId identifies the demand contract's chain
- paymentNetwork identifies the service's x402 network

Both values must be validated independently.

A successful Testnet escrow transaction does not prove a Mainnet service payment occurred.


### 3.3 Configuration-Driven Payment Support

The Worker must load its payment validation policy from an explicitly configured payment profile.

The profile defines:

- profile identifier
- network identifier
- allowed payment schemes
- accepted assets
- token contract addresses
- token decimals
- supported x402 protocol versions
- payment amount rules
- receiver validation rules
- price comparison policy
- optional facilitator compatibility metadata
- enabled or disabled status

Do not hardcode accepted assets or network identifiers inside individual validation branches.

Do not use token symbols as canonical asset identities.

Do not allow a builder request to create or modify an approved payment profile.

Profiles are trusted deployment configuration, not untrusted request input.


### 3.4 Initial X Layer Profile

The first production payment profile is:

Profile: okx-xlayer-mainnet

Network: eip155:196

Integration: OKX Payments

Initial scheme: exact

Accepted assets: Only assets explicitly enabled in the approved deployment configuration.

Official OKX documentation identifies USD₮0, USDC, and USDG support on X Layer.

Their exact token addresses, decimals, and settlement capabilities must be verified before enabling them.

Do not assume all combinations of:

- token
- network
- scheme
- facilitator

are supported merely because a token appears in documentation.

The deployment must fail validation if the configured asset information is inconsistent or unsupported.


### 3.5 Testnet Profile

A separate development profile may use:

Profile: okx-xlayer-testnet

Network: eip155:1952

This profile must be enabled only after verifying the intended Testnet payment configuration.

Testnet and Mainnet profiles must not share unverified token addresses or payment settings.

Do not silently switch a validation request between Testnet and Mainnet.


### 3.6 Future Extensibility

Future support may include:

- additional payment assets
- additional supported schemes
- additional EVM networks
- other compatible x402 payment infrastructures

Extending support requires:

1. A reviewed payment profile.
2. Verified network identifiers.
3. Verified token contracts and decimals.
4. Confirmed scheme compatibility.
5. Required security checks.
6. Regression tests.
7. Explicit deployment approval.

Do not automatically accept every payment network supported by an external x402 library.

Use the smallest configuration mechanism that supports the approved profiles.

Do not build a generalized plugin framework before multiple implementations demonstrate the need.


### 3.7 Facilitator Responsibility

OKX payment infrastructure is responsible for the supported payment verification and settlement workflow used by the initial integration.

The UNMET Validation Worker is different.

Worker: Validates proposed service payment requirements before onchain submission.

Payment facilitator: Participates in verification and settlement when a client actually pays for the service.

A valid HTTP 402 challenge alone does not prove that the seller's facilitator will successfully settle a future payment.

Do not claim successful live payment integration without a confirmed paid execution test.


## 4. GATE 0 — ESCROW SECURITY AND AUTOMATIC x402 VALIDATION

### Objective

Prevent incompatible x402 service submissions from entering escrow review.

Maintain permissionless builder participation.

Preserve the existing commitment-weighted escrow economic model.


### 4.1 Architecture

Required components:

1. UNMET Frontend
2. x402 Validation Worker
3. Verifier Signing Authority
4. AgentDemandV2
5. Existing Bun Backend and Indexer

No BuilderRegistry is required.

No manual builder admission is required.

No curator role is required for selecting builders.

No builder staking or bond is required.


### 4.2 Non-Upgradeable Escrow

AgentDemandV2 must be non-upgradeable.

Do not introduce:

- UUPS proxy
- Transparent proxy
- upgrade administrator
- arbitrary escrow withdrawal authority

The escrow controls:

- demand creation
- supporter commitments
- immutable demand deadline
- service submission
- attestation verification
- review snapshot
- supporter voting
- quorum
- settlement
- refunds

The verifier must not control escrow balances.

The verifier must not be able to approve or reject submissions on behalf of supporters.

The verifier must not bypass the settlement quorum.


### 4.3 Builder Submission Model

### Decision:
Permissionless Build-First Submission.

Builders do not need approval before building.

A builder may:

1. Discover an OPEN demand.
2. Read its specifications.
3. Develop a compatible API.
4. Configure the API's x402 payment requirements.
5. Host the API independently.
6. Submit the endpoint through UNMET's frontend.

UNMET does not guarantee payment merely because a builder spent time developing the service.

The builder accepts the risk of building a service before receiving supporter approval.


### 4.4 Submission Flow

Step 1: The builder opens an OPEN demand.

Step 2: The builder connects the intended wallet.

Step 3: The builder enters:

- service endpoint
- evidence reference
- required validation request metadata

Step 4: The frontend requests validation from the Worker.

Step 5: The Worker reads the target demand's canonical onchain requirements.

Step 6: The Worker validates the service's x402 challenge.

Step 7: The Worker checks compatibility against the approved payment profile and demand requirements.

Step 8: If validation fails, the Worker returns a structured error.

Step 9: If validation succeeds, the Worker issues a short-lived signed attestation.

Step 10: The frontend prepares the AgentDemandV2 submission transaction.

Step 11: The builder independently reviews and signs the transaction.

Step 12: AgentDemandV2 verifies the attestation.

Step 13: A valid submission starts supporter review.


### Important

The Worker must not sign the builder's blockchain transaction.

The Worker must not broadcast transactions without the builder's authorization.

The frontend must not report submission success until the transaction receipt and contract state confirm acceptance.


### 4.5 Worker Validation Responsibilities

The Worker validates actual observed endpoint payment requirements.

It must not trust builder-declared values alone.


### Endpoint Validation

Check:

- HTTPS URL
- valid hostname
- safe resolved address
- supported request method
- bounded response size
- bounded response time
- redirect policy
- endpoint reachability


x402 VALIDATION

Check:

- supported protocol version
- valid HTTP payment-required behavior
- supported payment scheme
- correctly structured payment requirements
- required payment fields
- acceptable authorization timeout


### Network Validation

Check:

- payment network uses a recognized identifier
- network is enabled in an approved profile
- no network substitution occurred


### Asset Validation

Check:

- asset is configured for the selected network
- asset address is correct
- decimals are correct
- asset is enabled for the required scheme


### Payment Receiver Validation

Check:

- payTo is structurally valid
- payTo matches builder-authorized payment metadata
- receiver information is consistent across the
  submitted details and observed challenge

The receiving wallet may differ from the builder's submission wallet.

If different, that relationship must be explicitly authorized by the builder.

Do not silently assume the two wallets are equal.


### Price Validation

Check:

- amount is a valid non-negative integer
- amount uses the asset's atomic units
- the price denomination is known
- the observed price is compatible with the
  demand's maximum unit price

If the comparison is unsupported or ambiguous, validation must fail with a specific error.

Do not silently assume stablecoin parity.


### 4.6 Price Denomination Policy

The demand's maxUnitPrice and the service's x402 price may refer to different assets or units.

Before Gate 0 implementation, define a reviewed comparison policy for every enabled payment profile.

The policy must specify:

- canonical demand price denomination
- x402 asset denomination
- atomic-unit conversion rules
- supported asset comparisons
- unsupported comparisons
- handling of invalid or inconsistent amounts

Financial calculations must use exact integers.

Floating-point arithmetic must not be used.

Do not infer a price conversion from:

- token symbols
- marketing descriptions
- assumed stablecoin equality
- unverified market prices

If the required comparison policy is not approved, that payment profile cannot issue PASS attestations.

This requirement is a mandatory implementation gate.

A coding agent must not invent conversion rates or redefine existing contract economics.


### 4.7 Validation Results

The Worker returns exactly one result category:

### Pass Fail
#### Unavailable


#### Pass

All checks required by the selected profile were completed successfully.

A signed attestation may be issued.


#### Fail

At least one required check failed.

The response must identify the failure using a stable error code.

No successful attestation may be issued.


#### Unavailable

The Worker could not reliably complete the required checks.

Examples:

- RPC unavailable
- endpoint timeout
- required external dependency unavailable
- signer unavailable

UNAVAILABLE must not become PASS.

No successful attestation may be issued.


### 4.8 Worker Endpoint

Proposed endpoint:

POST /v1/x402/validate

This endpoint is hosted by the validation Worker.

The frontend calls it before preparing the onchain submission.


### Required Request Data

- escrowChainId
- escrowContract
- demandId
- builderWallet
- serviceUrl
- evidenceHash
- validation request description

The Worker must not trust client-provided economic fields as canonical.

It must read and verify the relevant onchain demand state.


### Success Response

- status: PASS
- payment profile identifier
- validated payment requirements digest
- validation timestamp
- attestation expiration
- signed attestation


### Failure Response

- status: FAIL
- stable error code
- safe error message
- no valid attestation


### Unavailable Response

- status: UNAVAILABLE
- stable error code
- safe retry information when appropriate
- no valid attestation


### 4.9 Worker Security

Every submitted endpoint is untrusted.

Protect against:

- server-side request forgery
- localhost access
- private addresses
- cloud metadata endpoints
- DNS rebinding
- unsafe redirects
- unsupported URL schemes
- oversized responses
- excessive request duration
- uncontrolled concurrency
- abusive validation requests

Do not execute arbitrary scripts supplied by service providers.

Do not execute paid requests merely to validate an x402 payment challenge.

If the API requires a request body for an unpaid challenge, use a declared, bounded, safe validation request.

Do not expose:

- verifier signing credentials
- private API credentials
- bearer tokens
- sensitive internal responses
- unrelated environment variables

Do not log complete secret-bearing headers.


### 4.10 Signed Validation Attestation

The Worker must sign successful validation results using a recognized verifier identity.

The validation attestation must use EIP-712 typed structured data.

The attestation must bind:

- escrowChainId
- verifyingContract
- demandId
- builderWallet
- serviceUrlHash
- evidenceHash
- paymentRequirementsHash
- submissionNonce
- validationPolicyId
- issuedAt
- expiresAt

The escrow chain ID used in the EIP-712 domain is separate from the service payment network.

This distinction is mandatory when the demand and service payment operate on different chains.

The signature must not be usable:

- on another escrow contract
- on another escrow chain
- for another demand
- by another builder
- for a different endpoint
- for another evidence hash
- for another submission nonce

The contract must reject:

- missing attestation
- malformed signature
- unauthorized verifier
- expired attestation
- invalid validity period
- mismatched builder
- mismatched demand
- mismatched contract
- mismatched chain
- mismatched URL hash
- mismatched evidence
- mismatched submission nonce
- replayed attestation


### 4.11 Attestation Validity

The initial proposed maximum lifetime is 15 minutes.

The actual lifetime must be reviewed against real wallet interaction timing.

The contract must enforce the approved lifetime.

Expired attestations require a fresh Worker validation.

The Worker may issue a new attestation only after completing the required checks.

A validation PASS is evidence of the checks performed at that time.

It does not prove permanent service availability.


### 4.12 Verifier Authority

The verifier's only onchain authority is to authorize eligible service submissions through valid attestations.

The verifier must not:

- move escrow funds
- approve supporter votes
- change quorum
- change fee parameters
- change demand deadlines
- change settlement recipients
- block eligible refunds

Verifier signing credentials must be stored using an approved secret-management mechanism.

Do not commit signing credentials.

Do not expose credentials in frontend bundles.

A narrowly scoped verifier rotation mechanism may be required.

Its design and administrative authority must be approved before deployment.

A compromised verifier can authorize invalid submissions.

However, it must not be able to bypass supporter voting or independently transfer escrow funds.


### 4.13 One Active Proposal

Preserve one active service submission per demand.

When a valid submission is accepted:

- demand status becomes SUBMITTED
- builder identity is recorded
- service URL is recorded
- evidence hash is recorded
- submission nonce advances
- review commitment snapshot is fixed
- required approval weight is fixed
- review period begins

Additional submissions during active review must revert.

A failed Worker validation does not change escrow state.


### 4.14 Supporter Voting

Preserve commitment-weighted voting.

Supporters may:

- approve the current submission
- reject the current submission

A supporter cannot both approve and reject the same submission nonce.

Votes must not be counted twice.

Voting weight is derived from the fixed review commitment snapshot.

The Worker cannot cast supporter votes.


### 4.15 Immediate Finalization

### Decision:
Immediate Finalization at Quorum.

The configured approval quorum is 60%.

Once the required approval weight is reached, any account may call finalize() immediately.

The full review period does not need to elapse first.

The 24-hour review period is a voting window, not a mandatory minimum payout delay.

Finalization must not require:

- Worker availability
- verifier approval
- backend availability
- builder cooperation
- administrator permission


### 4.16 Selective Settlement

Only commitments belonging to supporters who explicitly approved the current submission are settled.

The approved amount is divided into:

- configured protocol fee
- builder payout

Non-approving commitments retain their applicable refund rights.

Do not settle all committed funds merely because 60% quorum was reached.

Finalization must be atomic.

Duplicate payout must be impossible.


### 4.17 Creator-Defined Deadline

The demand creator chooses the deadline during demand creation.

UNMET does not impose one universal development duration for every API.

The contract validates the permitted deadline bounds.

After creation, the deadline is immutable.

The deadline is the final time at which a new service submission may be accepted.

Worker validation does not extend it.

An attestation issued before the deadline does not permit submission after the deadline.

Reopen does not extend the deadline.

Repeated proposals do not extend the deadline.


### 4.18 Bounded Refund Liveness

Preserve the bounded review model.

### Case A — No Submission

If the deadline passes without an accepted submission, eligible supporters may refund.


### Case B — Active Review

A valid proposal may continue review after the original deadline.

Refund eligibility follows the existing review and quorum conditions.


### Case C — Review Ends Without Quorum

When the demand deadline and review period have both elapsed without quorum, eligible supporters may refund.


### Case D — Mathematical Rejection

A proposal may become mathematically incapable of reaching approval quorum.

Before deadline: The demand may be reopened according to the contract's rules.

After deadline: No new submission may begin, and eligible supporters may refund.


### Case E — Quorum Reached

Anyone may finalize.

Do not classify a quorum-approved submission as failed merely because finalize() has not yet been called.


### Case F — Fulfilled

Approver commitments have been settled.

Eligible non-approvers may withdraw their remaining commitments.


MAXIMUM FAILED-REVIEW DELAY

For a valid submission:

reviewEndsAt = submissionTime + 24 hours.

Because submission must occur before the immutable deadline:

reviewEndsAt < deadline + 24 hours.

For a failed submission without quorum, refund eligibility must become available no later than 24 hours after the original deadline.

This is an eligibility bound.

It does not guarantee automatic withdrawal.

Actual withdrawal requires a successful onchain refund transaction.


### 4.19 Worker Availability

The Worker is required to issue new validation attestations.

The Worker must not be required for:

- supporter approval
- supporter rejection
- finalize()
- reopen()
- refund()

A Worker outage may prevent new submissions.

It must not prevent eligible settlement or fund recovery.


### 4.20 Verification Terminology

Use distinct states.


### X402_COMPATIBLE

The Worker observed payment requirements that satisfied the configured validation policy at a specific time.


### SUPPORTER_APPROVED

The submission reached the required commitment-weighted approval quorum.


### Fulfilled

The escrow completed settlement.


### TECHNICALLY_VERIFIED

An explicitly defined independent technical test produced evidence of a specific service property.


### Available

A recent observation indicates that the service endpoint is reachable.


Do not conflate these states.

A valid HTTP 402 challenge does not prove that paid API execution succeeds.

Supporter approval does not prove independent technical correctness.

Fulfillment does not guarantee future service availability.


### 4.21 Permissionless Spam Risk

Automatic validation reduces malformed or incompatible proposals.

It does not eliminate spam or griefing.

A malicious provider may expose a technically valid x402 challenge without delivering useful functionality.

The protocol continues to rely on:

- bounded review
- immutable deadline
- supporter decisions
- rejection rules
- reopen rules
- refund eligibility

Do not claim automatic validation guarantees service quality.

Do not introduce builder bonds, staking, or manual curation without separate approval.


## 5. GATE 0 TEST REQUIREMENTS

### 5.1 Contract Tests

Required:

1. Valid attestation accepted.
2. Missing attestation rejected.
3. Unauthorized verifier rejected.
4. Expired attestation rejected.
5. Wrong builder rejected.
6. Wrong demand rejected.
7. Wrong escrow contract rejected.
8. Wrong escrow chain rejected.
9. Wrong endpoint hash rejected.
10. Wrong evidence hash rejected.
11. Wrong submission nonce rejected.
12. Replayed attestation rejected.
13. Submission after deadline rejected.
14. Duplicate active submission rejected.
15. Review snapshot remains fixed.
16. Conflicting votes rejected.
17. Quorum below 60% cannot finalize.
18. Exact quorum can finalize.
19. Early finalization works.
20. Only explicit approver funds settle.
21. Non-approver refund remains available.
22. Duplicate payout is impossible.
23. No-submission refund works.
24. Late-submission review is bounded.
25. Mathematical rejection works.
26. Reopen preserves deadline.
27. Repeated proposals cannot extend deadline.
28. Refund cannot execute twice.
29. Refund and payout cannot spend
    the same commitment twice.
30. Verifier cannot withdraw escrow funds.
31. Verifier rotation follows its access rules.
32. Reentrancy protections remain effective.


### 5.2 Worker Tests

Required:

1. Valid configured profile accepted.
2. Unknown profile rejected.
3. Disabled profile rejected.
4. Valid x402 challenge accepted.
5. Malformed challenge rejected.
6. Unsupported protocol version rejected.
7. Unsupported scheme rejected.
8. Unsupported network rejected.
9. Unsupported asset rejected.
10. Incorrect token decimals rejected.
11. Invalid payTo rejected.
12. Unauthorized receiver declaration rejected.
13. Invalid amount rejected.
14. Comparable price above limit rejected.
15. Unsupported price comparison rejected.
16. Unsafe URL rejected.
17. Localhost and private IP blocked.
18. DNS rebinding blocked.
19. Unsafe redirect blocked.
20. Response size bounded.
21. Request timeout bounded.
22. RPC failure returns UNAVAILABLE.
23. Signer failure returns UNAVAILABLE.
24. FAIL never produces a valid attestation.
25. UNAVAILABLE never produces a valid attestation.
26. Signature binds all required fields.
27. Validation cannot leak secrets.


### 5.3 Frontend Tests

Required:

1. Validation loading state.
2. Invalid URL error.
3. Network incompatibility error.
4. Asset incompatibility error.
5. Price incompatibility error.
6. Worker unavailable state.
7. Valid attestation submission.
8. Expired attestation revalidation.
9. Wallet rejection handling.
10. Pending transaction handling.
11. Wrong wallet handling.
12. Wrong escrow network handling.
13. Receipt success verification.
14. Contract state readback verification.
15. No duplicate submission after
    an unknown transaction outcome.

Existing valid tests must not be deleted or weakened.


## 6. CONTRACT VERSIONING AND MIGRATION

AgentDemandV1 is immutable.

Its deployed implementation cannot be modified in place.

Onchain attestation enforcement therefore requires a new contract version.


### Target

AgentDemandV2: Non-upgradeable escrow with attestation-gated service submission.

No BuilderRegistry is required.

No curated admission contract is required.

No upgradeable proxy is required.


### Migration Rules

1. Preserve V1 deployments.

2. Preserve historical V1 demands.

3. Preserve outstanding V1 balances.

4. Preserve V1 finalization access.

5. Preserve V1 refund access.

6. Do not automatically migrate funds.

7. Route new demands to V2 only after
   explicit rollout approval.

8. Keep V1 and V2 records distinguishable.

9. Update frontend and backend ABI consumers.

10. Update addresses and documentation
    only for the approved deployment.


### Canonical Demand Identity

Use:

```text
chainId escrowContractAddress demandId
```

Demand IDs are not globally unique.

Different contract versions may have the same numeric demand ID.


### Future Contract Versions

Deploy a new immutable escrow version only when changing onchain behavior.

Examples:

- voting rules
- settlement accounting
- refund rules
- custody rules
- incompatible submission verification

RFQ metadata, analytics, service discovery, and resolver improvements should not automatically require escrow redeployment.


## 7. PHASE 1 — MACHINE-READABLE RFQ

### Objective

Allow agents to create and read demand programmatically.

An RFQ describes:

- required capability
- technical requirements
- expected inputs
- expected outputs
- compatibility constraints
- price constraints
- expected call volume
- submission deadline
- verification requirements

RFQ functionality extends demand creation.

It does not replace the escrow model.


### 7.1 Canonical Source

The escrow contract is authoritative for:

- creator
- capability
- specification
- maximum unit price
- expected calls
- deadline
- commitments
- submission status
- review status
- votes
- settlement
- refunds

Offchain metadata must not silently override onchain economic fields.


### 7.2 RFQ Storage

Use two layers.


### Onchain

Store a compact versioned RFQ envelope inside the contract specification field.

Respect the existing specification size limit unless an approved contract version changes it.


CONTENT-ADDRESSED DOCUMENT

Store larger schemas and supporting technical documents using immutable content-addressed references.

For RFQ v1:

- canonicalize JSON with RFC 8785/JCS
- encode the result as UTF-8
- calculate SHA-256
- publish the exact canonical bytes
- verify the digest on retrieval

Unavailable or mismatched documents must be reported explicitly.

Do not silently replace them with different content.


### Example Envelope

```json
{ "schemaVersion": "unmet-rfq-v1", "summary": "Analyze SEC filing risks", "documentUri": "ipfs://REPLACE_WITH_CID", "documentSha256": "0xREPLACE_WITH_SHA256" }
```

The values above are placeholders.


### 7.3 Example RFQ Document

```json
{ "schemaVersion": "unmet-rfq-v1", "capability": "sec-filing-risk-analysis", "description": "Return a structured risk report", "input": { "contentType": "application/json", "schemaUri": "ipfs://INPUT_SCHEMA_CID" }, "output": { "contentType": "application/json", "schemaUri": "ipfs://OUTPUT_SCHEMA_CID" }, "requirements": { "maxLatencyMs": 3000, "paymentProtocol": "x402" }, "verification": { "policy": "supporter-approval", "benchmarkUri": null } }
```

Economic fields remain authoritative in the escrow contract.

A benchmark requirement does not mean that the benchmark has passed.


### 7.4 Programmatic API

POST /v1/rfqs/prepare

Purpose: Prepare unsigned demand-creation transaction information.

Behavior:

1. Validate schema.
2. Validate content integrity.
3. Validate contract version.
4. Validate target chain.
5. Validate economic bounds.
6. Construct transaction arguments.
7. Return unsigned transaction data.

The backend must not sign or broadcast the user's transaction.


GET /v1/rfqs

Return available machine-readable RFQs.


GET /v1/rfqs/:id

Return a version-aware RFQ record.

Include:

- canonical demand identity
- current onchain state
- metadata version
- metadata integrity
- referenced content availability
- indexing block and freshness

Historical demands without RFQ v1 metadata must remain readable.


### 7.5 Acceptance

Required:

- valid schema accepted
- invalid schema rejected
- unsupported version rejected
- invalid URI rejected
- digest mismatch rejected
- oversized metadata rejected
- invalid economic values rejected
- unsupported network rejected
- unsigned transaction verified
- legacy demand remains readable


## 8. PHASE 2 — FULFILLED DEMAND SERVICE REGISTRY

### Objective

Make services originating from fulfilled demand discoverable.

This registry is a service catalog.

It does not control builder admission.


### 8.1 Service Provenance

A service may be registered as demand-originated only after the corresponding escrow fulfillment.

Required evidence:

- chain ID
- escrow contract address
- demand ID
- canonical fulfillment event
- transaction receipt
- builder address
- original service URL
- original evidence reference

A submitted proposal does not prove the demand was fulfilled.

A backend database flag alone does not prove fulfillment.


### 8.2 Immutable Fields

Immutable provenance:

- service ID
- originating chain
- originating escrow
- originating demand
- originating builder
- fulfillment reference
- originating capability
- original submission evidence

Provider metadata updates must not modify these fields.


### 8.3 Mutable Metadata

The originating builder may update:

- current endpoint
- service description
- service version
- current price
- payment network
- accepted payment assets
- input/output schemas
- documentation
- availability declaration

Updates must be authenticated by the originating builder.

Use versioned signed metadata.

The signature must bind:

- service ID
- originating chain
- originating escrow
- provider wallet
- metadata version
- metadata digest
- validity information

Reject replayed and stale updates.

Changing an endpoint does not alter the original escrow settlement.


### 8.4 Storage

Canonical fulfillment provenance: Blockchain.

Mutable provider configuration: Authenticated builder metadata.

Backend storage: Published records, indexes, observations, and query state.

Persistent records require durable storage.

Do not assume ephemeral filesystems provide durable registry persistence.

Keep service metadata separate from payment settlement invariants.


### 8.5 Service States

Track independently:

Fulfillment:
- NOT_FULFILLED
- FULFILLED

Publication:
- DRAFT
- PUBLISHED
- UNLISTED

x402 compatibility:
- UNKNOWN
- COMPATIBLE
- INCOMPATIBLE
- STALE

Availability:
- UNKNOWN
- REACHABLE
- UNREACHABLE

Technical verification:
- NOT_VERIFIED
- VERIFIED
- FAILED
- STALE

Do not collapse these dimensions into one misleading VERIFIED state.


### 8.6 Service API

GET /v1/services

GET /v1/services/:id

Responses distinguish:

- immutable provenance
- builder-declared metadata
- observed payment compatibility
- independent verification
- availability
- observation timestamps


## 9. PHASE 3 — x402 SERVICE DISCOVERY

### Objective

Allow agents to find compatible services originating from fulfilled demand.


### 9.1 Direct Payment Model

The builder hosts the API.

The builder configures the service's x402 payment requirements.

The purchasing agent pays according to those requirements.

UNMET does not custody future service-consumption payments.


### Purchase Flow

```text
Agent discovers service
→ Agent requests provider endpoint
→ Provider returns payment requirements
→ Agent validates network, asset, price, and receiver
→ Agent authorizes payment
→ Provider verifies and settles payment
→ Provider delivers the purchased response
```

The provider remains responsible for paid execution.


### 9.2 Discovery Validation

Reuse the validated payment profile model established in Gate 0.

Do not create a conflicting second payment protocol interpretation.

The purposes differ.

Gate 0: Checks submission compatibility.

Phase 3: Checks current service compatibility for potential buyers.

A historical Gate 0 attestation may become stale.

Discovery must report current observations and their timestamps.


### 9.3 Discovery API

GET /v1/services

Optional filters:

- capability
- payment network
- asset
- maximum price
- input format
- output format
- availability
- verification level


GET /v1/services/:id

Return the selected service and its supporting evidence.


### 9.4 Payment Safety

Discovery does not authorize spending.

A purchasing agent must:

- choose the provider
- inspect payment requirements
- verify recipient
- verify network
- verify asset
- verify amount
- authorize wallet payment
- inspect settlement result

Do not automatically sign or spend because discovery returned a service.

Payment outcomes must distinguish:

- submitted
- confirmed
- failed
- unknown

Do not blindly retry unknown payments.


## 10. PHASE 4 — DEMAND INTELLIGENCE EXPANSION

### Objective

Expand the existing paid intelligence API using verifiable market activity.

Preserve current POST /v1/opportunities compatibility unless versioning is approved.


### 10.1 Market Metrics

Potential metrics:

- funded demand by capability
- committed capital
- funding velocity
- supporter growth
- expected call volume
- repeat demand
- submission count
- rejected submission count
- reopen count
- fulfilled demand count
- fulfillment duration
- demand-to-service conversion
- published service count
- observed service purchase volume
- evidence-backed usage

Definitions must be documented.

Expected calls are not observed usage.

Committed capital is not builder revenue.

Fulfillment is not permanent service availability.


### 10.2 Usage Evidence Levels

### Level 1 — Declared

Source: Provider-reported usage.

Meaning: The provider claims usage occurred.

Not independent proof of execution.


### Level 2 — Payment Observed

Source: Verifiable payment evidence.

Meaning: A payment occurred.

Not automatic proof that a specific API request succeeded.

Service attribution must be demonstrated.


### Level 3 — Execution Attested

Source: Authenticated provider execution record.

Recommended fields:

- service ID
- request identifier
- payment reference
- provider identity
- timestamp
- execution status
- response digest when applicable

Meaning: The provider attests execution.

Not independent proof of correctness.


### Level 4 — Independently Verified

Source: Reproducible independent test with a defined methodology.

Meaning: A specific technical property was verified.

Do not infer unrelated quality or availability guarantees.


### 10.3 Attribution

Every evidence record must identify:

- service
- provider
- evidence source
- source identifier
- observation timestamp
- verification state
- chain and transaction when applicable

A payment must not be counted twice because of retries or duplicate logs.

Do not infer service usage from unrelated wallet transfers.

Ambiguous attribution must not enter verified usage totals.


### 10.4 Chain Indexing

Chain-derived records must track:

- chain ID
- contract address
- block number
- block hash
- transaction hash
- log index
- canonicality
- finality

Indexers must handle:

- duplicate logs
- reorgs
- retries
- restarts
- partial failures
- checkpoint recovery

Reverted events must not remain in confirmed totals.

Do not fabricate historical usage.


### 10.5 Outcome Metrics

Keep these separate:

- demand fulfilled
- service published
- endpoint reachable
- payment observed
- execution attested
- benchmark passed

A fulfilled service may be unavailable.

A paid request may fail execution.

A benchmark may test only one property.

Do not collapse these observations into an unsupported success score.


### 10.6 Intelligence Payment

UNMET intelligence payments are separate from service-consumption payments.

Intelligence revenue belongs to the configured UNMET intelligence receiver.

Service-consumption payments follow the builder's validated x402 configuration.

Demand escrow funding is a third, independent economic flow.

Do not combine these flows into one accounting category.


## 11. PHASE 5 — AUTOMATIC CAPABILITY RESOLVER

### Objective

Help an agent find an existing compatible service before proposing new demand.


### Resolution Order

1. Parse requested capability.
2. Parse input/output requirements.
3. Parse payment network constraints.
4. Parse accepted assets.
5. Parse maximum price.
6. Search published services.
7. Check current compatibility.
8. Return compatible services if found.
9. Otherwise search matching funded RFQs.
10. Return relevant demand if found.
11. Otherwise prepare unsigned RFQ creation.


### Proposed API

GET /v1/resolve/:capability


### Result Types

- SERVICE_AVAILABLE
- MATCHING_RFQ
- RFQ_CREATION_AVAILABLE
- NO_SUPPORTED_PATH


The resolver must not:

- spend wallet funds
- create an onchain demand automatically
- submit escrow transactions
- approve a service
- pay a provider
- fabricate verification results


## 12. UNIFIED SOURCE OF TRUTH

### Escrow Contract

Authoritative for:

- demand creation
- committed funds
- economic fields
- immutable deadline
- accepted submission
- review snapshot
- voting
- settlement
- refunds


### Payment Profile

Authoritative configuration for:

- supported validation networks
- schemes
- assets
- token identity
- validation rules
- price comparison policy

A builder request cannot modify approved payment profiles.


### Validation Worker

Responsible for:

- endpoint inspection
- x402 compatibility checks
- validation result
- signed attestation

Observations are time-dependent.


### Verifier Signature

Proves the authorized verifier signed the specified validation statement.

It does not independently prove the real-world correctness of that statement.


### RFQ Documents

Provide versioned technical requirements with content integrity checks.

They do not override onchain economics.


### Service Registry

Provides fulfillment provenance and published service metadata.

Canonical settlement provenance comes from blockchain state.


### Backend Database

Stores:

- derived chain indexes
- service metadata
- analytics materialization
- operational observations

It is not authoritative for moving escrow funds.


### Payment And Execution Evidence

Provides:

- observed payments
- authenticated execution claims
- independent benchmark results

Every record must preserve its evidence strength.


## 13. API AND ERROR REQUIREMENTS

All new endpoints require documented request and response contracts.

Stable public error codes belong in [docs/ERRORS.md](ERRORS.md).


### Validation Error Categories

- invalid endpoint
- unsafe endpoint
- invalid x402 challenge
- unsupported x402 version
- unsupported scheme
- unsupported network
- unsupported asset
- invalid receiver
- incompatible price
- unsupported price comparison
- validation timeout
- verifier unavailable
- invalid attestation
- expired attestation
- attestation replay
- wrong builder
- wrong demand
- deadline expired
- invalid escrow state

Errors must not expose:

- signing credentials
- internal secrets
- sensitive provider payloads
- private infrastructure details

Unavailable external state must not be reported as successful validation.


## 14. IMPLEMENTATION ORDER

### Gate 0

Deliver:

- code impact map
- non-upgradeable AgentDemandV2
- configuration-driven x402 Worker
- initial OKX/X Layer payment profile
- safe endpoint validation
- signed attestation specification
- onchain signature verification
- verifier authority model
- frontend submission integration
- preserved voting and refunds
- V1/V2 compatibility
- contract and Worker regression tests

Do not deploy before validation and explicit approval.


### Phase 1

Deliver:

- RFQ schema
- canonical metadata
- content-addressed specifications
- unsigned transaction preparation
- programmatic RFQ reads
- historical compatibility


### Phase 2

Deliver:

- fulfillment-derived service registry
- immutable provenance
- builder-authenticated mutable metadata
- durable records
- explicit verification states


### Phase 3

Deliver:

- service discovery
- current x402 compatibility checks
- direct provider payment metadata
- agent purchase safety


### Phase 4

Deliver:

- historical funding analytics
- submission and fulfillment history
- evidence-classified usage
- deterministic indexing
- reorg-aware metrics


### Phase 5

Deliver:

- capability matching
- compatible service search
- funded RFQ fallback
- unsigned creation path


## 15. CODING AND SECURITY REQUIREMENTS

### Smart Contracts

- Preserve immutable escrow architecture.
- Preserve selective settlement.
- Preserve permissionless finalize.
- Preserve eligible refunds.
- Preserve immutable deadlines.
- Enforce attestation verification.
- Prevent signature replay.
- Validate authorization boundaries.
- Use exact integer accounting.
- Preserve reentrancy protections.
- Synchronize ABIs and consumers.


### Worker

- Validate on demand.
- Avoid permanent polling.
- Load approved payment profiles.
- Do not hardcode network-specific
  validation behavior.
- Protect against SSRF.
- Use bounded requests.
- Never make unapproved payments.
- Protect verifier credentials.
- Fail closed on uncertain validation.
- Remain independent of refund execution.


### Backend

- Preserve existing payment durability.
- Preserve deterministic indexing.
- Handle retries and reorgs.
- Avoid unsupported financial claims.
- Avoid unnecessary database expansion.
- Keep payment processing separate
  from service discovery.


### Frontend

- Reuse existing wallet integration.
- Preserve account and network binding.
- Handle wallet rejection.
- Handle pending transactions.
- Handle unknown transaction outcomes.
- Require successful receipt verification.
- Verify final contract state.
- Display validation failures clearly.
- Never silently switch wallets.


### Documentation

- Update architecture documentation.
- Update API documentation.
- Document public error codes.
- Document supported payment profiles.
- Document verifier trust assumptions.
- Document deployment configuration.
- Preserve historical deployment evidence.
- Separate Testnet and Mainnet claims.


### Validation

Run applicable finite checks:

- Foundry formatting
- Foundry build
- Foundry tests
- targeted fuzz tests where justified
- Worker tests
- backend tests
- frontend tests
- typecheck
- lint where available
- frontend production build

Do not remove valid tests to obtain passing results.

Unavailable checks must be reported honestly.


## 16. KNOWN RISKS AND LIMITATIONS

### 1. Verifier Trust

The Worker can authorize new submissions.

Its signing authority must be protected.

A compromised verifier may approve invalid submission metadata.


### 2. Endpoint Mutability

Providers may change endpoint behavior after validation.

Historical attestations cannot guarantee future service availability.


### 3. Service Quality

A valid x402 challenge does not prove paid execution correctness.


### 4. Permissionless Spam

Automatic compatibility checks do not fully eliminate proposal griefing.


### 5. Worker Availability

Worker outages may interrupt new submissions.

They must not interrupt eligible finalization or refunds.


### 6. Price Comparison

Cross-asset comparisons require an explicitly approved policy.

Unknown conversions must not be silently accepted.


### 7. Immutable Contracts

An immutable escrow cannot receive an in-place implementation upgrade.

A future vulnerability may require a new contract version.


### 8. Evidence Limitations

Provider-reported usage is not independent proof of execution.

Payment evidence does not automatically prove API response correctness.


## 17. NON-GOALS

Do not introduce:

- BuilderRegistry
- manual builder admission
- curator-controlled proposal selection
- Google Forms registration
- builder staking
- builder bonds
- upgradeable escrow proxies
- unrelated governance tokens
- NFTs
- generic social marketplace features
- unsupported reputation scoring
- automatic wallet spending
- arbitrary cross-chain payment support
- administrative escrow withdrawals
- forced V1 fund migration

Do not turn UNMET into a generic API marketplace without funded demand provenance.


## 18. DEFINITION OF DONE

### Gate 0 Is Complete When:

1. Builders can submit through the frontend
   without manual registration.

2. The Worker validates actual x402
   payment requirements.

3. The initial payment profile targets
   approved OKX/X Layer configuration.

4. Network, asset, and scheme support
   are loaded from reviewed configuration.

5. Invalid submissions receive explicit errors.

6. Only successful validation produces
   a signed attestation.

7. AgentDemandV2 verifies attestations onchain.

8. Direct contract calls cannot bypass
   attestation enforcement.

9. One active submission per demand remains.

10. Quorum 60% permits immediate finalization.

11. Only explicit approver funds settle.

12. Non-approvers retain refund rights.

13. Failed reviews have bounded
    refund eligibility.

14. Deadlines remain immutable.

15. Finalize and refund do not depend
    on the Worker.

16. Historical V1 state remains accessible.

17. Validation is not mislabeled
    as independent service verification.

18. Relevant contract, Worker, backend,
    and frontend regression checks pass.


### The Complete Roadmap Is Done When:

1. Agents can create machine-readable RFQs.

2. RFQ metadata has clear canonical sources.

3. Fulfilled services preserve onchain provenance.

4. Builders can update authenticated metadata.

5. Agents can discover compatible services.

6. Service payments go directly to providers.

7. Intelligence metrics preserve evidence sources.

8. Usage claims reflect verification strength.

9. The resolver searches existing supply
   before suggesting new demand.

10. No discovery or analytics action
    silently spends wallet funds.


## 19. DELIVERY REPORTING

Every implementation phase must report:

1. Approved scope.
2. Code impact map.
3. Files changed.
4. Contract interfaces affected.
5. Backend consumers affected.
6. Frontend consumers affected.
7. Worker configuration affected.
8. Tests added.
9. Checks executed.
10. Passing checks.
11. Failed or unavailable checks.
12. Security assumptions.
13. Compatibility limitations.
14. Migration requirements.
15. Deployment prerequisites.
16. Manual actions.
17. Cleanup status.

Compilation alone does not prove correct runtime behavior.

Financial invariants and transaction outcomes require independent verification.


## 20. FINAL PRODUCT POSITIONING

### Short Description

UNMET turns funded unmet demand into purchasable AI-agent services.


### Technical Description

UNMET is a demand-to-supply protocol for the agent economy.

Agents publish funded capability requests.

Builders independently develop APIs that satisfy those requirements.

A configuration-driven Worker validates the proposed service's x402 compatibility.

An immutable escrow contract accepts submissions carrying valid attestations.

Supporters determine settlement through commitment-weighted approval.

Fulfilled services become discoverable through a provenance-aware registry.

Agents purchase future API usage directly from service providers.

Evidence-backed payments, executions, and technical outcomes improve future Demand Intelligence.


### Final Loop

```text
Agents Publish Demand
→ Supporters Fund Requirements
→ Builders Create APIs
→ Worker Validates x402
→ Escrow Accepts Submission
→ Supporters Approve
→ Escrow Settles
→ Services Become Discoverable
→ Agents Purchase Directly
→ Evidence Improves Intelligence
→ New Demand Is Discovered
```


## 21. OFFICIAL TECHNICAL REFERENCES

UNMET

Repository:
https://github.com/riyannode/UNMET


### X Layer

Official Documentation:
https://www.okx.com/xlayer

X Layer Developer Documentation:
https://github.com/okx/xlayer-docs


### OKX Payments

OKX Payments SDK:
https://github.com/okx/payments

OKX Payment Concepts:
https://web3.okx.pro/onchainos/dev-docs/payments/core-concept

Supported Networks and Assets:
https://web3.okx.pro/onchainos/dev-docs/payments/supported-networks

OKX Node.js SDK:
https://web3.okx.pro/onchainos/dev-docs/payments/sdk-nodejs

OKX Seller Integration:
https://web3.okx.pro/onchainos/dev-docs/payments/service-seller

OKX One-Time Payments:
https://web3.okx.pro/onchainos/dev-docs/payments/methods-onetime


x402 PROTOCOL

Open Protocol Specification:
https://github.com/x402-foundation/x402


### Smart Contracts

Ethereum Smart Contracts:
https://ethereum.org/developers/docs/smart-contracts/

EIP-712:
https://eips.ethereum.org/EIPS/eip-712


### Data Formats

RFC 8785 — JSON Canonicalization:
https://www.rfc-editor.org/rfc/rfc8785


## 22. DOCUMENTATION INTEGRATION

Documentation ownership is explicit:

1. Label this [Future Implementation](FUTURE_IMPLEMENTATION.md) document as the exclusive owner of proposed implementation plans.

2. Keep future features separate from the current product. [PRD.md](PRD.md) owns current Post-Hackathon requirements and may link here for navigation only; do not duplicate proposed plans. [STATUS.md](STATUS.md) and dated records own implementation and acceptance evidence.

3. Do not claim AgentDemandV2 is deployed
   before verified deployment evidence.

4. Do not claim the Worker is operational
   before verified runtime evidence.

5. Do not claim an audit occurred
   without an actual audit.

6. Preserve historical transaction records.

7. Preserve network separation.

8. Preserve current intelligence payment
   semantics and their limitations.

9. Distinguish:

   - x402 compatibility
   - supporter approval
   - escrow fulfillment
   - technical verification
   - service availability
   - observed usage

10. Update affected code and documentation
    together only after implementation approval.

## Status and authorization

UNMET — Future Implementation Roadmap v2.0

Status: PROPOSED

This roadmap does not authorize deployment, production transactions, or fund migration.
