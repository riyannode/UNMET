# Payment operation errors

These codes apply to durable self-hosted payment handling. Error responses never return database paths, raw signatures, upstream diagnostics or paid content.

| Code | HTTP | Meaning / action |
| --- | --- | --- |
| IDEMPOTENCY_KEY_INVALID | 400 | Optional key must contain 1–128 printable non-space ASCII characters |
| PAYMENT_IDENTITY_UNSUPPORTED | 400 | Authorization/payer/requirements cannot be safely bound; no settlement started |
| IDEMPOTENCY_CONFLICT | 409 | Existing logical key or authorization is bound to a different operation; do not pay again automatically |
| PAYMENT_ALREADY_RESERVED | 409 | Retained authorization already belongs to an operation; no paid content replay |
| PAYMENT_RECONCILIATION_REQUIRED | 409 | Settlement outcome ambiguous; operator status reconciliation required |
| PAYMENT_STORAGE_UNAVAILABLE | 503 | Storage cannot durably protect settlement; fail closed |
| PAYMENT_STORAGE_CAPACITY | 503 | Record cap reached; operator cleanup/recovery needed |
| PAYMENT_CONTEXT_UNAVAILABLE | 503 | SDK call has no protected request context; no settlement |
| PAYMENT_STATE_INVALID / PAYMENT_STATE_CONFLICT | 503 | Invalid or conflicting atomic state transition; investigate operation |
| PAYMENT_OPERATION_FAILED | CLI exit 1 | Invalid operator command or storage/upstream failure; no private details printed |

A retry header is guidance to retry observation/request later, never permission to sign a new payment. See [payment recovery](PAYMENT_RECOVERY.md).
