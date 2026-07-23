/**
 * FacilitatorSettleStatusClient — unit tests (APP-M03)
 *
 * Tests for FacilitatorSettleStatusClient.poll() covering:
 *   - CONFIRMED on first attempt
 *   - FAILED path (errorCode + errorMsg)
 *   - UNKNOWN on HTTP 404 early exit
 *   - UNKNOWN when success:false
 *   - UNKNOWN after MAX_ATTEMPTS cap (20 polls all QUEUED)
 *   - QUEUED → CONFIRMED multi-attempt flow
 *   - URL encoding of blobId in query string
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { FacilitatorSettleStatusClient } from '../facilitator/settle-status-client'

function mockResp(status: number, body: unknown) {
  return { status, json: async () => body }
}

describe('FacilitatorSettleStatusClient.poll', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // 1. CONFIRMED on first attempt
  // -------------------------------------------------------------------------
  describe('CONFIRMED on first attempt', () => {
    it('returns status CONFIRMED with txHash and blobId', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX_HASH_001' } })
      ))
      const result = await FacilitatorSettleStatusClient.poll('blob-001', 'https://facilitator.test')
      expect(result.status).toBe('CONFIRMED')
      expect(result.txHash).toBe('TX_HASH_001')
      expect(result.blobId).toBe('blob-001')
    })

    it('fetch is called exactly once', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob-002', 'https://facilitator.test')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // 2. FAILED on first attempt
  // -------------------------------------------------------------------------
  describe('FAILED on first attempt', () => {
    it('returns status FAILED with errorCode and errorMsg', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, {
          success: true,
          object: { status: 'FAILED', errorCode: 460808, errorMsg: 'insufficient_funds' },
        })
      ))
      const result = await FacilitatorSettleStatusClient.poll('blob-003', 'https://facilitator.test')
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe(460808)
      expect(result.errorMsg).toBe('insufficient_funds')
      expect(result.blobId).toBe('blob-003')
    })
  })

  // -------------------------------------------------------------------------
  // 3. HTTP 404 early exit
  // -------------------------------------------------------------------------
  describe('HTTP 404 early exit', () => {
    it('returns UNKNOWN immediately on HTTP 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(404, { success: false, object: { errorCode: 404, errorMsg: 'not_found' } })
      ))
      const result = await FacilitatorSettleStatusClient.poll('blob-004', 'https://facilitator.test')
      expect(result.status).toBe('UNKNOWN')
      expect(result.blobId).toBe('blob-004')
    })

    it('fetch is called exactly once for 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(404, { success: false, object: {} })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob-005', 'https://facilitator.test')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // 4. success:false early exit (non-404)
  // -------------------------------------------------------------------------
  describe('success:false early exit', () => {
    it('returns UNKNOWN when success is false', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResp(200, { success: false, object: { errorCode: 500, errorMsg: 'internal_error' } })
      ))
      const result = await FacilitatorSettleStatusClient.poll('blob-006', 'https://facilitator.test')
      expect(result.status).toBe('UNKNOWN')
      expect(result.errorCode).toBe(500)
      expect(result.errorMsg).toBe('internal_error')
    })
  })

  // -------------------------------------------------------------------------
  // 5. UNKNOWN after MAX_ATTEMPTS cap (80 polls all QUEUED)
  // -------------------------------------------------------------------------
  describe('UNKNOWN after MAX_ATTEMPTS cap', () => {
    it('returns UNKNOWN after 80 QUEUED polls', async () => {
      vi.useFakeTimers()
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'QUEUED' } })
      )
      vi.stubGlobal('fetch', mockFetch)

      const pollPromise = FacilitatorSettleStatusClient.poll('blob-007', 'https://facilitator.test')
      await vi.runAllTimersAsync()
      const result = await pollPromise

      expect(result.status).toBe('UNKNOWN')
      expect(result.blobId).toBe('blob-007')
      expect(mockFetch).toHaveBeenCalledTimes(80)
    })
  })

  // -------------------------------------------------------------------------
  // 6. QUEUED → CONFIRMED (multi-attempt)
  // -------------------------------------------------------------------------
  describe('QUEUED then CONFIRMED', () => {
    it('returns CONFIRMED after one QUEUED poll then CONFIRMED', async () => {
      vi.useFakeTimers()
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          mockResp(200, { success: true, object: { status: 'QUEUED' } })
        )
        .mockResolvedValueOnce(
          mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX_AFTER_QUEUE' } })
        )
      vi.stubGlobal('fetch', mockFetch)

      const pollPromise = FacilitatorSettleStatusClient.poll('blob-008', 'https://facilitator.test')
      await vi.runAllTimersAsync()
      const result = await pollPromise

      expect(result.status).toBe('CONFIRMED')
      expect(result.txHash).toBe('TX_AFTER_QUEUE')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // 7. URL encoding of blobId
  // -------------------------------------------------------------------------
  describe('URL encoding', () => {
    it('URL-encodes blobId with special characters in the query string', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob id/special', 'https://facilitator.test')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://facilitator.test/settle/status?blobId=blob%20id%2Fspecial',
        undefined,
      )
    })
  })

  // -------------------------------------------------------------------------
  // 8. Auth headers
  // -------------------------------------------------------------------------
  describe('auth headers', () => {
    it('includes x-api-key header when auth.apiKey is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob-auth-1', 'https://facilitator.test', { apiKey: 'test-key' })
      const [, init] = mockFetch.mock.calls[0]
      expect(((init as RequestInit).headers as Record<string, string>)['x-api-key']).toBe('test-key')
    })

    it('includes Authorization Bearer header when auth.bearerToken is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob-auth-2', 'https://facilitator.test', { bearerToken: 'tok-poll' })
      const [, init] = mockFetch.mock.calls[0]
      expect(((init as RequestInit).headers as Record<string, string>)['Authorization']).toBe('Bearer tok-poll')
    })

    it('passes undefined as init when no auth is provided (no extra headers)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResp(200, { success: true, object: { status: 'CONFIRMED', txHash: 'TX' } })
      )
      vi.stubGlobal('fetch', mockFetch)
      await FacilitatorSettleStatusClient.poll('blob-no-auth', 'https://facilitator.test')
      const [, init] = mockFetch.mock.calls[0]
      expect(init).toBeUndefined()
    })
  })
})
