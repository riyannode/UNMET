# UNMET Future Implementation Roadmap

Demand-to-Supply Protocol

Version: V2.0
Date: 24 October 2026
Repository: https://github.com/riyannode/UNMET

Status: PROPOSED — except the local G0.3 and G0.4 source noted below

Implementation note: the repository contains a local G0.3 validation runtime and separate signer, documented in [API](API.md#standalone-g02-validation-runtime) and [Architecture](ARCHITECTURE.md#local-g02-validation-source). It verifies builder authorization and issues signed PASS after validation. It is not deployed or production-ready. This note does not change the policy envelope or approve later roadmap stages. The strict JSON implementation uses pinned `jsonc-parser` for duplicate-key detection and syntax checks, rather than the implementation task's suggested `lossless-json` candidate, because the latter did not reliably reject identical duplicate values in evaluation. Local tests do not establish the planned VPS isolation controls. G0.4 adds the canonical non-upgradeable `AgentDemand.sol`, onchain attestation consumption, verifier rotation and escrow regression coverage. Canonical contract integration remains G0.5; no deployment is included.

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

Demand commitments finance service creation. They do not prepay future API calls or grant usage credits. After fulfillment, supporters and other consumers pay the provider separately through direct x402 requests.

Builders discover funded requirements and independently develop services that satisfy them.

A builder develops and hosts an x402-compatible API before submitting it to UNMET.

An automatic validation service checks the proposed service's payment compatibility and required technical metadata.

The validation service issues a signed attestation when validation passes.

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

#### Current implementation baseline

The current free `GET /v1/demands` returns public chain-derived market facts and the legacy `score`. Paid `POST /v1/opportunities` adds `analysis`, `rank`, `scoreBreakdown`, `economicSignals`, and `reasoning` to the matching filtered pool. Production Demand Intelligence billing uses X Layer Mainnet (`eip155:196`) and three ordered native EIP-3009 exact offers (USD₮0, USDC, USDG), each priced at 10000 atomic units (6 decimals, `$0.01`). This current endpoint policy is independent from Gate 0's future reviewed payment profiles and is not a universal transfer-method restriction. See [API](API.md) for the current contract and [STATUS](STATUS.md) for evidence scope.

Demand commitments finance service creation only. They do not buy the Demand Intelligence query or prepay future API usage. After fulfillment, API usage is paid directly to the provider through its x402 endpoint; contributors receive no usage entitlement. UNMET does not custody those service-use payments.

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

Validation runtime: isolated VPS-hosted Bun validation service

Escrow: AgentDemand

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

Historical acceptance at PR #17 baseline `cb346e2a73de917a01e2555363d6b54f4e4a58a7` exercised the current Demand Intelligence billing path only: three Mainnet assets produced paid HTTP 200 responses and durable `SETTLED` records after canonical L2 confirmation, but each response contained an empty opportunities list. See [STATUS](STATUS.md) and the [PR #17 record](https://github.com/riyannode/UNMET/pull/17). This does not prove arbitrary builder API correctness, Gate 0 PASS issuance, builder-paid execution, permanent availability, OKX listing acceptance, provider reliability, Permit2, or generic marketplace compatibility. Gate 0 remains an unpaid challenge inspection; it must not submit a payment or invoke paid endpoint execution.


### 3.3 Configuration-Driven Payment Support

The validation service must load its payment validation policy from an explicitly configured payment profile.

The profile defines:

- profile identifier
- network identifier
- allowed payment schemes
- allowed asset transfer methods
- allowed payment flows and the reviewed default flow for each transfer method
- signing-domain metadata for each enabled asset and transfer method
- accepted assets
- token contract addresses
- token decimals
- supported x402 protocol versions
- maximum payment authorization timeout in seconds
- payment amount rules
- receiver validation rules
- price comparison policy
- demand price asset and decimals for each supported escrow deployment
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

Initial x402 protocol version: 2.

Every payment profile MUST explicitly declare its allowed asset transfer methods. Gate 0 MUST validate the observed method against that profile; an unsupported or ambiguous method cannot produce PASS. Enabling EIP-3009, Permit2, or another method for production requires verified asset/facilitator support and explicitly reviewed configuration.

Every payment profile MUST explicitly declare its allowed payment flows per asset transfer method. For this initial X Layer exact profile, the only allowed paymentFlow is authorization. Explicit authorization is eligible; an omitted paymentFlow resolves to authorization only when the reviewed mechanism/profile defines authorization as that method's default. upfront and escrow are not eligible. Unknown, unsupported, ambiguous, or unresolved paymentFlow cannot produce PASS.

Gate 0 MUST resolve and validate both assetTransferMethod and paymentFlow against the reviewed profile before an offer can qualify. Future upfront or escrow support requires separately reviewed profile/schema semantics and must not be enabled implicitly. These reserved extra fields follow the [x402 V2 mechanism and payment-flow model](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md#61-asset-transfer-methods-and-payment-flow-models); the initial UNMET profile permits only authorization.

The /v1/opportunities billing policy, including PR #17, is not a universal Gate 0 policy. Do not inherit its method restrictions, token choices, or prices. Keep method-specific checks within the reviewed profile model without introducing a generic plugin framework.

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

The UNMET validation service is different.

Validation service: Validates proposed service payment requirements before onchain submission.

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
2. x402 validation service
3. Verifier Signing Authority
4. AgentDemand
5. Existing Bun Backend and Indexer

No BuilderRegistry is required.

No manual builder admission is required.

No curator role is required for selecting builders.

No builder staking or bond is required.


### G0.1 runtime boundary and deployment identity

The initial validation runtime is a dedicated Bun service on an isolated VPS. It is separate from the existing Bun API, its payment database, and x402 settlement. The service has no signing key in its process or environment: a separately protected signer accepts only authenticated, narrowly scoped requests from the validation service and enforces its own policy before signing. Authentication, isolation and signer policy must be independently reviewed and tested on the target VPS before use. A local test cannot establish that host firewall rules or signer isolation are deployed.

Run validator and signer under separate unprivileged identities and isolated namespaces, with neither process able to access the existing API's payment volume, credentials or runtime. Restrict validator target egress to checked public HTTPS destinations, and configure DNS and RPC control paths separately to specific approved endpoints. Deny access to VPS host, metadata, private, reserved and management addresses, including the VPS's own public management addresses. The signer has no arbitrary target egress. Authenticate validator-to-signer requests and enforce the exact typed message, approved deployment and policy, and timestamp bounds at the signer. Key isolation limits key exposure but cannot make a compromised validator's observations truthful: it can request false observations within signer policy.

The runtime must resolve every A and AAAA result, reject non-public, mapped or otherwise special-use addresses, and bind each connection to a checked address. It must reject a mixed public/private answer rather than falling back to any unsafe address, preserve the original DNS hostname for TLS SNI and certificate verification, and revalidate every new connection. DNS resolution alone followed by an independent hostname connection is insufficient. Deny all redirects and proxies and enforce network egress restrictions outside the process as a second boundary. DNS, timeout, connect and TLS failures fail closed. An outbound request must never read a business response body: inspect the bounded 402 header then destroy the response. Admission and concurrency limits must be finite and configured before accepting work. The 10-second deadline applies across resolution, connect, TLS and response headers.

The same reviewed AgentDemand source supports escrow Testnet 1952 and Mainnet 196 through explicit deployment configuration; no chain-specific business logic or source edits. Constructor immutables and runtime bytecode may differ. Each deployment selects its RPC, chain ID, contract, verifier, pinned price denomination and payment profiles. Domain separation uses the selected escrow chain and contract, and AgentDemand checks block.chainid and address(this). The payment network is independent of escrow chain. Mainnet activation requires separate security review, end-to-end verification and owner approval; this plan is neither an audit nor an activation.

Consumer identity is (escrowChainId, escrowContract, demandId). The existing frontend and backend contract modules use one global deployment. Future work must select a deployment explicitly in RPC clients, frontend routes and wallet actions, transaction lifecycle and recovery keys, app action IDs, backend index/checkpoint keys and API responses, and validation profile/denomination lookup. Pending records must retain their originating deployment and never be replayed into another. Future consumers target canonical AgentDemand; the experimental predecessor is retained in Git history, without a dual-version runtime. This is a future interface map, not a claim that these consumers already support multiple deployments.

The unmounted G0.1 transport primitive accepts DNS-name service URLs only (no IP-literal targets), and uses native DNS, TLS and HTTPS over one checked literal peer, and destroys the response immediately after bounded headers. Its resolver and trust roots are trusted service configuration, not caller input. The caller must supply already validated, canonical POST bytes; full request size, duplicate-key, JCS and semantic enforcement belong to G0.2. The per-request DNS resolver is canceled on timeout and late results cannot open a socket. G0.2 must impose finite admission and bound resolver work even when an injected resolver cannot be canceled.

The address policy conservatively permits IPv4 outside the listed special-use subnets and IPv6 within 2000::/3 excluding 2001::/23, 2001:db8::/32, 2002::/16, 2620:4f:8000::/48 and 3fff::/20; mapped and translation addresses outside that range are denied. This is not a claim of exhaustive or current IANA registry equivalence: review the policy and deployment management-address denylist before deployment. Internal transport codes INVALID_TARGET, UNSAFE_ADDRESS and INVALID_RESPONSE map to FAIL; DNS_UNAVAILABLE, TRANSPORT_UNAVAILABLE and TRANSPORT_TIMEOUT map to UNAVAILABLE. HTTP status and challenge semantics remain the future evaluator's responsibility.

Local adversarial tests use real Bun TLS/HTTPS sockets on public-shaped IPv4 and IPv6 loopback addresses inside a fresh network namespace with no external route. They check SNI, original hostname certificate identity, pinned peer, DNS changes, mixed answers, redirects, header bounds, timeout and body cancellation. CI invokes the namespace suite separately. Local Bun 1.4.3 evidence does not establish Bun 1.4.2 CI or target VPS behavior until those environments run it. Neither these tests nor the primitive establishes host egress or signer isolation.

| Existing consumer | Future deployment-identity impact |
| --- | --- |
| frontend/contract.ts: CHAIN_ID, DEMAND_CONTRACT, getPublic, submitService and wallet actions | Select explicit chain, contract, RPC and canonical AgentDemand interface per originating deployment. |
| frontend/main.tsx, frontend/routing.ts: demandHref, parseDemandId; frontend/App.tsx | Carry deployment through routes, views and submission/action identity. |
| frontend/transaction-lifecycle.ts: pending storage and action keys | Include chain and contract in keys and recovery records; preserve originating deployment. |
| frontend/Analytics.tsx, frontend/CreateDemandChat.tsx and model | Bind analytics, creation and display to selected deployment. |
| backend/contract.ts: loadConfig, getPublicClient, AGENT_DEMAND_ABI; backend/server.ts index | Select RPC/contract explicitly; scope index and checkpoint keys by deployment. |
| backend/config.ts, backend/admin.ts | Resolve explicit deployment identity for configuration and administration for canonical AgentDemand. |
| Existing billing and payment modules | Demand Intelligence x402 billing remains independent of escrow deployment selection. |

### Security acceptance matrix

| Gate | Adversarial acceptance requirement | Evidence boundary |
| --- | --- | --- |
| G0.2 | Reject loopback, private, link-local, metadata, mapped IPv6, reserved and mixed DNS answers; bind connection to a checked literal address and reject a different remote peer before HTTP bytes. Exercise rebinding, redirects, oversized headers, timeout and aborted bodies using actual local sockets. | Local socket tests do not prove VPS firewall enforcement. |
| G0.2 | Verify original-host TLS SNI and certificate hostname against a local TLS server; reject mismatched certificates, untrusted chains and attempts to use the pinned IP as identity. | Local TLS results do not prove a deployed transport has the same runtime or configuration. |
| G0.3 | Reject unauthorized signer callers, wrong typed data, deployment, policy, time or expiry; exercise signer failure without issuing PASS. | Local authorization tests do not prove VPS key isolation or custody. |
| G0.6 | Independently verify namespace identities, mount and secret separation, host egress rules, fixed control paths and denied host/metadata/management access on the target VPS; repeat transport and signer negative cases there. | Requires future deployment approval and target-host evidence. |

### Canonical submission interface

AgentDemand exposes only `submitService(uint256 demandId, string serviceUrl, bytes32 evidenceHash, ValidationAttestation attestation, bytes verifierSignature)`; it must not expose the old unguarded three-argument overload. The attestation fields and their order are those of Section 4.10. Validate all bindings, expiry and current verifier before consuming the next nonce and recording the submission atomically. Preserve the existing submission fields and event semantics and add `paymentRequirementsHash` and `validationPolicyId` to AgentDemand's `ServiceSubmitted` event and persistent per-submission record keyed by demandId and nonce. Expose `submissionDigests(uint256 demandId,uint256 nonce) returns (bytes32 paymentRequirementsHash,bytes32 validationPolicyId)`, `submissionNonce(uint256)`, `verifier()`, `verifierAdmin()`, and `setVerifier(address)` with `VerifierRotated(address indexed previousVerifier,address indexed newVerifier)`. The canonical event is `ServiceSubmitted(uint256 indexed demandId,uint256 indexed submissionNonce,address indexed builder,string serviceUrl,bytes32 evidenceHash,uint64 reviewEndsAt,uint128 reviewCommitted,uint128 approvalRequired,bytes32 paymentRequirementsHash,bytes32 validationPolicyId)`. No signer, handler or contract is implemented by G0.1.

### 4.2 Non-Upgradeable Escrow

AgentDemand must be non-upgradeable.

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

Step 4: The frontend requests validation from the validation service.

Step 5: The validation service reads the target demand's canonical onchain requirements.

Step 6: The validation service validates the service's x402 challenge.

Step 7: The validation service checks compatibility against the approved payment profile and demand requirements.

Step 8: If validation fails, the validation service returns a structured error.

Step 9: If validation succeeds, the validation service issues a short-lived signed attestation.

Step 10: The frontend prepares the AgentDemand submission transaction.

Step 11: The builder independently reviews and signs the transaction.

Step 12: AgentDemand verifies the attestation.

Step 13: A valid submission starts supporter review.


### Important

The validation service must not sign the builder's blockchain transaction.

The validation service must not broadcast transactions without the builder's authorization.

The frontend must not report submission success until the transaction receipt and contract state confirm acceptance.


### 4.5 Validation Service Responsibilities

The validation service validates actual observed endpoint payment requirements.

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
- signing metadata matches the approved asset configuration


### Payment Receiver Validation

Check:

- payTo is structurally valid
- payTo matches builder-authorized payment metadata
- receiver information is consistent across the
  submitted details and observed challenge

The receiving wallet may differ from the builder's submission wallet.

If different, that relationship must be explicitly authorized by the builder.

Do not silently assume the two wallets are equal.

The builder must sign the receiver authorization defined in Section 4.8, including when payTo equals builderWallet. The validation service verifies that proof before issuing an attestation. A client-supplied builderWallet alone is not authorization.

This authorization concerns future service payments. Escrow settlement still pays the accepted builder and configured treasury under the existing selective-settlement rules.


### Multiple Payment Offers

Require HTTP 402 and a valid x402 V2 PAYMENT-REQUIRED header. A JSON body alone is insufficient. Validate the envelope and each accepts[] entry against the V2 schema before evaluating compatibility.

Evaluate offers in their original accepts[] order. Select the first offer that passes every required profile, receiver, and demand-price check, including resolution and validation of both assetTransferMethod and paymentFlow. One eligible offer is sufficient for PASS; no eligible offer means FAIL.

Structurally valid unsupported or incompatible alternatives do not invalidate an eligible offer. Report them as unvalidated alternatives, never as covered by the attestation. A malformed envelope or malformed offer fails the challenge.

Return the selected offer and its zero-based index. Only the selected offer enters paymentRequirementsHash. Do not require or imply support for every advertised scheme, network, asset, transfer method, or payment flow.


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

Gate 0 permits same-asset comparison only. Asset identity is the pair (payment network, token contract address), never a token symbol or a bridge-equivalence claim.

For the initial profile, maxUnitPrice retains the frontend's six-decimal USD₮0 price unit. Its payment denomination is eip155:196 / 0x779ded0c9e1022225f8e0630b35a9b54be713736 / 6 decimals. This labels the service-price constraint; it does not equate the Testnet escrow token with the Mainnet token or change escrow accounting.

Trusted configuration must pin this demand price denomination to each approved (escrowChainId, escrowContract). The validation service reads maxUnitPrice onchain and obtains its denomination from that configuration. A request cannot choose or override either value, and a profile update must not reinterpret existing demand prices.

An offer is comparable only when its network, asset address, and verified decimals match the demand price denomination. Compare the atomic integer amount directly with maxUnitPrice using exact integer arithmetic: amount <= maxUnitPrice. Reject invalid, negative, fractional, out-of-range, or inconsistent amounts. Do not round or use floating point.

For this initial denomination, USDC, USDG, another network's token, and any other different asset remain unsupported comparisons, even if independently supported by OKX. Such an offer cannot qualify for PASS. Return UNSUPPORTED_PRICE_COMPARISON when no offer is eligible because its denomination differs; do not apply a conversion rate, oracle, or stablecoin-parity assumption.

Every enabled profile must declare its price denomination and comparison policy. Missing or unverified configuration prevents PASS. Future comparison policies require separate review and must preserve the meaning of existing demand economics.


### 4.7 Validation Results

The validation service returns exactly one result category:

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

The validation service could not reliably complete the required checks.

Examples:

- RPC unavailable
- endpoint timeout
- required external dependency unavailable
- signer unavailable

UNAVAILABLE must not become PASS.

No successful attestation may be issued.


### 4.8 Validation Service Endpoint

Proposed endpoint:

POST /v1/x402/validate

This endpoint is hosted by the validation service.

The frontend calls it before preparing the onchain submission.


### Required Request Data

Accept a JSON object with these fields only:

| Field | Type and rule |
| --- | --- |
| schemaVersion | Literal unmet-x402-validation-v1 |
| escrowChainId, demandId, submissionNonce | Unsigned decimal strings; nonce must equal the onchain current nonce plus one |
| escrowContract, builderWallet, authorizedPayTo | Nonzero EVM addresses |
| serviceUrl | Absolute HTTPS URL, serialized with the WHATWG URL serializer; no credentials, query, or fragment; at most 512 UTF-8 bytes |
| evidenceHash | Nonzero bytes32 hex string |
| paymentNetwork | CAIP-2 identifier matching an enabled approved profile |
| request | Object containing method, query, contentType, and body only |
| builderAuthorization | Object containing issuedAt, expiresAt, and signature only |

request.method is GET or POST. request.query is an ordered array of [name, value] string pairs, including repeated names when needed; an empty array means no query parameters. Append these pairs to serviceUrl with URLSearchParams in the supplied order. The resulting request URL must not exceed 2048 UTF-8 bytes.

GET requires contentType and body to be null. POST requires contentType application/json and a JSON-object body, including {} for an empty object. Send POST bytes as UTF-8 RFC 8785/JCS without a trailing newline. Accept only I-JSON data; reject duplicate keys, invalid Unicode, non-finite numbers, and integer JSON numbers outside the safe integer range. Large integers must be strings.

The complete validation request is limited to 32 KiB, at most 32 query pairs, and JSON nesting depth 8, counting the outer object as depth 1. Reject unknown fields. Inputs must be public business test data; APIs requiring caller-provided secrets are outside this validation model. Do not accept caller-defined headers, Authorization, cookies, bearer tokens, scripts, or alternative protocols. The validation service sets Accept: application/json and the specified POST Content-Type; it never forwards the caller's headers or credentials to the service.

requestHash is SHA-256 of the UTF-8 JCS bytes of {schemaVersion: "unmet-http-request-v1", url: resultingRequestUrl, method, contentType, body}. Query pair order is preserved in url. Builder, frontend, and validation service must use the same resulting URL and request bytes.

### Builder Receiver Authorization

Use the EIP-712 domain defined in Section 4.10 and this separate primary type, with fields in the order shown:

```solidity
struct BuilderValidationAuthorization {
    uint256 demandId;
    address builderWallet;
    bytes32 serviceUrlHash;
    bytes32 evidenceHash;
    bytes32 requestHash;
    bytes32 paymentNetworkHash;
    address authorizedPayTo;
    uint256 submissionNonce;
    uint64 issuedAt;
    uint64 expiresAt;
}
```

paymentNetworkHash is keccak256 of the exact UTF-8 paymentNetwork string. Derive the other fields from this request; use the URL/evidence rules in Section 4.10. Times are unsigned decimal strings in the JSON request and obey Section 4.11. signature is hex-encoded bytes, at most 4096 bytes.

The validation service must recover builderWallet for an EOA signature using Section 4.10's ECDSA encoding or verify ERC-1271 on the escrow chain for a contract wallet. Invalid signatures fail; unavailable RPC verification returns UNAVAILABLE. The signature authorizes only this request and receiver, not a transaction, payment, or escrow withdrawal. The selected offer's network and payTo must match the authorization. Attestation expiry must not exceed authorization expiry.

The validation service must not trust client-provided economic fields as canonical.

It must read and verify the relevant onchain demand state. Trusted configuration must select exactly one profile for the requested escrow deployment and paymentNetwork; missing or ambiguous profile configuration cannot produce PASS.


### Success Response

- status: PASS
- payment profile identifier
- selected offer and its original accepts[] index
- requestHash and validationPolicyId
- validated payment requirements digest
- validation timestamp
- attestation expiration
- signed attestation

Return the complete typed attestation fields and signature so the frontend can recompute the digest and bind submission to its originating wallet, demand, URL, evidence, and nonce. PASS uses HTTP 200; FAIL uses HTTP 400; UNAVAILABLE uses HTTP 503. Neither failure response contains an attestation.


The proposed response field names are defined by [validation-response.json](schemas/validation-response.json): PASS includes `profileId`, `selectedOffer`, `selectedOfferIndex`, `requestHash`, `validationPolicyId`, `paymentRequirementsHash`, `validatedAt`, `expiresAt`, `attestation`, and `signature`. FAIL and UNAVAILABLE contain `code`, `message`, and boolean `retryable`, and cannot contain an attestation. The request and policy schemas are [validation-request.json](schemas/validation-request.json) and [validation-policy.json](schemas/validation-policy.json). These schemas specify structural constraints only. Duplicate raw keys, invalid Unicode, safe integer and uint256 bounds, UTF-8 byte limits, depth, exact URL serialization, ordering and cross-field constraints require semantic checks before canonicalization. They do not enforce connect-time network safety.

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


### 4.9 Validation Service Security

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

Use Section 4.8's request exactly. Follow no redirects. Resolve and enforce public-address restrictions on the actual connection, including IPv4/IPv6 and DNS rebinding; a preliminary DNS check followed by an unchecked connection is insufficient. If the transport cannot enforce this, return UNAVAILABLE without contacting the endpoint.

Limit the endpoint request to 10 seconds and PAYMENT-REQUIRED to 16 KiB of encoded header data. Parse only that header; cancel the response body without consuming business output. Apply a finite configured concurrency limit before outbound work; if the limit is absent or exhausted, return UNAVAILABLE. Never attach payment proof or retry the endpoint with a payment.

Transport failures, timeouts, and endpoint HTTP 5xx return UNAVAILABLE. Other non-402 responses, redirects, oversized headers, and invalid challenges return FAIL.

Do not expose:

- verifier signing credentials
- private API credentials
- bearer tokens
- sensitive internal responses
- unrelated environment variables

Do not log complete secret-bearing headers.


### 4.10 Signed Validation Attestation

The separately protected signer signs successful validation results using the configured verifier identity after authenticating the service request.

The validation attestation must use EIP-712 typed structured data.

Use domain fields in EIP-712 order: name = "UNMET AgentDemand", version = "2", chainId = escrowChainId, verifyingContract = escrowContract. Do not include salt. Both authorization types use this domain; their distinct primary types prevent cross-use.

The verifier signs primary type ValidationAttestation with these exact names, types, and field order:

```solidity
struct ValidationAttestation {
    uint256 escrowChainId;
    address verifyingContract;
    uint256 demandId;
    address builderWallet;
    bytes32 serviceUrlHash;
    bytes32 evidenceHash;
    bytes32 paymentRequirementsHash;
    uint256 submissionNonce;
    bytes32 validationPolicyId;
    uint64 issuedAt;
    uint64 expiresAt;
}
```

Encode the digest with EIP-712 hashStruct and domain separation, not personal_sign or packed struct encoding. The initial verifier uses a 65-byte low-s ECDSA signature with v equal to 27 or 28. JSON representations of typed-data unsigned fields are canonical decimal strings without leading zeros except "0"; addresses and bytes32 values use lowercase 0x-prefixed hex and must fit their declared widths.

serviceUrlHash is keccak256 of the exact UTF-8 serialized serviceUrl accepted in Section 4.8. The builder must submit that same string without later normalization. evidenceHash is the exact nonzero bytes32 submitted onchain; the frontend preserves the existing rule of hashing UTF-8 evidence references with keccak256 when the input is not already bytes32.

AgentDemand must match the domain and signed escrowChainId/verifyingContract fields to block.chainid and address(this), builderWallet to msg.sender, demandId to the target demand, URL/evidence hashes to the submitted arguments, and submissionNonce to the current nonce plus one. Accepting the submission consumes that nonce atomically. Reopen never makes a consumed nonce reusable.

### Public Validation Policy Encoding

validationPolicyId is SHA-256 of the UTF-8 RFC 8785/JCS bytes of the public envelope defined below, with no BOM or trailing newline. Represent the 32-byte output as lowercase 0x-prefixed hex. Do not hash a runtime configuration object or serialize additional implementation fields.

All listed object keys are required, including nullable keys. No key may be omitted; no unknown key is allowed at any level. Null is a JSON null, never the string "null". A missing optional value is represented by null at its declared key. Other values have the exact types below; there are no implicit defaults.

| Object / field | Exact type or members |
| --- | --- |
| envelope | Object with schemaVersion, escrowChainId, escrowContract, profile, demandPriceAsset |
| schemaVersion | String literal unmet-validation-policy-v2 |
| escrowChainId | Positive uint256 encoded as a decimal string |
| escrowContract | Address |
| profile | Object with id, enabled, network, x402Versions, schemes, assets, paymentRules, receiverRules, facilitator |
| profile.id | String matching ^[a-z0-9][a-z0-9-]{0,63}$ |
| profile.enabled | JSON boolean |
| profile.network | Network string |
| profile.x402Versions | Nonempty array of JSON integer protocol versions; this schema version supports only 2 |
| profile.schemes | Nonempty array of strings; this schema version supports only exact |
| profile.assets | Nonempty array of asset objects |
| asset object | Object with asset, decimals, enabled, defaultTransferMethod, transferMethods |
| asset.asset | Address identifying the token on profile.network |
| asset.decimals | JSON integer from 0 through 255, not a string |
| asset.enabled | JSON boolean |
| asset.defaultTransferMethod | Method identifier or null; a non-null value must name a transferMethods entry |
| asset.transferMethods | Nonempty array of transfer-method objects |
| transfer-method object | Object with method, enabled, paymentFlows, defaultPaymentFlow, tokenDomain, permit2Contract, settlementSpender |
| method | Case-sensitive string eip3009 or permit2 in this schema version |
| enabled in a transfer-method object | JSON boolean |
| paymentFlows | Nonempty array of case-sensitive flow strings; this schema version permits only authorization |
| defaultPaymentFlow | String authorization or null; a non-null value must appear in paymentFlows and identify the reviewed mechanism/profile default for this method |
| tokenDomain | Object with nonempty UTF-8 string name and version, or null |
| permit2Contract, settlementSpender | Address or null |
| profile.paymentRules | Object with amountType, priceComparison, maxTimeoutSeconds |
| amountType, priceComparison | String literals uint256 and same-asset-exact, respectively |
| maxTimeoutSeconds | Positive JSON integer no larger than 9007199254740991; seconds, not milliseconds or a numeric string |
| profile.receiverRules | Object with mode and allowZeroAddress |
| mode, allowZeroAddress | String literal builder-authorized and JSON boolean false, respectively |
| profile.facilitator | Object with id and url, or null when public facilitator metadata is absent |
| facilitator.id | String using the profile.id syntax |
| facilitator.url | Absolute HTTPS URL in WHATWG serialized form, without credentials, query, or fragment |
| demandPriceAsset | Object with network, asset, decimals; Network string, Address, and JSON integer 0 through 255, respectively |

Address means exactly 0x followed by 40 lowercase hexadecimal digits, excluding the zero address. Construct normalized lowercase addresses from verified configuration; reject a public envelope that is not already normalized. Do not perform checksum-case serialization.

For this EVM policy schema, Network string means eip155: followed by a positive canonical decimal uint256 chain ID of at most 32 digits, respecting the [CAIP-2 reference limit](https://standards.chainagnostic.org/CAIPs/caip-2#syntax). Preserve the exact string; reject aliases, whitespace, case variants, signs, and leading zeros. Decimal uint strings contain only ASCII digits, have no leading zero, and must fit uint256; zero is encoded as "0" only for fields permitting zero. Domain names and versions preserve their exact Unicode content without case folding or Unicode normalization.

Only the policy's x402Versions, schemes, assets, transferMethods, and paymentFlows arrays represent sets. This does not reorder the observed accepts[] array or request query pairs. Serialize x402Versions in ascending numeric order, schemes and paymentFlows in ascending ASCII order, assets by lowercase asset address, and transferMethods by method in ascending ASCII order. Reject duplicates and unsorted envelopes. JCS sorts object keys but never sorts these arrays. Include every listed asset and method, including disabled entries; never filter them before hashing. Every enabled boolean participates in the digest, and an offer is eligible only when the profile, asset, and selected method are all enabled and the resolved flow is allowed for that method.

An eip3009 entry requires tokenDomain to be an object and permit2Contract/settlementSpender to be null. A permit2 entry requires tokenDomain to be null and both contract addresses to be non-null verified configuration. These are public validation inputs, not proof of future settlement. Null defaultTransferMethod means that the observed challenge must explicitly identify its method. A declared default may resolve an omitted method only when the scheme/version permits that default and the matching method is enabled and reviewed. Never infer a method from the token symbol, the number of entries, or intelligence billing code.

Resolve the observed extra.paymentFlow only after resolving the method. An explicit authorization is eligible when listed in that method's paymentFlows. Omission may use defaultPaymentFlow only when it is authorization and the reviewed mechanism/profile defines that default; null means omission is ineligible. An explicit JSON null, non-string value, unknown identifier, or ambiguous/unsupported method-flow combination cannot qualify. Never infer a flow from a single allowed entry or from a different method's default. Both paymentFlows and defaultPaymentFlow participate in validationPolicyId. This schema rejects upfront and escrow even if an external mechanism supports them; enabling either requires separately reviewed profile/schema semantics.

demandPriceAsset is the pinned denomination from Section 4.6; it cannot be chosen by a request. maxTimeoutSeconds caps the selected offer's payment authorization timeout; it does not replace Section 4.9's endpoint timeout or Section 4.11's 900-second lifetime and 60-second skew. Runtime secrets, RPC credentials, concurrency counters, and unrelated application settings are excluded from this public envelope. Section 4.8/4.9's fixed request rules are part of this schema version.

Reject duplicate JSON keys, invalid Unicode, non-finite numbers, and type/range violations before JCS. Changing the schema or interpretation of a field requires a reviewed schema version. Other transfer methods or network families require a reviewed schema extension and corresponding checks, not an arbitrary metadata/plugin object or an automatic escrow redeployment. Policy value changes produce a new digest.

The separately protected signer signs only the configured policy digest. Policy updates affect new validations; issued attestations remain valid until expiry unless their verifier is rotated out. The contract authenticates that observation through the current verifier and records validationPolicyId and paymentRequirementsHash with the accepted submission. It does not parse HTTP, recompute the payment observation, or hardcode the initial payment network/profile as its only allowable policy ID. A reviewed profile for another payment network must not itself require a new escrow deployment.

### Payment Requirements Digest

paymentRequirementsHash is SHA-256 of the UTF-8 RFC 8785/JCS bytes of this envelope, without a trailing newline:

```text
{schemaVersion: "unmet-payment-requirements-v2", x402Version: 2,
 resource: normalizedResource, requestHash, selected: normalizedSelectedOffer}
```

normalizedResource preserves the observed resource fields, with resource.url resolved against the requested URL using the WHATWG URL serializer. Reject credentials, fragments, a different origin/path, or a nonempty resource query different from the requested query. A resource URL without query may identify the protected path; requestHash still binds the exact query and body.

normalizedSelectedOffer contains scheme, network, asset, amount, payTo, maxTimeoutSeconds, and extra only. Preserve the exact scheme/network identifiers; lowercase EVM addresses; parse amount as uint256 and serialize it as a canonical decimal string; require maxTimeoutSeconds to be a positive safe integer in seconds within the profile's explicit limit. Preserve all extra fields, with extra.assetTransferMethod and extra.paymentFlow set to the resolved profile-approved method and flow. Resolve explicit values or reviewed defaults under the policy rules above; an unresolved, unsupported, or ambiguous method or flow makes the offer ineligible. An absent extra becomes an object before normalization. The resolved paymentFlow MUST be present in normalizedSelectedOffer.extra, including when the observed offer omitted it, so paymentRequirementsHash commits to the flow. An omitted flow resolved to authorization and explicit authorization produce the same normalized bytes when all other fields match. This rule applies to each reviewed method and does not impose an EIP-3009-only policy.

Reject duplicate JSON keys and invalid I-JSON before canonicalization. JCS orders object properties; it does not reorder arrays. Do not include other accepts[] entries, their index, the error text, response body, or unrelated headers in this digest. Reordering alternatives may change which offer is selected; an unchanged selected offer and request produce the same digest. This digest attests only the selected payment option, not the complete advertised challenge.

SHA-256 digests above are bytes32 values represented as lowercase 0x-prefixed hex. These canonical UTF-8 fixtures have no trailing newline and test encoding only; example.com and the receiver below do not identify an available service or prove payment support.

```json
{"body":{"city":"Jakarta"},"contentType":"application/json","method":"POST","schemaVersion":"unmet-http-request-v1","url":"https://example.com/weather"}
```

requestHash: 0x300a359dba184b381483e10749404aeb8918e6f27983cc8001c27c4929d4eec8

```json
{"requestHash":"0x300a359dba184b381483e10749404aeb8918e6f27983cc8001c27c4929d4eec8","resource":{"url":"https://example.com/weather"},"schemaVersion":"unmet-payment-requirements-v2","selected":{"amount":"10000","asset":"0x779ded0c9e1022225f8e0630b35a9b54be713736","extra":{"assetTransferMethod":"eip3009","name":"USD₮0","paymentFlow":"authorization","version":"1"},"maxTimeoutSeconds":60,"network":"eip155:196","payTo":"0x0000000000000000000000000000000000000001","scheme":"exact"},"x402Version":2}
```

paymentRequirementsHash: 0xce3247c6f8737f0713bb03c15354865a14ead04210ca05d7578752d095175d49

### Literal Policy and EIP-712 Vectors

These are public, synthetic encoding fixtures. Their addresses, enabled flags, and method settings do not approve a production profile or imply an available service. No signing key, signature, RPC call, or transaction is needed to reproduce the digests. Use the exact struct definitions above; the domain type is EIP712Domain(string name,string version,uint256 chainId,address verifyingContract).

#### A. validationPolicyId

Canonicalize this complete envelope with JCS and hash the resulting UTF-8 bytes with SHA-256:

The fixture gives its synthetic eip3009 entry an authorization default; its permit2 entry requires explicit paymentFlow. These values exercise both cases without approving either production mechanism's default.

```json
{
  "schemaVersion": "unmet-validation-policy-v2",
  "escrowChainId": "1952",
  "escrowContract": "0x1111111111111111111111111111111111111111",
  "profile": {
    "id": "codec-fixture",
    "enabled": true,
    "network": "eip155:196",
    "x402Versions": [
      2
    ],
    "schemes": [
      "exact"
    ],
    "assets": [
      {
        "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        "decimals": 6,
        "enabled": true,
        "defaultTransferMethod": null,
        "transferMethods": [
          {
            "method": "eip3009",
            "enabled": true,
            "paymentFlows": [
              "authorization"
            ],
            "defaultPaymentFlow": "authorization",
            "tokenDomain": {
              "name": "USD₮0",
              "version": "1"
            },
            "permit2Contract": null,
            "settlementSpender": null
          },
          {
            "method": "permit2",
            "enabled": true,
            "tokenDomain": null,
            "paymentFlows": [
              "authorization"
            ],
            "defaultPaymentFlow": null,
            "permit2Contract": "0x3333333333333333333333333333333333333333",
            "settlementSpender": "0x4444444444444444444444444444444444444444"
          }
        ]
      }
    ],
    "paymentRules": {
      "amountType": "uint256",
      "priceComparison": "same-asset-exact",
      "maxTimeoutSeconds": 300
    },
    "receiverRules": {
      "mode": "builder-authorized",
      "allowZeroAddress": false
    },
    "facilitator": null
  },
  "demandPriceAsset": {
    "network": "eip155:196",
    "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    "decimals": 6
  }
}
```

Expected validationPolicyId: `0xe0067e7f39455d7a4b9587fa4b197a61d0e2aaf308650960b88e902cfbd2a691`.

#### B. BuilderValidationAuthorization

```json
{
  "domain": {
    "name": "UNMET AgentDemand",
    "version": "2",
    "chainId": "1952",
    "verifyingContract": "0x1111111111111111111111111111111111111111"
  },
  "primaryType": "BuilderValidationAuthorization",
  "message": {
    "demandId": "9007199254740993",
    "builderWallet": "0x2222222222222222222222222222222222222222",
    "serviceUrlHash": "0xeebff726b9796bc70b7b17226d7f6fe9d11fb311d21a7eb11662c45cb2283e81",
    "evidenceHash": "0xef49c6e023e5910e309c7ce7e15902489f2828504016ac4f765edb049e757d48",
    "requestHash": "0x300a359dba184b381483e10749404aeb8918e6f27983cc8001c27c4929d4eec8",
    "paymentNetworkHash": "0xefa922b302ee91bbef8a50fbd535e6277fb2e0c069dbc7cf376483bd56ca7095",
    "authorizedPayTo": "0x0000000000000000000000000000000000000001",
    "submissionNonce": "1",
    "issuedAt": "1792886400",
    "expiresAt": "1792887300"
  }
}
```

| Result | Literal expected value |
| --- | --- |
| typeHash | `0x3106130d2f2debb598f33e31a4a5c4de61d71023209b265d6bd7d65004a304fe` |
| domainSeparator | `0x5f4cb5a0f9b354d673e444109a9e548a6103bf9b43c23fc3a00f329c0e2fb42a` |
| structHash | `0x7f295adbc67658dfd5561880112a18fc8302ca4bbe4d21ce3f07f8c8c03d0beb` |
| digest | `0xad07348d634d39a1aecc174a1eaa6b3316a349f257fc30c1d3f9347745da7cc7` |

#### C. ValidationAttestation

```json
{
  "domain": {
    "name": "UNMET AgentDemand",
    "version": "2",
    "chainId": "1952",
    "verifyingContract": "0x1111111111111111111111111111111111111111"
  },
  "primaryType": "ValidationAttestation",
  "message": {
    "escrowChainId": "1952",
    "verifyingContract": "0x1111111111111111111111111111111111111111",
    "demandId": "9007199254740993",
    "builderWallet": "0x2222222222222222222222222222222222222222",
    "serviceUrlHash": "0xeebff726b9796bc70b7b17226d7f6fe9d11fb311d21a7eb11662c45cb2283e81",
    "evidenceHash": "0xef49c6e023e5910e309c7ce7e15902489f2828504016ac4f765edb049e757d48",
    "paymentRequirementsHash": "0xce3247c6f8737f0713bb03c15354865a14ead04210ca05d7578752d095175d49",
    "submissionNonce": "1",
    "validationPolicyId": "0xe0067e7f39455d7a4b9587fa4b197a61d0e2aaf308650960b88e902cfbd2a691",
    "issuedAt": "1792886400",
    "expiresAt": "1792887300"
  }
}
```

| Result | Literal expected value |
| --- | --- |
| typeHash | `0x67beb001f81b85e71e91091bf36753e1a578fbec204642b1bee40134161f22dd` |
| domainSeparator | `0x5f4cb5a0f9b354d673e444109a9e548a6103bf9b43c23fc3a00f329c0e2fb42a` |
| structHash | `0x57d9261a3e04d73fc8c39e6d110b718b839c7816a76830d61ac2ff951e53927d` |
| digest | `0x2917ee6a3d428ef2088a6f96d9873f46dbba4cf3da8c9cd75a3b0dd2ec284301` |

For both EIP-712 vectors, digest = keccak256(0x1901 || domainSeparator || structHash), concatenating raw bytes rather than hex text. The URL preimage is https://example.com/weather; the evidence preimage is unmet-codec-fixture; paymentNetworkHash hashes the UTF-8 string eip155:196. requestHash and paymentRequirementsHash are the earlier literal fixtures. demandId deliberately exceeds the JavaScript safe-integer range and must remain a string until parsed as uint256.

These literal outputs were independently reproduced with Python eth-account 0.14.0 plus rfc8785 0.1.4, and Node.js ethers 6.17.0 plus canonicalize 5.1.0. The implementations agreed on canonical policy bytes, SHA-256, EIP-712 type hashes, domain separator, struct hashes, and final digests. Acceptance tests must compare against the published literals, not regenerate expected values with the encoder under test.

Contract, validation service, and frontend acceptance tests must share literal domain, type-hash, authorization, attestation, URL/evidence, and request/payment-digest vectors. Include reordered object keys, changed request/receiver/policy fields, reordered alternatives, and a large atomic amount encoded as a string. A shared implementation producing its own expected values is not a golden-vector test.

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

The maximum lifetime is 15 minutes (900 seconds), with at most 60 seconds of future clock skew. All timestamps are Unix seconds.

For the builder authorization, the validation service enforces issuedAt <= now + 60, issuedAt < expiresAt, expiresAt - issuedAt <= 900, and now < expiresAt. It issues attestations with issuedAt equal to its current time and expiresAt no later than min(issuedAt + 900, builderAuthorization.expiresAt).

For attestations, AgentDemand enforces the same inequalities using block.timestamp as now. Exactly 60 seconds of future skew is allowed; 61 is rejected. An attestation expires at expiresAt, including equality. Perform checked comparisons before subtraction. Lifetime runs from issuedAt; future skew does not authorize a longer signed interval.

Expired attestations require a fresh endpoint validation.

The validation service may issue a new attestation only after completing the required checks.

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

AgentDemand has one current verifier and an immutable verifierAdmin, both nonzero constructor parameters. Deployment approval must identify those addresses and the custody of their credentials; do not infer either role from the treasury or a builder.

Only verifierAdmin may call setVerifier(address newVerifier). Reject the zero address and emit VerifierRotated(previousVerifier, newVerifier). Only the current verifier's attestations are accepted; rotation takes effect immediately, without an old-key grace period. Already accepted submissions, votes, settlement, and refunds remain valid and unchanged.

verifierAdmin has no other administrative setter or privileged escrow action. It cannot change itself, funds, fees, quorum, deadlines, recipients, votes, or refund eligibility. Verifier rotation does not make the contract upgradeable and is not required for finalize(), reopen(), or refund().

A compromised validation service can supply false observations even if the signing key remains isolated. A compromised verifier can authorize invalid submissions.

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

A failed endpoint validation does not change escrow state.


### 4.14 Supporter Voting

Preserve commitment-weighted voting.

Supporters may:

- approve the current submission
- reject the current submission

A supporter cannot both approve and reject the same submission nonce.

Votes must not be counted twice.

Voting weight is derived from the fixed review commitment snapshot.

The validation service cannot cast supporter votes.


### 4.15 Immediate Finalization

### Decision:
Immediate Finalization at Quorum.

The configured approval quorum is 60%.

Once the required approval weight is reached, any account may call finalize() immediately.

The full review period does not need to elapse first.

The 24-hour review period is a voting window, not a mandatory minimum payout delay.

Finalization must not require:

- validation service availability
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

endpoint validation does not extend it.

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


### 4.19 Validation Service Availability

The validation service is required to issue new validation attestations.

The validation service must not be required for:

- supporter approval
- supporter rejection
- finalize()
- reopen()
- refund()

A validation service outage may prevent new submissions.

It must not prevent eligible settlement or fund recovery.


### 4.20 Verification Terminology

Use distinct states.


### X402_COMPATIBLE

The validation service observed payment requirements that satisfied the configured validation policy at a specific time.


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
33. Domain, field encodings, policy digest, and nonce match the shared literal vectors; consumed nonces remain unusable after reopen.
34. Lifetime and future-skew boundaries follow Section 4.11, including exact expiry, inverted intervals, 900/901-second lifetime, and 60/61-second future skew.
35. Rotation rejects unauthorized callers and zero addresses; the previous verifier is rejected while a different verifier is current; accepted proposals and fund-recovery paths are unaffected.


### 5.2 Validation Service Tests

Required:

Offer-rejection cases use a challenge with no eligible alternative. Mixed-offer challenges follow Section 4.5's selection rule.

1. Valid configured profile accepted.
2. Unknown profile rejected.
3. Disabled profile rejected.
4. Valid x402 challenge accepted.
5. Malformed challenge rejected.
6. Unsupported protocol version rejected.
7. Unsupported scheme cannot qualify an offer for PASS.
8. Unsupported network cannot qualify an offer for PASS.
9. Unsupported asset cannot qualify an offer for PASS.
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
28. GET/POST schemas, query ordering, canonical body bytes, header restrictions, and every request bound are enforced.
29. Builder authorization binds the request, network, receiver, demand, evidence, and next nonce; invalid EOA/ERC-1271 proofs fail and unavailable verification never passes.
30. Mixed offers select the first eligible option, leave unsupported alternatives unvalidated, and fail malformed challenges or lists with no eligible offer.
31. Request and selected-offer digests match shared literal vectors; changed request, receiver, or policy cannot reuse a signed result.
32. Same-asset atomic comparison accepts equality and rejects excess; cross-asset/network comparison, assumed parity, and inconsistent decimals cannot produce PASS.
33. Authorization and attestation timing obey Section 4.11; current-verifier changes cannot produce a falsely usable attestation.
34. The public policy envelope enforces exact keys/types, explicit nulls, canonical arrays, addresses/network strings, disabled flags, and method-specific rules; literal policy and both EIP-712 vectors match independent implementations.
35. Both assetTransferMethod and paymentFlow must resolve against the reviewed profile. Explicit authorization and omission with a reviewed authorization default are eligible; omission without that default, explicit null, upfront, escrow, unknown flows, and unsupported/ambiguous combinations cannot produce PASS. An ineligible flow alternative does not poison an eligible authorization offer.
36. The normalized selected offer always includes its resolved paymentFlow in extra. Equivalent omitted/defaulted and explicit authorization hash identically; changing the committed flow changes the digest and does not make that flow eligible. Profile flow/default changes alter validationPolicyId; upfront/escrow cannot be enabled under this schema.


### 5.3 Frontend Tests

Required:

1. Validation loading state.
2. Invalid URL error.
3. Network incompatibility error.
4. Asset incompatibility error.
5. Price incompatibility error.
6. validation service unavailable state.
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
16. Builder receiver authorization and attestation details remain bound to the originating wallet and demand across validation service calls.
17. Changed endpoint, request, evidence, receiver, network, or nonce requires fresh authorization and validation; rotation invalidation is handled without resubmitting an unknown transaction.

Existing valid tests must not be deleted or weakened.


## 6. CANONICAL AGENTDEMAND ESCROW

The earlier AgentDemand implementation was an experimental development predecessor and has been replaced. The current AgentDemand source is the canonical attestation-gated escrow.

There is one canonical escrow implementation and test suite. Git history preserves the experiment. No dual-version compatibility router, deployment-version selector, legacy frontend/indexer or migration framework is planned.

### Gate boundaries

G0.4 implements the non-upgradeable attestation-gated escrow and contract tests. It does not deploy the canonical contract, change live addresses, migrate funds or modify existing onchain contracts and balances.

G0.5 covers canonical AgentDemand frontend/backend, indexer and deployment-tool integration: ABI consumers, validation/submission flow, event indexing and multi-deployment identity. The G0.5 source uses a shared canonical ABI, deployment-scoped identity and attestation submission. The configuration remains unavailable for escrow writes until a separately approved canonical contract address is supplied.

`backend/admin.ts` disables `deploy-testnet` and `deploy-mainnet` locally with `DEPLOYMENT_TOOLING_UNAVAILABLE`, before key, RPC, artifact or transaction work. The obsolete six-argument deployment flow has been removed. G0.5 adds offline eight-argument planning and read-only parameter verification; broadcast commands remain disabled. No current repository command may deploy canonical AgentDemand.

Historical deployment records remain evidence of earlier experiments. They do not establish support for the experimental predecessor or authorize any blockchain action.

### Canonical Demand Identity

Use `(escrowChainId, escrowContract, demandId)` for canonical contract consumers. Demand IDs are not globally unique across Testnet/Mainnet or separate deployments. Pending records retain their originating deployment.

### Future Contract Versions

Deploy a new immutable escrow only when changing onchain voting, settlement, refund, custody or incompatible submission-verification behavior, with explicit approval. RFQ metadata, analytics, service discovery and resolver improvements do not automatically require escrow redeployment.


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


### 9.5 External Distribution

OKX.AI HTTP A2MCP is the initial external distribution integration for suitable fulfilled APIs. Publication is optional and non-canonical. The provider supplies service name, description including returned results, GET/POST method, input parameter names/types/meaning/required status, and the public endpoint. Price and payment requirements come from the endpoint's actual x402 behavior, not a replacement listing price declared by UNMET.

Initial OKX.AI distribution does not assume a public programmatic listing API. Publication must use the currently supported OKX registration flow unless a programmatic interface is separately verified and approved.

Gate 0 compatibility does not imply OKX registration approval or successful paid execution. Registration, publication, and paid acceptance require their own approval and evidence; Gate 0 does not perform them.

The Service Registry preserves canonical demand-to-service references and authenticated provider metadata. Direct x402 consumption remains supported, and other compatible marketplaces or discovery protocols may be added through separately reviewed integrations. A distribution channel does not require AgentDemand to fetch its APIs or change its payment policy.

External listing is not fulfillment evidence. Listing failure, delisting, and marketplace outages cannot modify historical provenance or block demand creation, funding, supporter voting, finalize(), reopen(), or refund(). UNMET does not add marketplace checkout, service-payment custody, or a generalized payment router for this integration. Future API consumption remains a separate direct x402 payment to the provider's authorized receiver.


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
- allowed asset transfer methods, payment flows, and reviewed defaults
- assets
- token identity
- validation rules
- price comparison policy

A builder request cannot modify approved payment profiles.


### Validation Service

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
- non-upgradeable AgentDemand
- configuration-driven x402 validation service
- initial OKX/X Layer payment profile
- safe endpoint validation
- signed attestation specification
- onchain signature verification
- verifier authority model
- frontend submission integration
- preserved voting and refunds
- canonical AgentDemand consumer integration
- contract and validation service regression tests

Execution is serial: one gate, branch and Draft PR at a time, with owner review before the next gate. Merge, deployment, paid tests and Mainnet activation require separate authorization.

| Gate | Scope and dependency | Acceptance |
| --- | --- | --- |
| G0.1 | Architecture, policy schemas, threat model, vectors and impact map; owner approval | Review schemas, vectors and transport evidence in Sections 3-6. |
| G0.2 | Configuration-driven x402 validation service; G0.1 | Unpaid bounded challenge inspection and adversarial transport tests. |
| G0.3 | Builder authorization, EIP-712 and verifier security; G0.1-G0.2 | Authorization, replay, signer policy and isolation tests. |
| G0.4 | Canonical non-upgradeable AgentDemand; G0.1 and G0.3 | Attestation, nonce/replay, verifier authority and escrow regression tests. |
| G0.5 | Canonical AgentDemand frontend/backend, indexer and deployment-tool integration; G0.2-G0.4 | Canonical ABI, attestation submission, multi-deployment identity and recovery tests. |
| G0.6 | Full Gate 0 E2E, adversarial and release readiness; all prior G0 gates | Independent target-host, signer and end-to-end evidence. |
| G1 | Machine-readable RFQ; G0.6 | Section 7 acceptance. |
| G2 | Fulfilled service registry; G1 and canonical fulfillment | Section 8 acceptance. |
| G3 | x402 service discovery and optional A2MCP distribution; G2 and G0 validator | Section 9 acceptance. |
| G4 | Demand Intelligence expansion; G1-G3 | Section 10 acceptance. |
| G5 | Automatic capability resolver; G1, G3 and G4 | Section 11 acceptance. |

The local G0.3 source implements builder authorization and a separate authenticated attestation signer. G0.4 implements onchain attestation consumption and monotonic nonce replay prevention in the canonical AgentDemand escrow. G0.5 integrates these canonical consumers; local signer, consumer and contract tests do not establish target-host isolation or G0.6 readiness.

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
- optional OKX.AI HTTP A2MCP distribution with canonical escrow independence


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


### Validation Service

- Validate on demand.
- Avoid permanent polling.
- Load approved payment profiles.
- Do not hardcode network-specific
  validation behavior.
- Protect against SSRF.
- Use bounded requests.
- Gate 0 challenge inspection is unpaid: do not attach payment proof, replay a paid request, or invoke settlement.
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
- validation service tests
- backend tests
- frontend tests
- typecheck
- lint where available
- frontend production build

Do not remove valid tests to obtain passing results.

Unavailable checks must be reported honestly.


## 16. KNOWN RISKS AND LIMITATIONS

### 1. Verifier Trust

The validation service can authorize new submissions.

Its signing authority must be protected.

A compromised verifier may approve invalid submission metadata.

The verifierAdmin is trusted to select the current signing authority; its compromise can also admit invalid submissions, but grants no privileged settlement or withdrawal path.


### 2. Endpoint Mutability

Providers may change endpoint behavior after validation.

Historical attestations cannot guarantee future service availability.


### 3. Service Quality

A valid x402 challenge does not prove paid execution correctness.


### 4. Permissionless Spam

Automatic compatibility checks do not fully eliminate proposal griefing.


### 5. Validation Service Availability

Validation service outages may interrupt new submissions.

They must not interrupt eligible finalization or refunds.


### 6. Price Comparison

Cross-asset comparisons are unsupported in Gate 0. Future policies require separate approval and must preserve existing demand price meanings.

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
- production fund migration without separate approval

Do not turn UNMET into a generic API marketplace without funded demand provenance.


## 18. DEFINITION OF DONE

### Gate 0 Is Complete When:

1. Builders can submit through the frontend
   without manual registration.

2. The validation service validates actual x402
   payment requirements.

3. The initial payment profile targets
   approved OKX/X Layer configuration.

4. Network, asset, and scheme support
   are loaded from reviewed configuration.

5. Invalid submissions receive explicit errors.

6. Only successful validation produces
   a signed attestation.

7. AgentDemand verifies attestations onchain.

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
    on the validation service.

16. Frontend and backend consumers target canonical AgentDemand.

17. Validation is not mislabeled
    as independent service verification.

18. Relevant contract, validation service, backend,
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
7. validation service configuration affected.
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

A configuration-driven validation service validates the proposed service's x402 compatibility.

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
→ Validation Service Validates x402
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

ERC-1271:
https://eips.ethereum.org/EIPS/eip-1271


### Data Formats

RFC 8785 — JSON Canonicalization:
https://www.rfc-editor.org/rfc/rfc8785


## 22. DOCUMENTATION INTEGRATION

Documentation ownership is explicit:

1. Label this [Future Implementation](FUTURE_IMPLEMENTATION.md) document as the exclusive owner of proposed implementation plans.

2. Keep future features separate from the current product. [PRD.md](PRD.md) owns current Post-Hackathon requirements and may link here for navigation only; do not duplicate proposed plans. [STATUS.md](STATUS.md) and dated records own implementation and acceptance evidence.

3. Do not claim AgentDemand is deployed
   before verified deployment evidence.

4. Do not claim the validation service is operational
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
