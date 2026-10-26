# Errors

Canonical recovery reference for API, durable payment, wallet and contract errors. See [API](API.md) for response shapes and [payment recovery](PAYMENT_RECOVERY.md) for operator procedures.

## Backend / frontend

| Code | Meaning | Recovery |
| --- | --- | --- |
| `CHAIN_CONTRACT_UNCONFIGURED` | `DEMAND_CONTRACT` is unset | deploy/configure contract |
| `CHAIN_RPC_UNAVAILABLE` | RPC or configured contract unavailable | verify RPC, chain ID, address and bytecode |
| `CHAIN_WRONG_NETWORK` | wallet is not on the configured demand-market network | switch/add X Layer Testnet chain `1952`; the x402 API billing rail's Mainnet `196` does not change the wallet network for demand-market actions |
| `CHAIN_RECEIPT_FAILED` | mined write failed | inspect revert and transaction |
| `CHAIN_STATE_READBACK_FAILED` | transaction receipt succeeded but the follow-up demand read failed | inspect the transaction, then refresh the chain view |
| `WALLET_NOT_FOUND` | injected EIP-1193 wallet unavailable | install/unlock wallet |
| `WALLET_NOT_CONNECTED` | no connected account for the requested action | connect the intended wallet before submitting |
| `WALLET_CHANGED` | account/provider/session changed before signing | review the action under the current wallet; observe any already-broadcast transaction separately |
| `WALLET_REJECTED` | user rejected wallet request | retry intentionally |
| `DEMAND_INVALID_CAPABILITY` | capability is not canonical lowercase slug | use lowercase letters/digits/hyphens |
| `DEMAND_INVALID_SPEC` | specification is empty/oversize | correct input |
| `DEMAND_INVALID_AMOUNT` | token amount invalid/out of uint96 range | correct decimal amount |
| `DEMAND_INVALID_CALLS` | expected calls invalid/out of uint64 range | correct integer |
| `DEMAND_INVALID_DEADLINE` | deadline input invalid | use positive day interval |
| `DEMAND_DEADLINE_TOO_SHORT` | guided-chat deadline duration is below one hour | choose a deadline of at least one hour |
| `SUPPORT_TOO_SMALL` | invalid support amount | use a positive amount meeting contract minimum |
| `SUBMISSION_INVALID_URL` | service URL invalid/non-HTTPS | submit public HTTPS endpoint |
| `SUBMISSION_INVALID_EVIDENCE` | evidence missing | supply evidence text/JSON or bytes32 hash |
| `INVALID_JSON` | API body invalid | send a JSON object |
| `INVALID_LIMIT` | `limit` outside 1..50 | use allowed range |
| `INVALID_SORT` | unsupported sort | see API.md |
| `INVALID_STATUS` | unsupported status filter | see API.md |
| `NOT_FOUND` | route does not exist | use documented route |

## Self-hosted API operations

