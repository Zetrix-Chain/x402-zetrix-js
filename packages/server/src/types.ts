/**
 * Types for @x402-zetrix/server
 * [TEST] paymentMiddleware + server components
 */

// ---------------------------------------------------------------------------
// Middleware config
// ---------------------------------------------------------------------------

export interface PaymentMiddlewareConfig {
  /** Payment amount in smallest unit (string, not number) */
  amount: string
  /** "ZTX" for native coin, or ZTP20 contract address */
  asset: string
  /** Recipient Zetrix address */
  payTo: string
  /** "zetrix:mainnet" | "zetrix:testnet" (C2 — no -1 suffix) */
  network: string
  /** Facilitator base URL — private, server-side only, never sent to clients */
  facilitatorUrl: string
  /** x-api-key header value for Facilitator API calls (server-side only) */
  facilitatorApiKey?: string
  /** Bearer token for Facilitator API calls — sent as Authorization: Bearer <token> (server-side only) */
  facilitatorBearerToken?: string
  /**
   * Gas model for the 402 response. Default: "facilitator".
   * Constraint: native ZTX asset always requires gasModel: "client" — a client holding ZTX
   * to pay can also pay their own gas. gasModel: "facilitator" is valid for ZTP20 only.
   */
  gasModel?: 'client' | 'facilitator'
  gasPrice?: string
  feeLimit?: string
  /** Public proxy URL for /prepare — advertised to clients in 402 response, no auth required */
  prepareEndpoint?: string
  /** Optional logger — library is silent by default. Pass `console` to restore log output. */
  logger?: {
    log: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
  }
}

/** Auth credentials for server-side Facilitator API calls (/verify, /settle, /settle/status) */
export interface FacilitatorAuth {
  apiKey?:      string
  bearerToken?: string
}

// ---------------------------------------------------------------------------
// Facilitator response types (C1: all responses wrapped in {object, success})
// ---------------------------------------------------------------------------

/** Unwrapped result from POST /verify (C1, C3, C7, C8) */
export interface VerifyResult {
  isValid: boolean
  /** Integer error code — present when isValid:false (C8) */
  errorCode?: number
  /** Error message — present when isValid:false (C7) */
  errorMsg?: string
}

/** HTTP 200 — self-pay sync result from POST /settle (C4, C5) */
export interface SettleSyncResult {
  status: 'SUBMITTED' | 'FAILED'
  txHash: string
  /** Present when status:FAILED (C5, C8) */
  errorCode?: number
  /** Present when status:FAILED (C5, C7) */
  errorMsg?: string
}

/** HTTP 202 — sponsored async result from POST /settle (C4) */
export interface SettleQueuedResult {
  status: 'QUEUED'
  blobId: string
}

/** HTTP 409 — idempotency result from POST /settle (C6) */
export interface SettleIdempotentResult {
  errorCode: number   // 460810
  errorMsg: string    // 'blob_already_settled'
}

/** Discriminated union returned by FacilitatorSettleClient.settle() */
export type SettleResult =
  | { httpStatus: 200; result: SettleSyncResult }
  | { httpStatus: 202; result: SettleQueuedResult }
  | { httpStatus: 409; result: SettleIdempotentResult }

/** Status poll result from GET /settle/status (C9) */
export interface SettleStatusResult {
  status: 'QUEUED' | 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN'
  blobId: string
  /** Present when status:CONFIRMED (C9) */
  txHash?: string
  /** Present when status:FAILED (C8) */
  errorCode?: number
  /** Present when status:FAILED (C7) */
  errorMsg?: string
}

// ---------------------------------------------------------------------------
// X-PAYMENT header type
// ---------------------------------------------------------------------------

export interface XPaymentHeader {
  x402Version: number
  scheme: string
  network: string
  payload: XPaymentPayload
}

export type XPaymentPayload =
  | SignedTransactionPayload
  | FacilitatorPreparedPayload

export interface SignedTransactionPayload {
  type: 'signed_transaction'
  transactionBlob: string
  signatures: Array<{ sign_data: string; public_key: string }>
  validBefore: number
}

export interface FacilitatorPreparedPayload {
  type: 'facilitator_prepared'
  blobId: string
  blob: string
  hash: string
  clientSignature: { signBlob: string; publicKey: string }
  validBefore: number
}
