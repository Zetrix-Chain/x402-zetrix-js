/**
 * [TEST] paymentMiddleware + server components — RED phase
 *
 * Tests for paymentMiddleware, FacilitatorVerifyClient, FacilitatorSettleClient,
 * FacilitatorSettleStatusClient, XPaymentParser, PaymentResponseBuilder.
 *
 * These tests MUST FAIL until the implementation is written.
 *
 * Facilitator API changes applied:
 *   C1 — response.object envelope
 *   C3 — /verify errorCode
 *   C4 — /settle HTTP 200 (self-pay sync) vs 202 (sponsored async)
 *   C5 — /settle FAILED errorCode
 *   C6 — /settle 409 idempotency
 *   C7 — errorMsg field name
 *   C8 — errorCode is integer
 *   C9 — FacilitatorSettleStatusClient (new)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { BlobBuilder } from 'x402-zetrix-client'

// ---------------------------------------------------------------------------
// Mock Facilitator clients before importing middleware
// ---------------------------------------------------------------------------
vi.mock('../facilitator/verify-client', () => ({
  FacilitatorVerifyClient: {
    verify: vi.fn(),
  },
}))

vi.mock('../facilitator/settle-client', () => ({
  FacilitatorSettleClient: {
    settle: vi.fn(),
  },
}))

vi.mock('../facilitator/settle-status-client', () => ({
  FacilitatorSettleStatusClient: {
    poll: vi.fn(),
  },
}))

// Import middleware and mocked clients
import { paymentMiddleware } from '../middleware'
import { FacilitatorVerifyClient } from '../facilitator/verify-client'
import { FacilitatorSettleClient } from '../facilitator/settle-client'
import { FacilitatorSettleStatusClient } from '../facilitator/settle-status-client'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  amount: '1000000',
  asset: 'Z9xKtestZUSDcontractAddress123456789',  // ZTP20 — valid with gasModel:facilitator
  payTo: 'ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6',
  network: 'zetrix:testnet',
  facilitatorUrl: 'https://facilitator.zetrix.io/api/v1/facilitator',
  gasModel: 'facilitator' as const,
}

/**
 * A matching blob — decodes (via PayloadVerifier) to payTo/amount/tokenContract that
 * exactly equal TEST_CONFIG, so this fixture reaches the Facilitator-call stage in every
 * test below(when the blob content was never locally inspected).
 */
const MATCHING_BLOB = BlobBuilder.build({
  asset:         TEST_CONFIG.asset,
  payTo:         TEST_CONFIG.payTo,
  amount:        TEST_CONFIG.amount,
  clientAddress: TEST_CONFIG.payTo,
  nonce:         '1',
  gasPrice:      '1000',
  feeLimit:      '100000',
}).blob

/** A valid-looking X-Payment header (base64-encoded JSON) */
const SAMPLE_PAYLOAD = {
  x402Version: 2,
  scheme: 'exact',
  network: 'zetrix:testnet',
  payload: {
    type: 'facilitator_prepared',
    blobId: 'BLOB-test1234abcd',
    blob: MATCHING_BLOB,
    hash: 'hashvalue123',
    clientSignature: { signBlob: 'sigvalue', publicKey: 'pubkeyvalue' },
    validBefore: Math.floor(Date.now() / 1000) + 3600,
  },
}
const X_PAYMENT_HEADER = Buffer.from(JSON.stringify(SAMPLE_PAYLOAD)).toString('base64')

