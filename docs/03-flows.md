# Flows

> Cross-references: §01 for architecture, §04–05 for API reference.

## Mode A — HTTP interceptor flow

OkHttp/fetch request to 402 endpoint → SDK intercepts 402 → `PaymentEngine.pay()` → **pre-payment balance check** (throws `InsufficientBalanceError` before signing if wallet is underfunded) → build X-PAYMENT header → retry original request → 200 returned to caller.

## Mode B — MCP tool flow

AI agent calls `fetch_with_payment({ url })` → MCP server handles 402 via `PaymentEngine` → agent receives `{ status: 200, body: "..." }`.

## Server middleware flow

```
Request arrives
  → No X-PAYMENT header → return 402 with accepts[]
  → X-PAYMENT present:
      → FacilitatorVerifyClient.verify(payload)
          → Unwrap response.object (C1)
          → isValid:false → return 402 with errorMsg (C7); log errorCode (C8)
      → isValid:true → call route handler → serve resource
      → Attach X-PAYMENT-RESPONSE header
      → Return 200 to client
      → FacilitatorSettleClient.settle(payload) [async, non-blocking]
          → HTTP 200 (self-pay): check status SUBMITTED/FAILED; parse errorCode on FAILED (C4, C5)
          → HTTP 202 (sponsored): save blobId → FacilitatorSettleStatusClient.poll(blobId) (C4, C9)
          → HTTP 409 (duplicate): log idempotency hit, treat as already-settled (C6)
```

## FacilitatorSettleStatusClient polling (C9)

Used only after sponsored-mode (`gasModel:facilitator`) `/settle` returns HTTP 202.

```
Poll GET /settle/status?blobId every 3–5 s
  → QUEUED / SUBMITTED: continue polling
  → CONFIRMED: extract txHash, done
  → FAILED: log errorCode + errorMsg, done
  → After ~20 attempts with no final status: log UNKNOWN, stop
```

Do NOT poll for self-pay settlements — HTTP 200 from `/settle` already contains the final `txHash`.

## Full sequence diagrams

See `x402-zetrix-development.md` §Agentic Integration for complete sequence diagrams for both gas models.
