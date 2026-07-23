/**
 * FacilitatorSettleClient — unit tests (APP-M08)
 *
 * Tests for FacilitatorSettleClient.settle() covering:
 *   - HTTP 200 SUBMITTED (self-pay sync) — C4
 *   - HTTP 200 FAILED with errorCode/errorMsg — C5
 *   - txHash ?? '' fallback when txHash absent
 *   - HTTP 202 QUEUED + blobId extraction — C4
 *   - HTTP 409 idempotency errorCode/errorMsg — C6
 *   - Unexpected HTTP status throws
 *   - POST /settle called with correct args
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { FacilitatorSettleClient } from '../facilitator/settle-client'
import type { XPaymentHeader } from '../types'

const FAKE_URL = 'https://facilitator.test'
const PAYLOAD = {} as XPaymentHeader

function mockResp(status: number, body: unknown) {
  return { status, json: async () => body }
}

describe('FacilitatorSettleClient.settle', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // -------------------------------------------------------------------------
  // 1. HTTP 200 — self-pay sync (C4)
  // -------------------------------------------------------------------------
  describe('HTTP 200 — self-pay sync (C4)', () => {
    it('returns httpStatus 200 with SUBMITTED status and txHash', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: 'TX001' } })
      ))
      const result = await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      expect(result.httpStatus).toBe(200)
      if (result.httpStatus !== 200) return
      expect(result.result.status).toBe('SUBMITTED')
      expect(result.result.txHash).toBe('TX001')
    })

    it('returns FAILED status with errorCode and errorMsg (C5)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, {
          success: true,
          object: { status: 'FAILED', txHash: '', errorCode: 460808, errorMsg: 'insufficient_funds' },
        })
      ))
      const result = await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      expect(result.httpStatus).toBe(200)
      if (result.httpStatus !== 200) return
      expect(result.result.status).toBe('FAILED')
      expect(result.result.errorCode).toBe(460808)
      expect(result.result.errorMsg).toBe('insufficient_funds')
    })

    it('uses empty string when txHash is absent from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED' } })
      ))
      const result = await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      expect(result.httpStatus).toBe(200)
      if (result.httpStatus !== 200) return
      expect(result.result.txHash).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // 2. HTTP 202 — sponsored async (C4)
  // -------------------------------------------------------------------------
  describe('HTTP 202 — sponsored async (C4)', () => {
    it('returns httpStatus 202 with QUEUED status and blobId', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(202, { success: true, object: { status: 'QUEUED', blobId: 'BLOB-sponsor-001' } })
      ))
      const result = await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      expect(result.httpStatus).toBe(202)
      if (result.httpStatus !== 202) return
      expect(result.result.status).toBe('QUEUED')
      expect(result.result.blobId).toBe('BLOB-sponsor-001')
    })
  })

  // -------------------------------------------------------------------------
  // 3. HTTP 409 — idempotency (C6)
  // -------------------------------------------------------------------------
  describe('HTTP 409 — idempotency (C6)', () => {
    it('returns httpStatus 409 with errorCode 460810 and errorMsg', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(409, { success: false, object: { errorCode: 460810, errorMsg: 'blob_already_settled' } })
      ))
      const result = await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      expect(result.httpStatus).toBe(409)
      if (result.httpStatus !== 409) return
      expect(result.result.errorCode).toBe(460810)
      expect(result.result.errorMsg).toBe('blob_already_settled')
    })
  })

  // -------------------------------------------------------------------------
  // 4. AbortController timeout (APP-M01)
  // -------------------------------------------------------------------------
  describe('AbortController timeout', () => {
    it('throws a timeout error when fetch is aborted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      await expect(FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL))
        .rejects.toThrow('timed out after 30s')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Unexpected HTTP status
  // -------------------------------------------------------------------------
  describe('unexpected HTTP status', () => {
    it('throws on HTTP 500', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(500, { success: false, object: {} })
      ))
      await expect(FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL))
        .rejects.toThrow('unexpected HTTP status 500')
    })
  })

  // -------------------------------------------------------------------------
  // 6. Fetch call args
  // -------------------------------------------------------------------------
  describe('fetch call', () => {
    it('calls POST /settle with Content-Type and JSON-serialised payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: '' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      const testPayload = { x402Version: 2, scheme: 'exact' } as unknown as XPaymentHeader
      await FacilitatorSettleClient.settle(testPayload, FAKE_URL)
      expect(mockFetch).toHaveBeenCalledWith(
        `${FAKE_URL}/settle`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify(testPayload) })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 7. Auth headers
  // -------------------------------------------------------------------------
  describe('auth headers', () => {
    it('includes x-api-key header when auth.apiKey is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: '' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL, { apiKey: 'test-api-key' })
      const [, init] = mockFetch.mock.calls[0]
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-api-key')
    })

    it('includes Authorization Bearer header when auth.bearerToken is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: '' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL, { bearerToken: 'tok-xyz' })
      const [, init] = mockFetch.mock.calls[0]
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-xyz')
    })

    it('includes both auth headers when both are provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: '' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL, { apiKey: 'k1', bearerToken: 'b1' })
      const [, init] = mockFetch.mock.calls[0]
      const h = init.headers as Record<string, string>
      expect(h['x-api-key']).toBe('k1')
      expect(h['Authorization']).toBe('Bearer b1')
    })

    it('omits auth headers when no auth is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'SUBMITTED', txHash: '' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleClient.settle(PAYLOAD, FAKE_URL)
      const [, init] = mockFetch.mock.calls[0]
      const h = init.headers as Record<string, string>
      expect(h['x-api-key']).toBeUndefined()
      expect(h['Authorization']).toBeUndefined()
    })
  })
})
