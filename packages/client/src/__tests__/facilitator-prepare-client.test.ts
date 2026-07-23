/**
 * FacilitatorPrepareClient unit tests
 *
 * POST /prepare → unwrap C1 envelope → return PrepareResult.
 * Tested with fetch mock — no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FacilitatorPrepareClient } from '../facilitator/prepare-client'

const ADDR            = 'ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6'
const FACILITATOR_URL = 'https://facilitator.zetrix.io/api/v1/facilitator'

const PREPARE_PARAMS = {
  clientAddress: ADDR,
  payTo:         ADDR,
  amount:        '1000000',
  asset:         'Z9xKtestContractAddr',
  network:       'zetrix:testnet',
}

const MOCK_RESULT = {
  blob:             'deadbeefblob',
  hash:             'abc123hash',
  blobId:           'BLOB-test1234',
  paymasterAddress: 'Z9X2paymasterAddr',
  validBefore:      1748175000,
}

/** Helper: successful 200 response wrapping the C1 envelope */
function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('FacilitatorPrepareClient.prepare', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it('returns PrepareResult with blob, hash, blobId, paymasterAddress, validBefore', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ object: MOCK_RESULT, success: true })
    )

    const result = await FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL)

    expect(result.blob).toBe(MOCK_RESULT.blob)
    expect(result.hash).toBe(MOCK_RESULT.hash)
    expect(result.blobId).toBe(MOCK_RESULT.blobId)
    expect(result.paymasterAddress).toBe(MOCK_RESULT.paymasterAddress)
    expect(result.validBefore).toBe(MOCK_RESULT.validBefore)
  })

  it('POSTs to facilitatorUrl + /prepare', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ object: MOCK_RESULT, success: true })
    )

    await FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL)

    const [calledUrl] = vi.mocked(fetch).mock.calls[0]
    expect(calledUrl).toBe(`${FACILITATOR_URL}/prepare`)
  })

  it('sends all required params in POST body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ object: MOCK_RESULT, success: true })
    )

    await FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.clientAddress).toBe(PREPARE_PARAMS.clientAddress)
    expect(body.payTo).toBe(PREPARE_PARAMS.payTo)
    expect(body.amount).toBe(PREPARE_PARAMS.amount)
    expect(body.asset).toBe(PREPARE_PARAMS.asset)
    expect(body.network).toBe(PREPARE_PARAMS.network)
  })

  it('unwraps C1 envelope — reads result from response.object', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ object: MOCK_RESULT, success: true })
    )

    const result = await FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL)
    expect(result.blobId).toBe(MOCK_RESULT.blobId)
  })

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------
  it('throws when success is false — includes errorMsg from Facilitator', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ object: { errorCode: 461407, errorMsg: 'unsupported_network' }, success: false })
    )

    await expect(FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL))
      .rejects.toThrow(/unsupported_network/)
  })

  it('throws when Facilitator returns non-2xx HTTP status (e.g. 502 Bad Gateway)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token') } } as unknown as Response
    )

    await expect(FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL))
      .rejects.toThrow(/HTTP 502/)
  })

  it('throws when fetch fails (network error)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))

    await expect(FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL))
      .rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // HTTPS validation (APP-M02)
  // -------------------------------------------------------------------------
  it('throws when facilitatorUrl uses http:// instead of https://', async () => {
    await expect(
      FacilitatorPrepareClient.prepare(PREPARE_PARAMS, 'http://facilitator.zetrix.io/api/v1/facilitator')
    ).rejects.toThrow('facilitatorUrl must use HTTPS')
  })

  it('throws when facilitatorUrl is a non-URL string', async () => {
    await expect(
      FacilitatorPrepareClient.prepare(PREPARE_PARAMS, 'facilitator.zetrix.io')
    ).rejects.toThrow('facilitatorUrl must use HTTPS')
  })

  it('does not call fetch when facilitatorUrl fails HTTPS check', async () => {
    await expect(
      FacilitatorPrepareClient.prepare(PREPARE_PARAMS, 'http://bad.url')
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Timeout (APP-M02)
  // -------------------------------------------------------------------------
  it('throws a descriptive timeout error when fetch is aborted after 30s', async () => {
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    vi.useFakeTimers()
    const promise = FacilitatorPrepareClient.prepare(PREPARE_PARAMS, FACILITATOR_URL)
    vi.advanceTimersByTime(30_000)
    await expect(promise).rejects.toThrow('timed out after 30s')
  })
})
