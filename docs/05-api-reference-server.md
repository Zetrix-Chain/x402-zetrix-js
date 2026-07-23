# API Reference — x402-zetrix-server

Express middleware and Facilitator HTTP clients for protecting routes with x402 payment requirements.

## `paymentMiddleware(config)`

Express middleware factory. Returns a middleware function that:

1. Checks for the `X-Payment` header.
2. If absent, returns `402 Payment Required` with `accepts[]` describing payment options.
3. If present, verifies the payment with the Facilitator.
4. If valid, calls `next()` to serve the resource and sets the `X-Payment-Response` header.
5. Settles asynchronously in the background (non-blocking).

```typescript
import express from 'express'
import { paymentMiddleware } from 'x402-zetrix-server'

const app = express()

app.get(
  '/api/data',
  paymentMiddleware({
    amount:                 '10000',
    asset:                  'ZTX',
    payTo:                  process.env.X402_ADDRESS!,
    network:                'zetrix:testnet',
    facilitatorUrl:         process.env.X402_FACILITATOR_URL!,
    facilitatorApiKey:      process.env.X402_FACILITATOR_API_KEY,
    facilitatorBearerToken: process.env.X402_FACILITATOR_BEARER_TOKEN,
    gasModel:               'client',
  }),
  (req, res) => {
    res.json({ data: 'protected resource' })
  },
)
```

### `PaymentMiddlewareConfig`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `amount` | `string` | Yes | — | Payment amount in smallest unit (e.g. `"10000"` = 0.01 ZTX at 6 decimals) |
| `asset` | `string` | Yes | — | `"ZTX"` for native coin, or ZTP20 contract address |
| `payTo` | `string` | Yes | — | Recipient Zetrix address (Z…) |
| `network` | `string` | Yes | — | `"zetrix:mainnet"` or `"zetrix:testnet"` — no `-1` suffix |
| `facilitatorUrl` | `string` | Yes | — | **Private** Facilitator base URL — used server-side only, never sent to clients |
| `facilitatorApiKey` | `string` | No | — | `x-api-key` header value for Facilitator API calls |
| `facilitatorBearerToken` | `string` | No | — | `Authorization: Bearer` token for Facilitator API calls |
| `gasModel` | `"client" \| "facilitator"` | No | `"facilitator"` | Gas model. ZTX native coin **requires** `"client"` (payer also pays their own gas). `"facilitator"` is for ZTP20 sponsored gas only. |
| `gasPrice` | `string` | No | — | Gas price in smallest unit — advertised to clients |
| `feeLimit` | `string` | No | — | Fee limit in smallest unit — advertised to clients |
| `prepareEndpoint` | `string` | No | — | **Public proxy** URL for `/prepare` — advertised to clients in the 402 response, no auth required. Only relevant for gasModel:facilitator. |
| `logger` | `Logger` | No | silent | Optional logger. Pass `console` to enable output. |

### Two-URL architecture

The middleware uses two distinct URLs for different purposes:

| URL | Who uses it | Auth required | Purpose |
|---|---|---|---|
| `facilitatorUrl` | Server only | Yes (`facilitatorApiKey`, `facilitatorBearerToken`) | `/verify`, `/settle`, `/settle/status` |
| `prepareEndpoint` | Client (via 402 response) | No | `/prepare` (gasModel:facilitator only) |

The `facilitatorUrl` is never sent to clients. The `prepareEndpoint` is advertised in the `accepts[]` array for clients to call directly.

---

## `PayloadVerifier`

Local, in-process defense-in-depth check. `paymentMiddleware` calls
`PayloadVerifier.verifyRequirements()` right after the `validBefore` expiry check and
**before** `FacilitatorVerifyClient.verify()` — it decodes the submitted blob and compares
`payTo`/`amount`/asset against the middleware's own `config`. A compromised or buggy
Facilitator can never override a locally-detected mismatch, and an obviously-wrong
payload is rejected without spending a network round trip.

```typescript
import { PayloadVerifier } from 'x402-zetrix-server'

const result = PayloadVerifier.verifyRequirements(xPaymentPayload, config)
// { isValid: true } | { isValid: false, errorCode: string, errorMsg: string }
```

### `PayloadVerifier.decode(blobHex)`

Decodes a hex-encoded Zetrix transaction blob and extracts `payTo`/`amount`/(ZTP20 only)
`tokenContract`. Ports the same decode logic `packages/client`'s `BlobDecoder` uses.
Throws (never returns a Result) if the blob is empty, non-hex, has no operations, or its
first operation is not a `payCoin`.

### `PayloadVerifier.verifyRequirements(payload, config)`

Never throws — any `decode()` failure is caught internally and converted to a Result.

```typescript
interface PayloadDecodeResult {
  payTo:          string
  amount:         string
  tokenContract?: string   // present only for ZTP20 (contract-invoke) payloads; absent for native ZTX
}

interface PayloadVerifyResult {
  isValid:    boolean
  errorCode?: string   // present when isValid:false — see table below
  errorMsg?:  string   // present when isValid:false — human-readable detail
}
```

Checks, in order — the first mismatch wins:

1. `decoded.payTo !== config.payTo`
2. `decoded.amount !== config.amount`
3. Asset/token-contract: if `config.asset === 'ZTX'`, a **ZTP20-shaped** blob (one with a
   `tokenContract`) is rejected even if `payTo`/`amount` match — this closes a gap found in
   this ticket's whole-branch review, where a native-ZTX config previously skipped the
   contract check entirely. Otherwise, `decoded.tokenContract` must equal `config.asset`.