// Helper: build an Express app with the middleware on /resource
function buildApp() {
  const app = express()
  app.use(express.json())
  app.get(
    '/resource',
    paymentMiddleware(TEST_CONFIG),
    (_req: express.Request, res: express.Response) => {
      res.json({ data: 'secret-resource' })
    }
  )
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('paymentMiddleware', () => {
  let app: express.Application

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  // -------------------------------------------------------------------------
  // 1. No X-Payment header → 402
  // -------------------------------------------------------------------------
  describe('request with no X-Payment header', () => {
    it('returns HTTP 402', async () => {
      const resp = await request(app).get('/resource')
      expect(resp.status).toBe(402)
    })

    it('response body contains x402Version: 2', async () => {
      const resp = await request(app).get('/resource')
      expect(resp.body.x402Version).toBe(2)
    })

    it('response body has an accepts array with one entry', async () => {
      const resp = await request(app).get('/resource')
      expect(Array.isArray(resp.body.accepts)).toBe(true)
      expect(resp.body.accepts).toHaveLength(1)
    })

    it('accepts[0] contains asset, payTo, amount, network from config', async () => {
      const resp = await request(app).get('/resource')
      const entry = resp.body.accepts[0]
      expect(entry.asset).toBe(TEST_CONFIG.asset)
      expect(entry.payTo).toBe(TEST_CONFIG.payTo)
      expect(entry.maxAmountRequired).toBe(TEST_CONFIG.amount)
      expect(entry.network).toBe(TEST_CONFIG.network)
    })

    it('accepts[0] has scheme: "exact"', async () => {
      const resp = await request(app).get('/resource')
      expect(resp.body.accepts[0].scheme).toBe('exact')
    })

    it('does not call FacilitatorVerifyClient', async () => {
      await request(app).get('/resource')
      expect(FacilitatorVerifyClient.verify).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 2. X-Payment present — verify fails (C3, C7, C8)
  // -------------------------------------------------------------------------
  describe('request with X-Payment — verify fails (C3, C7, C8)', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({
        isValid: false,
        errorCode: 460801,          // integer (C8)
        errorMsg: 'invalid_signature', // errorMsg not "error" (C7)
      })
    })

    it('returns HTTP 402', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(402)
    })

    it('response body contains errorMsg from verify result (C7)', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.errorMsg).toBe('invalid_signature')
    })

    it('response body contains errorCode as integer (C8)', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.errorCode).toBe(460801)
      expect(typeof resp.body.errorCode).toBe('number')
    })

    it('route handler is NOT called (data field absent)', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.data).toBeUndefined()
    })

    it('FacilitatorSettleClient.settle is NOT called', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(FacilitatorSettleClient.settle).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 3. X-Payment present — verify passes, settle 200 SUBMITTED (C4)
  // -------------------------------------------------------------------------
  describe('valid X-Payment — settle 200 SUBMITTED (C4)', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 200,
        result: { status: 'SUBMITTED', txHash: 'ZETRIX_TX_HASH_001' },
      })
    })

    it('returns HTTP 200 from route handler', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })

    it('response body contains the resource data', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.data).toBe('secret-resource')
    })

    it('response has X-Payment-Response header', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.headers['x-payment-response']).toBeDefined()
      expect(typeof resp.headers['x-payment-response']).toBe('string')
      expect(resp.headers['x-payment-response']!.length).toBeGreaterThan(0)
    })

    it('FacilitatorSettleClient.settle is called once after response', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      // Allow event loop to process the finish event
      await new Promise(r => setTimeout(r, 30))
      expect(FacilitatorSettleClient.settle).toHaveBeenCalledOnce()
    })

    it('FacilitatorSettleStatusClient.poll is NOT called for 200 self-pay', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      await new Promise(r => setTimeout(r, 30))
      expect(FacilitatorSettleStatusClient.poll).not.toHaveBeenCalled()
    })

    it('settle does not block the response (non-blocking)', async () => {
      // Mock settle to take 500 ms
      vi.mocked(FacilitatorSettleClient.settle).mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () => resolve({ httpStatus: 200, result: { status: 'SUBMITTED', txHash: '' } }),
              500
            )
          )
      )
      const start = Date.now()
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      const elapsed = Date.now() - start
      expect(resp.status).toBe(200)
      // Response must arrive well before settle resolves (500 ms)
      expect(elapsed).toBeLessThan(450)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Settle 200 FAILED — blockchain rejected (C4, C5, C8)
  // -------------------------------------------------------------------------
  describe('valid X-Payment — settle 200 FAILED (C4, C5)', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 200,
        result: {
          status: 'FAILED',
          txHash: '',
          errorCode: 460808,           // integer (C8)
          errorMsg: 'insufficient_funds', // errorMsg not "error" (C7)
        },
      })
    })

    it('route still returns 200 — settle failure does not affect resource delivery', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })

    it('FacilitatorSettleStatusClient.poll is NOT called for FAILED self-pay', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      await new Promise(r => setTimeout(r, 30))
      expect(FacilitatorSettleStatusClient.poll).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 5. Settle 202 — sponsored mode, poll required (C4, C9)
  // -------------------------------------------------------------------------
  describe('valid X-Payment — settle 202 sponsored mode (C4, C9)', () => {
    const BLOB_ID = 'BLOB-sponsored-abc123'

    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 202,
        result: { status: 'QUEUED', blobId: BLOB_ID },
      })
      vi.mocked(FacilitatorSettleStatusClient.poll).mockResolvedValue({
        status: 'CONFIRMED',
        blobId: BLOB_ID,
        txHash: 'ZETRIX_TX_CONFIRMED',
      })
    })

    it('route returns 200 immediately (does not wait for poll)', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })

    it('FacilitatorSettleStatusClient.poll is called with blobId and facilitatorUrl (C9)', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      await new Promise(r => setTimeout(r, 30))
      expect(FacilitatorSettleStatusClient.poll).toHaveBeenCalledOnce()
      expect(FacilitatorSettleStatusClient.poll).toHaveBeenCalledWith(
        BLOB_ID,
        TEST_CONFIG.facilitatorUrl,
        expect.objectContaining({ apiKey: undefined, bearerToken: undefined }),
      )
    })

    it('response has X-Payment-Response header even in sponsored mode', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.headers['x-payment-response']).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Settle 409 — idempotency (C6)
  // -------------------------------------------------------------------------
  describe('valid X-Payment — settle 409 idempotency (C6)', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 409,
        result: { errorCode: 460810, errorMsg: 'blob_already_settled' },
      })
    })

    it('route still returns 200 — 409 is not a payment failure', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })

    it('FacilitatorSettleStatusClient.poll is NOT called for 409 (already settled)', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      await new Promise(r => setTimeout(r, 30))
      expect(FacilitatorSettleStatusClient.poll).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 7. Invalid config — ZTX + gasModel:facilitator
  // -------------------------------------------------------------------------
  describe('invalid config — ZTX + gasModel:facilitator', () => {
    it('throws at middleware instantiation', () => {
      expect(() =>
        paymentMiddleware({ ...TEST_CONFIG, asset: 'ZTX', gasModel: 'facilitator' })
      ).toThrow('[x402] Invalid config: native ZTX asset requires gasModel: "client"')
    })
  })

  // -------------------------------------------------------------------------
  // 8. FacilitatorVerifyClient receives the parsed payload
  // -------------------------------------------------------------------------
  describe('FacilitatorVerifyClient.verify called with correct args', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 200,
        result: { status: 'SUBMITTED', txHash: '' },
      })
    })

    it('verify is called with the decoded X-Payment payload', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(FacilitatorVerifyClient.verify).toHaveBeenCalledOnce()
      const [calledPayload, calledUrl] = vi.mocked(FacilitatorVerifyClient.verify).mock.calls[0]
      // Payload should be the decoded object, not the raw base64 string
      expect(calledPayload).toMatchObject({ x402Version: 2, scheme: 'exact' })
      expect(calledUrl).toBe(TEST_CONFIG.facilitatorUrl)
    })
  })

  // -------------------------------------------------------------------------
  // 9. Facilitator verify throws → 503 (APP-M05)
  // -------------------------------------------------------------------------
  describe('Facilitator verify throws → 503', () => {
    it('returns HTTP 503 when FacilitatorVerifyClient.verify throws', async () => {
      vi.mocked(FacilitatorVerifyClient.verify).mockRejectedValue(new Error('network error'))
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(503)
    })

    it('response body contains error: facilitator_unavailable', async () => {
      vi.mocked(FacilitatorVerifyClient.verify).mockRejectedValue(new Error('timeout'))
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.error).toBe('facilitator_unavailable')
    })

    it('route handler is NOT called when verify throws', async () => {
      vi.mocked(FacilitatorVerifyClient.verify).mockRejectedValue(new Error('refused'))
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.body.data).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // 10. Malformed X-Payment header → 402 (APP-M06)
  // -------------------------------------------------------------------------
  describe('malformed X-Payment header → 402', () => {
    it('returns 402 for non-base64 header', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', '!!!not-base64!!!')
      expect(resp.status).toBe(402)
    })

    it('returns 402 for valid base64 but missing x402Version', async () => {
      const badPayload = Buffer.from(JSON.stringify({ scheme: 'exact', payload: {} })).toString('base64')
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', badPayload)
      expect(resp.status).toBe(402)
      expect(resp.body.error).toBe('malformed_payment_header')
    })

    it('returns 402 for valid base64 but missing network (APP-M09)', async () => {
      const badPayload = Buffer.from(JSON.stringify({ x402Version: 2, scheme: 'exact', payload: {} })).toString('base64')
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', badPayload)
      expect(resp.status).toBe(402)
      expect(resp.body.error).toBe('malformed_payment_header')
    })

    it('returns 402 for valid base64 but payload is not an object', async () => {
      const badPayload = Buffer.from(JSON.stringify({ x402Version: 2, scheme: 'exact', network: 'zetrix:testnet', payload: 'string' })).toString('base64')
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', badPayload)
      expect(resp.status).toBe(402)
    })
  })

  // -------------------------------------------------------------------------
  // 11. Expired validBefore → 402 (APP-M04)
  // -------------------------------------------------------------------------
  describe('expired validBefore → 402', () => {
    it('returns 402 when validBefore is in the past', async () => {
      const expiredPayload = {
        ...SAMPLE_PAYLOAD,
        payload: {
          ...SAMPLE_PAYLOAD.payload,
          validBefore: Math.floor(Date.now() / 1000) - 3600,  // 1 hour ago
        },
      }
      const header = Buffer.from(JSON.stringify(expiredPayload)).toString('base64')
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', header)
      expect(resp.status).toBe(402)
      expect(resp.body.errorMsg).toBe('blob_expired')
    })

    it('does not expire when validBefore is in the future', async () => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 200,
        result: { status: 'SUBMITTED', txHash: '' },
      })
      // SAMPLE_PAYLOAD already has validBefore = now + 3600
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })
  })

  // -------------------------------------------------------------------------
  // 12. Local PayloadVerifier gate — requirements mismatch → 402 before Facilitator
  // -------------------------------------------------------------------------
  describe('local payload requirements mismatch', () => {
    beforeEach(() => {
      // If the gate did not exist, this mock would let the request through with 200 —
      // making a RED failure here unambiguous (expected 402, got 200).
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
    })

    function buildMismatchedHeader(): string {
      const mismatchedBlob = BlobBuilder.build({
        asset:         TEST_CONFIG.asset,
        payTo:         TEST_CONFIG.payTo,
        amount:        '9999999', // does not match TEST_CONFIG.amount ('1000000')
        clientAddress: TEST_CONFIG.payTo,
        nonce:         '1',
        gasPrice:      '1000',
        feeLimit:      '100000',
      }).blob
      const mismatchedPayload = {
        ...SAMPLE_PAYLOAD,
        payload: { ...SAMPLE_PAYLOAD.payload, blob: mismatchedBlob },
      }
      return Buffer.from(JSON.stringify(mismatchedPayload)).toString('base64')
    }

    it('returns HTTP 402 with error: payment_invalid', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', buildMismatchedHeader())
      expect(resp.status).toBe(402)
      expect(resp.body.error).toBe('payment_invalid')
    })

    it('response body has errorCode: payload_requirements_mismatch', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', buildMismatchedHeader())
      expect(resp.body.errorCode).toBe('payload_requirements_mismatch')
    })

    it('response body has an errorMsg describing the mismatch', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', buildMismatchedHeader())
      expect(typeof resp.body.errorMsg).toBe('string')
      expect(resp.body.errorMsg.length).toBeGreaterThan(0)
    })

    it('does not call FacilitatorVerifyClient.verify', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', buildMismatchedHeader())
      expect(FacilitatorVerifyClient.verify).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 13. Local PayloadVerifier gate — requirements match → proceeds to Facilitator
  // -------------------------------------------------------------------------
  describe('local payload requirements match — proceeds to Facilitator', () => {
    beforeEach(() => {
      vi.mocked(FacilitatorVerifyClient.verify).mockResolvedValue({ isValid: true })
      vi.mocked(FacilitatorSettleClient.settle).mockResolvedValue({
        httpStatus: 200,
        result: { status: 'SUBMITTED', txHash: '' },
      })
    })

    it('calls FacilitatorVerifyClient.verify when the local blob matches config', async () => {
      await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(FacilitatorVerifyClient.verify).toHaveBeenCalledOnce()
    })

    it('returns HTTP 200 from the route handler', async () => {
      const resp = await request(app)
        .get('/resource')
        .set('X-Payment', X_PAYMENT_HEADER)
      expect(resp.status).toBe(200)
    })
  })
})
