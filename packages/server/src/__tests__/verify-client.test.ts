/**
 * FacilitatorVerifyClient — unit tests (APP-M08)
 *
 * Tests for FacilitatorVerifyClient.verify() covering:
 *   - Non-2xx HTTP (!resp.ok) → isValid:false
 *   - envelope.success:false with 2xx → isValid:false
 *   - envelope.object absent on error → graceful undefined fields
 *   - Success path: isValid:true with optional errorCode/errorMsg
 *   - obj.isValid ?? false fallback when isValid absent from object
 *   - POST /verify called with correct args
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { FacilitatorVerifyClient } from '../facilitator/verify-client'
import type { XPaymentHeader } from '../types'

const FAKE_URL = 'https://facilitator.test'
const PAYLOAD = {} as XPaymentHeader

function mockResp(status: number, ok: boolean, body: unknown) {
  return { status, ok, json: async () => body }
}

describe('FacilitatorVerifyClient.verify', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // -------------------------------------------------------------------------
  // 1. Non-2xx HTTP (!resp.ok path)
  // -------------------------------------------------------------------------
  describe('non-2xx HTTP response (!resp.ok)', () => {
    it('returns isValid:false on HTTP 500 with errorCode and errorMsg', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(500, false, { success: false, object: { errorCode: 500, errorMsg: 'internal_error' } })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe(500)
      expect(result.errorMsg).toBe('internal_error')
    })

    it('returns isValid:false with undefined fields when object is absent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(503, false, { success: false })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBeUndefined()
      expect(result.errorMsg).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // 2. 2xx but envelope.success:false
  // -------------------------------------------------------------------------
  describe('2xx but envelope.success:false', () => {
    it('returns isValid:false when success is false despite 2xx status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, true, { success: false, object: { errorCode: 460801, errorMsg: 'invalid_signature' } })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe(460801)
      expect(result.errorMsg).toBe('invalid_signature')
    })
  })

  // -------------------------------------------------------------------------
  // 3. Success path
  // -------------------------------------------------------------------------
  describe('success path (2xx + success:true)', () => {
    it('returns isValid:true when object.isValid is true', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.isValid).toBe(true)
    })

    it('propagates optional errorCode and errorMsg from object', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true, errorCode: 0, errorMsg: 'ok' } })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.errorCode).toBe(0)
      expect(result.errorMsg).toBe('ok')
    })

    it('returns isValid:false via ?? false fallback when object.isValid is absent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: {} })
      ))
      const result = await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      expect(result.isValid).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Fetch call args
  // -------------------------------------------------------------------------
  describe('fetch call', () => {
    it('calls POST /verify with Content-Type and JSON-serialised payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      )
      vi.stubGlobal('fetch', mockFetch)
      const testPayload = { x402Version: 2, scheme: 'exact' } as unknown as XPaymentHeader
      await FacilitatorVerifyClient.verify(testPayload, FAKE_URL)
      expect(mockFetch).toHaveBeenCalledWith(
        `${FAKE_URL}/verify`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify(testPayload) })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 5. Auth headers
  // -------------------------------------------------------------------------
  describe('auth headers', () => {
    it('includes x-api-key header when auth.apiKey is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL, { apiKey: 'test-api-key' })
      const [, init] = mockFetch.mock.calls[0]
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-api-key')
    })

    it('includes Authorization Bearer header when auth.bearerToken is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL, { bearerToken: 'tok-abc' })
      const [, init] = mockFetch.mock.calls[0]
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-abc')
    })

    it('includes both auth headers when both are provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL, { apiKey: 'k1', bearerToken: 'b1' })
      const [, init] = mockFetch.mock.calls[0]
      const h = init.headers as Record<string, string>
      expect(h['x-api-key']).toBe('k1')
      expect(h['Authorization']).toBe('Bearer b1')
    })

    it('omits auth headers when no auth is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, true, { success: true, object: { isValid: true } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorVerifyClient.verify(PAYLOAD, FAKE_URL)
      const [, init] = mockFetch.mock.calls[0]
      const h = init.headers as Record<string, string>
      expect(h['x-api-key']).toBeUndefined()
      expect(h['Authorization']).toBeUndefined()
    })
  })
})
