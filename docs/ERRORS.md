# Errors

Source keeps errors short. This file is the recovery reference.

## Backend / frontend

| Code | Meaning | Recovery |
| --- | --- | --- |
| `CHAIN_CONTRACT_UNCONFIGURED` | `DEMAND_CONTRACT` is unset | deploy/configure contract |
| `CHAIN_RPC_UNAVAILABLE` | RPC or configured contract unavailable | verify RPC, chain ID, address and bytecode |
| `CHAIN_WRONG_NETWORK` | wallet is not on configured X Layer network | switch/add chain 1952 or 196 |
| `CHAIN_RECEIPT_FAILED` | mined write failed | inspect revert and transaction |
| `CHAIN_STATE_READBACK_FAILED` | transaction receipt succeeded but the follow-up demand read failed | inspect the transaction, then refresh the chain view |
| `WALLET_NOT_FOUND` | injected EIP-1193 wallet unavailable | install/unlock wallet |
| `WALLET_REJECTED` | user rejected wallet request | retry intentionally |
| `DEMAND_INVALID_CAPABILITY` | capability is not canonical lowercase slug | use lowercase letters/digits/hyphens |
| `DEMAND_INVALID_SPEC` | specification is empty/oversize | correct input |
| `DEMAND_INVALID_AMOUNT` | token amount invalid/out of uint96 range | correct decimal amount |
| `DEMAND_INVALID_CALLS` | expected calls invalid/out of uint64 range | correct integer |
| `DEMAND_INVALID_DEADLINE` | deadline input invalid | use positive day interval |
| `SUPPORT_TOO_SMALL` | invalid support amount | use a positive amount meeting contract minimum |
| `SUBMISSION_INVALID_URL` | service URL invalid/non-HTTPS | submit public HTTPS endpoint |
| `SUBMISSION_INVALID_EVIDENCE` | evidence missing | supply evidence text/JSON or bytes32 hash |
| `INVALID_JSON` | API body invalid | send a JSON object |
| `INVALID_LIMIT` | `limit` outside 1..50 | use allowed range |
| `INVALID_SORT` | unsupported sort | see API.md |
| `INVALID_STATUS` | unsupported status filter | see API.md |
| `NOT_FOUND` | route does not exist | use documented route |

Official x402 payment errors/challenges are produced by the OKX x402 middleware/facilitator; UNMET does not substitute custom payment-proof headers.

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
| `QuorumNotReached` | finalize attempted below fixed threshold |
| `NothingToRefund` | caller has no currently refundable commitment |
| `InvalidEvidence` | zero evidence hash |
| `UnsupportedToken` | transfer received amount differs from requested amount |