| Code | HTTP / context | Recovery |
| --- | --- | --- |
| `BODY_TOO_LARGE` | 413; body exceeds 32 KiB | Send a smaller JSON body |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Use application/json and supported encoding |
| `RATE_LIMITED` | 429 | Respect Retry-After |
| `CLIENT_IP_UNAVAILABLE` | 503; invalid or absent trusted client identity | On Vercel check platform ingress headers; never fall back to a shared proxy quota |
| `LIMITER_CAPACITY` | 503; bounded client table full | Back off; inspect traffic/key limits |
| `OVER_CAPACITY` | 503; no request slot | Respect Retry-After |
| `INDEX_CAPACITY` | 503; index exceeds bounds | Review chain size and measured capacity |
| `INDEX_BUDGET_EXCEEDED` | 503; refresh deadline/window bound | Check RPC latency/budget |
| `INDEX_REORG` | 503; pinned block changed | Retry; previous checkpoint remains intact |
| `PAYMENT_UNAVAILABLE` | 503 readiness | Check official facilitator initialization |
| `CONFIG_INVALID` | Startup failure | Correct the named environment field |
| `STARTUP_UNAVAILABLE` | Nonzero startup exit | Verify required config/dependencies |
| `DRAIN_TIMEOUT` | Nonzero shutdown exit | Deadline elapsed; do not blindly retry signed payments |
| `UPSTREAM_CAPACITY, UPSTREAM_TIMEOUT_OR_SIZE, UPSTREAM_UNAVAILABLE` | Internal transport failure | Check RPC capacity/time/size bounds; public errors are sanitized |
| `UPSTREAM_RESPONSE_TOO_LARGE` | Internal bounded transport body limit` | Review the configured byte limit and provider response; public errors are sanitized |
| `PAYMENT_SDK_DIAGNOSTIC` | Sanitized SDK warning/error log | Inspect status and request ID; raw provider/payment data is omitted |
| `PAYMENT_UPSTREAM_UNAVAILABLE` | Internal official SDK failure | Check facilitator access; no automatic settlement retry |

Official x402 payment errors/challenges are produced by the OKX x402 middleware/facilitator; UNMET does not substitute custom payment-proof headers.

## Durable payment operations

These codes apply to durable self-hosted payment handling. Error responses never return database paths, raw signatures, upstream diagnostics or paid content.

| Code | HTTP | Meaning / action |
| --- | --- | --- |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Optional key must contain 1–128 printable non-space ASCII characters |
| `PAYMENT_IDENTITY_UNSUPPORTED` | 400 | Authorization/payer/requirements cannot be safely bound; no settlement started |
| `IDEMPOTENCY_CONFLICT` | 409 | Existing logical key or authorization is bound to a different operation; do not pay again automatically |
| `PAYMENT_ALREADY_RESERVED` | 409 | Retained authorization already belongs to an operation; no paid content replay |
| `PAYMENT_RECONCILIATION_REQUIRED` | 409 | Settlement outcome ambiguous; operator status reconciliation required |
| `PAYMENT_STORAGE_UNAVAILABLE` | 503 | No durable store is available or storage cannot durably protect settlement; configure/restore persistent SQLite, fail closed and do not submit a new authorization for an ambiguous operation |
| `PAYMENT_STORAGE_CAPACITY` | 503 | Record cap reached; operator cleanup/recovery needed |
| `PAYMENT_CONTEXT_UNAVAILABLE` | 503 | SDK call has no protected request context; no settlement |
| `PAYMENT_STATE_INVALID / PAYMENT_STATE_CONFLICT` | 503 | Invalid or conflicting atomic state transition; investigate operation |
| `PAYMENT_OPERATION_FAILED` | CLI exit 1 | Invalid operator command or storage/upstream failure; no private details printed |
| `PAYMENT_BACKUP_INVALID` | Internal backup validation | Use a fresh absolute destination; the operator CLI reports PAYMENT_OPERATION_FAILED |

A retry header is guidance to retry observation/request later, never permission to sign a new payment. See [payment recovery](PAYMENT_RECOVERY.md).

### Sanitized settlement diagnostics

These codes classify internal payment processing and do not create new public HTTP statuses. Unresolved settlement or proof results keep the operation blocked and content withheld, reporting `PAYMENT_RECONCILIATION_REQUIRED` (`409`). Status observation may retry transient failures within its configured budget, but settlement is never resubmitted.

| Code | Meaning | Recovery |
| --- | --- | --- |
| `PAYMENT_STATUS_TEMPORARY` | Transient facilitator status-read failure | Status polling may retry within its bounded budget; otherwise reconcile the existing transaction status. |
| `PAYMENT_STATUS_UNAVAILABLE` | Non-transient facilitator status-call failure | Investigate the existing operation; do not resubmit settlement. |
| `CONFIRMATION_RPC_UNAVAILABLE` | Required confirmation RPC read failed | The bounded confirmation loop may retry; the payment remains unresolved until proof succeeds. |
| `CONFIRMATION_RETRY_EXHAUSTED` | Confirmation retry budget ended without proof | Reconcile the existing transaction; do not resubmit settlement. |

Wallet transaction recovery also distinguishes `broadcast`, `confirmed`, `reverted`, `cancelled`, and `unknown` in `TransactionLifecycleError` and wallet-scoped pending records. `broadcast`/`unknown` block another submission. Observe the existing hash and original intent before any intentional retry; a successful receipt with failed readback is not permission to fund again. See [wallet session/recovery limits](WALLET_DISCONNECT.md).

## Contract custom errors

| Error | Meaning |
| --- | --- |
| `ZeroAddress` | required address is zero |
| `InvalidFee` | protocol fee exceeds constructor cap |
| `InvalidQuorum` | quorum not in `(50%, 100%]` |
| `InvalidDeadline` | constructor review period or demand deadline invalid |
| `InvalidAmount` | zero/under-minimum/economically invalid amount |
| `InvalidExpectedCalls` | expected call count is zero |
| `InvalidTextLength` | empty or over-limit string |
| `InvalidCapability` | noncanonical capability slug |
| `DemandNotFound` | demand ID does not exist |
| `DuplicateDemand` | exact active capability+spec demand already exists |
| `InvalidStatus` | action invalid for current lifecycle |
| `DeadlinePassed` | action requires active demand deadline |
| `ReviewActive` | reopen attempted before review ends |
| `ReviewEnded` | approval attempted after review closes |
| `NotSupporter` | approval caller has no commitment |
| `AlreadyApproved` | supporter already approved this submission nonce |
| `AlreadyRejected` | supporter already rejected this submission nonce |
| `ConflictingVote` | supporter tried to approve and reject the same submission |
| `QuorumNotReached` | finalize attempted below fixed threshold |
| `NothingToRefund` | caller has no currently refundable commitment |
| `InvalidEvidence` | zero evidence hash |
| `UnsupportedToken` | transfer received amount differs from requested amount |

Reaching the rejection threshold is a successful vote, not a revert: the contract marks the candidate rejected and allows `reopen` while the demand deadline is still active. `SubmissionRejected` is the event emitted when a candidate is cleared during reopen.
