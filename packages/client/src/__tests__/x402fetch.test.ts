/**
 * x402Fetch wrapper unit tests
 *
 * createX402Fetch returns a fetch-compatible function that:
 *   - passes 200 responses through unchanged
 *   - intercepts 402, calls PaymentEngine.pay, retries with X-PAYMENT header
 *   - enforces PaymentPolicy.maxAmountPerRequest
 *   - throws on non-JSON 402 body or empty accepts[]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createX402Fetch, PaymentPolicyError } from '../x402fetch'
import { PaymentEngine, InsufficientBalanceError } from '../payment-engine'

vi.mock('../payment-engine', () => ({
  PaymentEngine: {
    pay: vi.fn(),
  },
  InsufficientBalanceError: class InsufficientBalanceError extends Error {
    constructor(
      message: string,
      public readonly required: string,
      public readonly available: string,
      public readonly asset: string,
    ) {
      super(message)
      this.name = 'InsufficientBalanceError'
    }
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET = { privateKey: 'privBtTEST', address: 'ZTEST123', network: 'zetrix:testnet' }
const NODE   = { host: 'node.zetrix.com', port: '19943' }
const URL    = 'https://api.example.com/resource'

const PAYMENT_REQUIREMENTS = {
  scheme:            'exact',
  network:           'zetrix:testnet',
  asset:             'ZTX',
  payTo:             'ZPAYTO123',
  maxAmountRequired: '1000000',
  extra: { gasModel: 'client', gasPrice: '1000', feeLimit: '100000' },
}

const MOCK_X_PAYMENT = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64')

function make200(): Response {
  return { status: 200, ok: true, text: async () => 'ok body', json: async () => ({}) } as unknown as Response
}

function make402(accepts = [PAYMENT_REQUIREMENTS]): Response {
  return {
    status: 402,
    ok: false,
    json: async () => ({ x402Version: 2, error: 'payment_required', accepts }),
  } as unknown as Response
}

function make402NonJson(): Response {
  return {
    status: 402,
    ok: false,
    json: async () => { throw new SyntaxError('Unexpected token') },
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createX402Fetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(PaymentEngine.pay).mockResolvedValue(MOCK_X_PAYMENT)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Plain 200 — pass through
  // -------------------------------------------------------------------------
  describe('plain 200 response — passes through unchanged', () => {
    it('returns the 200 response directly', async () => {
      const resp200 = make200()
      vi.mocked(fetch).mockResolvedValueOnce(resp200)

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      const result = await myFetch(URL)

      expect(result).toBe(resp200)
    })

    it('does not call PaymentEngine.pay for 200 responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL)

      expect(PaymentEngine.pay).not.toHaveBeenCalled()
    })

    it('forwards request init to underlying fetch', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      const init = { method: 'POST', body: 'data' }
      await myFetch(URL, init)

      expect(fetch).toHaveBeenCalledWith(URL, init)
    })
  })

  // -------------------------------------------------------------------------
  // 402 → payment → retry
  // -------------------------------------------------------------------------
  describe('402 response — triggers payment + retry', () => {
    it('calls PaymentEngine.pay when 402 is received', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL)

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS, WALLET, NODE, { validBeforeOffset: undefined }
      )
    })

    it('retries the request with X-PAYMENT header after payment', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL)

      const [, retryInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit]
      expect((retryInit.headers as Record<string, string>)['x-payment']).toBe(MOCK_X_PAYMENT)
    })

    it('returns the 200 response from the retry', async () => {
      const retryResp = make200()
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(retryResp)

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      const result = await myFetch(URL)

      expect(result).toBe(retryResp)
    })

    it('passes accepts[0] from 402 body to PaymentEngine.pay', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL)

      const [payReq] = vi.mocked(PaymentEngine.pay).mock.calls[0]
      expect(payReq).toEqual(PAYMENT_REQUIREMENTS)
    })

    it('throws when 402 body is not valid JSON', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402NonJson())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).rejects.toThrow('402 response did not return valid JSON')
    })

    it('throws when 402 body has empty accepts[]', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402([]))

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).rejects.toThrow('no payment options in accepts[]')
    })

    it('throws when 402 body has no accepts field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 402,
        ok: false,
        json: async () => ({ x402Version: 2, error: 'payment_required' }),
      } as unknown as Response)

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).rejects.toThrow('no payment options in accepts[]')
    })

    it('propagates error when PaymentEngine.pay throws (APP-L04)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())
      vi.mocked(PaymentEngine.pay).mockRejectedValueOnce(new Error('signing failed'))

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).rejects.toThrow('signing failed')
    })

    it('preserves existing request headers on retry (APP-L03)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL, { headers: { Authorization: 'Bearer token123' } })

      const [, retryInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit]
      const headers = retryInit.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer token123')
      expect(headers['x-payment']).toBe(MOCK_X_PAYMENT)
    })

    it('preserves existing Headers instance on retry (APP-L03)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      const headersObj = new Headers({ Authorization: 'Bearer token456' })
      await myFetch(URL, { headers: headersObj })

      const [, retryInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit]
      const headers = retryInit.headers as Record<string, string>
      expect(headers['authorization']).toBe('Bearer token456')
      expect(headers['x-payment']).toBe(MOCK_X_PAYMENT)
    })

    it('preserves string[][] (array-of-pairs) headers on retry (APP-L02)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL, { headers: [['Authorization', 'Bearer arr']] })

      const [, retryInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit]
      const headers = retryInit.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer arr')
      expect(headers['x-payment']).toBe(MOCK_X_PAYMENT)
    })
  })

  // -------------------------------------------------------------------------
  // PaymentPolicy — maxAmountPerRequest
  // -------------------------------------------------------------------------
  describe('PaymentPolicy — maxAmountPerRequest', () => {
    it('throws PaymentPolicyError when amount exceeds maxAmountPerRequest', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const myFetch = createX402Fetch({
        wallet: WALLET,
        node:   NODE,
        policy: { maxAmountPerRequest: '500000' },
      })

      await expect(myFetch(URL)).rejects.toThrow(PaymentPolicyError)
    })

    it('error message mentions the amounts for debugging', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const myFetch = createX402Fetch({
        wallet: WALLET,
        node:   NODE,
        policy: { maxAmountPerRequest: '500000' },
      })

      await expect(myFetch(URL)).rejects.toThrow(/500000/)
    })

    it('allows payment when amount equals maxAmountPerRequest', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({
        wallet: WALLET,
        node:   NODE,
        policy: { maxAmountPerRequest: '1000000' },
      })

      await expect(myFetch(URL)).resolves.toBeDefined()
      expect(PaymentEngine.pay).toHaveBeenCalled()
    })

    it('allows payment when no policy is set', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).resolves.toBeDefined()
      expect(PaymentEngine.pay).toHaveBeenCalled()
    })

    it('throws descriptively when maxAmountRequired is not a valid integer (APP-M02)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402([{
        ...PAYMENT_REQUIREMENTS,
        maxAmountRequired: '1000.5',
      }]))

      const myFetch = createX402Fetch({
        wallet: WALLET,
        node:   NODE,
        policy: { maxAmountPerRequest: '5000000' },
      })

      await expect(myFetch(URL)).rejects.toThrow('is not a valid integer amount string')
    })

    it('throws descriptively when policy.maxAmountPerRequest is not a valid integer (APP-M02)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const myFetch = createX402Fetch({
        wallet: WALLET,
        node:   NODE,
        policy: { maxAmountPerRequest: 'invalid' },
      })

      await expect(myFetch(URL)).rejects.toThrow('is not a valid integer amount string')
    })
  })

  // -------------------------------------------------------------------------
  // InsufficientBalanceError propagation
  // -------------------------------------------------------------------------
  describe('InsufficientBalanceError propagation', () => {
    it('propagates InsufficientBalanceError thrown by PaymentEngine.pay (not caught internally)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())
      vi.mocked(PaymentEngine.pay).mockRejectedValueOnce(
        new InsufficientBalanceError('Insufficient ZTX: required 1100000, available 500000', '1100000', '500000', 'ZTX')
      )

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await expect(myFetch(URL)).rejects.toThrow(InsufficientBalanceError)
    })

    it('preserves error.required, error.available, error.asset on the thrown error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())
      const balanceError = new InsufficientBalanceError('msg', '1100000', '500000', 'ZTX')
      vi.mocked(PaymentEngine.pay).mockRejectedValueOnce(balanceError)

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      const thrown = await myFetch(URL).catch((e: unknown) => e)
      expect(thrown).toBeInstanceOf(InsufficientBalanceError)
      const err = thrown as InsufficientBalanceError
      expect(err.required).toBe('1100000')
      expect(err.available).toBe('500000')
      expect(err.asset).toBe('ZTX')
    })
  })

  // -------------------------------------------------------------------------
  // validBeforeOffset — client-side config (APP-M01)
  // -------------------------------------------------------------------------
  describe('validBeforeOffset — client-side config', () => {
    it('passes validBeforeOffset from config to PaymentEngine.pay', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE, validBeforeOffset: 600 })
      await myFetch(URL)

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS,
        WALLET,
        NODE,
        { validBeforeOffset: 600 },
      )
    })

    it('passes undefined validBeforeOffset when not configured (uses PaymentEngine default)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const myFetch = createX402Fetch({ wallet: WALLET, node: NODE })
      await myFetch(URL)

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS,
        WALLET,
        NODE,
        { validBeforeOffset: undefined },
      )
    })
  })
})
