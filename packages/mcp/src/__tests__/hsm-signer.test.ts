/**
 * HsmSigner unit tests
 * Tests the Zetrix HSM API client (POST /api/hsm/sign-blob) and URL resolver.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HsmSigner, resolveHsmBaseUrl } from '../hsm-signer'

const TESTNET_URL = 'https://public-api-sandbox.zetrix.com'
const MAINNET_URL = 'https://public-api.zetrix.com'

function makeOkResponse(signBlob: string, publicKey: string): Response {
  return {
    ok:   true,
    json: async () => ({
      success: true,
      object:  [{ signBlob, publicKey }],
    }),
  } as unknown as Response
}

// ===========================================================================
// resolveHsmBaseUrl
// ===========================================================================

describe('resolveHsmBaseUrl', () => {
  it('returns testnet URL for zetrix:testnet', () => {
    expect(resolveHsmBaseUrl('zetrix:testnet')).toBe(TESTNET_URL)
  })

  it('returns mainnet URL for zetrix:mainnet', () => {
    expect(resolveHsmBaseUrl('zetrix:mainnet')).toBe(MAINNET_URL)
  })

  it('returns mainnet URL for any network that does not include "testnet"', () => {
    expect(resolveHsmBaseUrl('zetrix:unknown')).toBe(MAINNET_URL)
  })
})

// ===========================================================================
// HsmSigner.sign
// ===========================================================================

describe('HsmSigner.sign', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns signBlob and publicKey on a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse('sig-abc', 'pub-xyz'))

    const result = await HsmSigner.sign('blob123', 'ZADDR', 'secret', TESTNET_URL)

    expect(result.signBlob).toBe('sig-abc')
    expect(result.publicKey).toBe('pub-xyz')
  })

  it('POSTs to /api/hsm/sign-blob on the provided baseUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse('s', 'p'))

    await HsmSigner.sign('blob', 'ZADDR', 'pass', TESTNET_URL)

    expect(fetch).toHaveBeenCalledWith(
      `${TESTNET_URL}/api/hsm/sign-blob`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends blob, address, and password in the request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse('s', 'p'))

    await HsmSigner.sign('deadbeef', 'ZTEST123', 'mypassword', TESTNET_URL)

    const call = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      blob:     'deadbeef',
      address:  'ZTEST123',
      password: 'mypassword',
    })
  })

  it('sets Content-Type: application/json header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse('s', 'p'))

    await HsmSigner.sign('blob', 'addr', 'pass', TESTNET_URL)

    const call = vi.mocked(fetch).mock.calls[0]
    expect((call[1]!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('throws with HTTP status when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' } as unknown as Response)

    await expect(
      HsmSigner.sign('blob', 'addr', 'pass', TESTNET_URL)
    ).rejects.toThrow('HTTP 401')
  })

  it('throws with ERROR message from messages[] when success is false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        success:  false,
        object:   [],
        messages: [{ type: 'ERROR', errorCode: 1001, message: 'Invalid password' }],
      }),
    } as unknown as Response)

    await expect(
      HsmSigner.sign('blob', 'addr', 'pass', TESTNET_URL)
    ).rejects.toThrow('Invalid password')
  })

  it('throws with "unknown error" when success is false and messages is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ success: false, object: [], messages: [] }),
    } as unknown as Response)

    await expect(
      HsmSigner.sign('blob', 'addr', 'pass', TESTNET_URL)
    ).rejects.toThrow('unknown error')
  })

  it('throws when success is true but object array is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ success: true, object: [] }),
    } as unknown as Response)

    await expect(
      HsmSigner.sign('blob', 'addr', 'pass', TESTNET_URL)
    ).rejects.toThrow()
  })

  it('uses mainnet URL when provided baseUrl is the mainnet endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse('s', 'p'))

    await HsmSigner.sign('blob', 'addr', 'pass', MAINNET_URL)

    expect(fetch).toHaveBeenCalledWith(
      `${MAINNET_URL}/api/hsm/sign-blob`,
      expect.anything(),
    )
  })
})