| `errorCode` | Meaning |
|---|---|
| `'payload_requirements_mismatch'` | Decoded `payTo`, `amount`, or asset/token-contract doesn't match `config`. |
| `'payload_decode_failed'` | The blob (or its ZTP20 `input`) failed to decode. |

> **Type note:** this `errorCode` is always a **string**. The Facilitator-sourced
> `errorCode` used elsewhere in the 402 response (e.g. `blob_expired` → `460807`) is a
> **number**. Don't assume a fixed type across all 402 responses from this middleware.

---

## Facilitator Clients

These are used internally by `paymentMiddleware`. Exposed for testing and advanced use.

### `FacilitatorVerifyClient`

```typescript
import { FacilitatorVerifyClient } from 'x402-zetrix-server'

const result = await FacilitatorVerifyClient.verify(xPaymentHeader, facilitatorUrl, auth)
```

Calls `POST {facilitatorUrl}/verify`. Returns `VerifyResult`.

### `FacilitatorSettleClient`

```typescript
import { FacilitatorSettleClient } from 'x402-zetrix-server'

const result = await FacilitatorSettleClient.settle(xPaymentHeader, facilitatorUrl, auth)
```

Calls `POST {facilitatorUrl}/settle`. Branches on HTTP response status:
- **200** → `{ httpStatus: 200, result: SettleSyncResult }` — self-pay transaction submitted synchronously
- **202** → `{ httpStatus: 202, result: SettleQueuedResult }` — sponsored transaction queued asynchronously
- **409** → `{ httpStatus: 409, result: SettleIdempotentResult }` — already settled (idempotency)

### `FacilitatorSettleStatusClient`

```typescript
import { FacilitatorSettleStatusClient } from 'x402-zetrix-server'

const result = await FacilitatorSettleStatusClient.poll(blobId, facilitatorUrl, auth)
```

Polls `GET {facilitatorUrl}/settle/status?blobId=` after a 202 response. Retries up to **80 times** with 5-second intervals (~400 s total). Returns `SettleStatusResult`.

---

## Utilities

### `XPaymentParser`

Decodes and validates the `X-Payment` header (base64-encoded JSON). Throws on missing required fields.

```typescript
import { XPaymentParser } from 'x402-zetrix-server'

const parsed = XPaymentParser.parse(req.headers['x-payment'] as string)
```

### `PaymentResponseBuilder`

Builds the `X-Payment-Response` header returned to the client after successful payment.

```typescript
import { PaymentResponseBuilder } from 'x402-zetrix-server'

const headerValue = PaymentResponseBuilder.build(settleResult)
```

---

## Types

### `FacilitatorAuth`

Auth credentials passed to all three Facilitator clients:

```typescript
interface FacilitatorAuth {
  apiKey?:      string   // x-api-key header
  bearerToken?: string   // Authorization: Bearer <token>
}
```

### `VerifyResult`

```typescript
interface VerifyResult {
  isValid:    boolean
  errorCode?: number   // present when isValid:false
  errorMsg?:  string   // present when isValid:false
}
```

### `SettleResult` (discriminated union)

```typescript
type SettleResult =
  | { httpStatus: 200; result: SettleSyncResult }
  | { httpStatus: 202; result: SettleQueuedResult }
  | { httpStatus: 409; result: SettleIdempotentResult }
```

### `SettleSyncResult` (HTTP 200)

```typescript
interface SettleSyncResult {
  status:     'SUBMITTED' | 'FAILED'
  txHash:     string
  errorCode?: number
  errorMsg?:  string
}
```

### `SettleQueuedResult` (HTTP 202)

```typescript
interface SettleQueuedResult {
  status: 'QUEUED'
  blobId: string
}
```

### `SettleIdempotentResult` (HTTP 409)

```typescript
interface SettleIdempotentResult {
  errorCode: number   // 460810
  errorMsg:  string   // 'blob_already_settled'
}
```

### `SettleStatusResult`

```typescript
interface SettleStatusResult {
  status:     'PENDING' | 'QUEUED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN'
  blobId:     string
  txHash?:    string   // present when status:CONFIRMED
  errorCode?: number   // present when status:FAILED
  errorMsg?:  string   // present when status:FAILED
}
```

Status values:
- `PENDING` — Facilitator returned an unexpected non-200/202/409 status; polling will continue
- `QUEUED` — transaction accepted by the Facilitator queue, awaiting processing
- `SUBMITTED` — transaction submitted to the Zetrix network
- `CONFIRMED` — transaction confirmed on-chain (includes `txHash`)
- `FAILED` — transaction failed (includes `errorCode` and `errorMsg`)
- `UNKNOWN` — polling exhausted 80 attempts without reaching a terminal status

### `XPaymentHeader`

Decoded `X-Payment` header shape:

```typescript
interface XPaymentHeader {
  x402Version: number
  scheme:      string
  network:     string
  payload:     XPaymentPayload
}
```

### `XPaymentPayload` (union)

- **`SignedTransactionPayload`** — gasModel:client: `{ type: 'signed_transaction', transactionBlob, signatures, validBefore }`
- **`FacilitatorPreparedPayload`** — gasModel:facilitator: `{ type: 'facilitator_prepared', blobId, blob, hash, clientSignature, validBefore }`
