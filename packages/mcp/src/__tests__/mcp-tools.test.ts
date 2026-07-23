/**
 * MCP tool handler unit tests
 *
 * createMcpTools returns three tool handlers:
 *   fetch_with_payment  — calls PaymentEngine on 402, returns { status, body, paymentMade, amountPaid, asset }
 *   get_wallet_info     — returns { address, network, configured }
 *   check_payment_capability — queries Zetrix RPC balance, returns { capable, balance }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMcpTools } from '../mcp-tools'
import { PaymentEngine } from 'x402-zetrix-client'
import { HsmSigner } from '../hsm-signer'

vi.mock('x402-zetrix-client', () => ({
  PaymentEngine: {
    pay:               vi.fn(),
    fetchAccountInfo:  vi.fn(),
    fetchZTP20Balance: vi.fn(),
  },
}))

vi.mock('../hsm-signer', () => ({
  HsmSigner: { sign: vi.fn() },
  resolveHsmBaseUrl: vi.fn().mockReturnValue('https://public-api-sandbox.zetrix.com'),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET     = { privateKey: 'privTEST', address: 'ZTEST123', network: 'zetrix:testnet' }
const NODE       = { host: 'node.zetrix.com', port: '19943' }
const HSM_CONFIG = {
  address:  'ZHSMTEST123',
  network:  'zetrix:testnet',
  baseUrl:  'https://public-api-sandbox.zetrix.com',
  password: 'hsm-secret',
}

const PAYMENT_REQUIREMENTS = {
  scheme:            'exact',
  network:           'zetrix:testnet',
  asset:             'ZTX',
  payTo:             'ZPAYTO123',
  maxAmountRequired: '1000000',
  extra: { gasModel: 'client', gasPrice: '1000', feeLimit: '100000' },
}

const MOCK_X_PAYMENT = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64')

function make200(body = 'ok body'): Response {
  return { status: 200, ok: true, text: async () => body } as unknown as Response
}

function make402(accepts = [PAYMENT_REQUIREMENTS]): Response {
  return {
    status: 402,
    ok: false,
    json: async () => ({ x402Version: 2, error: 'payment_required', accepts }),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMcpTools', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(PaymentEngine.pay).mockResolvedValue(MOCK_X_PAYMENT)
    vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValue({ balance: '0' })
    vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValue({ balance: '0' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // fetch_with_payment
  // -------------------------------------------------------------------------
  describe('fetch_with_payment', () => {
    it('returns status and body on a plain 200 with no payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make200('hello'))

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(result.status).toBe(200)
      expect(result.body).toBe('hello')
    })

    it('sets paymentMade:false and empty amountPaid/amountPaidHuman/asset on 200 with no 402', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(result.paymentMade).toBe(false)
      expect(result.amountPaid).toBe('')
      expect(result.amountPaidHuman).toBe('')
      expect(result.asset).toBe('')
    })

    it('calls PaymentEngine.pay when 402 is received', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS, WALLET, NODE, { validBeforeOffset: undefined }
      )
    })

    it('sets paymentMade:true with amountPaid, amountPaidHuman, and asset after 402 payment', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200('paid body'))

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(result.paymentMade).toBe(true)
      expect(result.amountPaid).toBe('1000000')
      expect(result.amountPaidHuman).toBe('1 ZTX')
      expect(result.asset).toBe('ZTX')
    })

    it('returns the retry response status and body after payment', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200('paid content'))

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(result.status).toBe(200)
      expect(result.body).toBe('paid content')
    })

    it('forwards method and headers to the underlying fetch', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      await tools.fetch_with_payment({
        url:     'https://api.example.com/resource',
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{"key":"val"}',
      })

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/resource',
        expect.objectContaining({ method: 'POST', body: '{"key":"val"}' })
      )
    })

    it('passes validBeforeOffset from config to PaymentEngine.pay', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE, validBeforeOffset: 600 })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS, WALLET, NODE, { validBeforeOffset: 600 }
      )
    })

    it('throws when PaymentEngine.pay fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())
      vi.mocked(PaymentEngine.pay).mockRejectedValueOnce(new Error('signing failed'))

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow('signing failed')
    })

    // APP-M02 — null wallet guard
    it('throws descriptive error when wallet is null and 402 is received (APP-M02)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const tools = createMcpTools({ wallet: null, node: NODE })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow('no signer configured')
    })

    // APP-M01 — policy enforcement
    it('throws when payment amount exceeds policy maxAmountPerRequest (APP-M01)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const tools = createMcpTools({ wallet: WALLET, node: NODE, policy: { maxAmountPerRequest: '500000' } })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow(/500000/)
    })

    it('error message mentions both the required and limit amounts (APP-M01)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const tools = createMcpTools({ wallet: WALLET, node: NODE, policy: { maxAmountPerRequest: '500000' } })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow(/1000000/)
    })

    it('allows payment when amount equals maxAmountPerRequest (APP-M01)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE, policy: { maxAmountPerRequest: '1000000' } })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).resolves.toBeDefined()
      expect(PaymentEngine.pay).toHaveBeenCalled()
    })

    it('allows payment when no policy is set (APP-M01)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).resolves.toBeDefined()
      expect(PaymentEngine.pay).toHaveBeenCalled()
    })

    it('formats amountPaidHuman correctly for ZTX (6 decimals)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402([{ ...PAYMENT_REQUIREMENTS, maxAmountRequired: '100000' }]))
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      expect(result.amountPaidHuman).toBe('0.1 ZTX')
    })

    it('formats amountPaidHuman for ZTP20 using ztp20Decimals config', async () => {
      const ztp20Req = { ...PAYMENT_REQUIREMENTS, asset: 'ZCONTRACT123', maxAmountRequired: '10000' }
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402([ztp20Req]))
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: WALLET, node: NODE, ztp20Decimals: 6 })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      expect(result.amountPaidHuman).toBe('0.01 tokens')
    })
  })

  // -------------------------------------------------------------------------
  // get_wallet_info
  // -------------------------------------------------------------------------
  describe('get_wallet_info', () => {
    it('returns address from config', () => {
      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      expect(tools.get_wallet_info().address).toBe(WALLET.address)
    })

    it('returns network from config', () => {
      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      expect(tools.get_wallet_info().network).toBe(WALLET.network)
    })

    it('returns configured:true when wallet is provided', () => {
      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      expect(tools.get_wallet_info().configured).toBe(true)
    })

    it('returns configured:false when wallet is not provided', () => {
      const tools = createMcpTools({ wallet: null, node: NODE })
      expect(tools.get_wallet_info().configured).toBe(false)
    })

    it('returns empty address when wallet is not configured', () => {
      const tools = createMcpTools({ wallet: null, node: NODE })
      expect(tools.get_wallet_info().address).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // check_payment_capability
  // -------------------------------------------------------------------------
  describe('check_payment_capability', () => {
    it('returns capable:true and balance when account has funds', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '5000000000' })

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.check_payment_capability()

      expect(result.capable).toBe(true)
      expect(result.balance).toBe('5000000000')
    })

    it('returns capable:false when balance is zero', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '0' })

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      const result = await tools.check_payment_capability()

      expect(result.capable).toBe(false)
      expect(result.balance).toBe('0')
    })

    it('calls fetchAccountInfo with wallet address and node (APP-L01)', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '1000' })

      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      await tools.check_payment_capability()

      expect(PaymentEngine.fetchAccountInfo).toHaveBeenCalledWith(WALLET.address, NODE)
    })

    it('returns capable:false and balance "0" when wallet is not configured', async () => {
      const tools = createMcpTools({ wallet: null, node: NODE })
      const result = await tools.check_payment_capability()

      expect(result.capable).toBe(false)
      expect(result.balance).toBe('0')
    })

    // -------------------------------------------------------------------------
    // ZTX (default) routing
    // -------------------------------------------------------------------------
    describe('ZTX asset routing (default)', () => {
      it('calls fetchAccountInfo (not fetchZTP20Balance) when asset is omitted', async () => {
        vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '1000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await tools.check_payment_capability({})

        expect(PaymentEngine.fetchAccountInfo).toHaveBeenCalledWith(WALLET.address, NODE)
        expect(PaymentEngine.fetchZTP20Balance).not.toHaveBeenCalled()
      })

      it('calls fetchAccountInfo when asset is explicitly "ZTX"', async () => {
        vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '1000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await tools.check_payment_capability({ asset: 'ZTX' })

        expect(PaymentEngine.fetchAccountInfo).toHaveBeenCalledWith(WALLET.address, NODE)
        expect(PaymentEngine.fetchZTP20Balance).not.toHaveBeenCalled()
      })
    })

    // -------------------------------------------------------------------------
    // ZTP20 asset routing
    // -------------------------------------------------------------------------
    describe('ZTP20 asset routing', () => {
      const CONTRACT = 'ZCONTRACT12345678901234'

      it('calls fetchZTP20Balance(asset, address, node) when asset is a contract address', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '5000000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await tools.check_payment_capability({ asset: CONTRACT })

        expect(PaymentEngine.fetchZTP20Balance).toHaveBeenCalledWith(CONTRACT, WALLET.address, NODE)
      })

      it('does NOT call fetchAccountInfo when asset is ZTP20', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '5000000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await tools.check_payment_capability({ asset: CONTRACT })

        expect(PaymentEngine.fetchAccountInfo).not.toHaveBeenCalled()
      })

      it('returns capable:true when ZTP20 balance > 0', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '5000000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        const result = await tools.check_payment_capability({ asset: CONTRACT })

        expect(result.capable).toBe(true)
      })

      it('returns capable:false when ZTP20 balance is "0"', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '0' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        const result = await tools.check_payment_capability({ asset: CONTRACT })

        expect(result.capable).toBe(false)
      })

      it('returns balance string from fetchZTP20Balance', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '9876543' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        const result = await tools.check_payment_capability({ asset: CONTRACT })

        expect(result.balance).toBe('9876543')
      })

      it('returns capable:false and balance "0" when wallet is null and ZTP20 asset given', async () => {
        const tools = createMcpTools({ wallet: null, node: NODE })
        const result = await tools.check_payment_capability({ asset: CONTRACT })

        expect(result.capable).toBe(false)
        expect(result.balance).toBe('0')
        expect(PaymentEngine.fetchZTP20Balance).not.toHaveBeenCalled()
      })
    })

    // -------------------------------------------------------------------------
    // Asset input validation — APP-M03
    // -------------------------------------------------------------------------
    describe('asset input validation (APP-M03)', () => {
      it('throws for an invalid asset string (not ZTX and not a valid Zetrix address)', async () => {
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(
          tools.check_payment_capability({ asset: 'invalid-asset' })
        ).rejects.toThrow('invalid asset')
      })

      it('throws for a short asset string that is not "ZTX"', async () => {
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(
          tools.check_payment_capability({ asset: 'ABC' })
        ).rejects.toThrow('invalid asset')
      })

      it('error message includes the invalid asset value', async () => {
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(
          tools.check_payment_capability({ asset: 'badvalue' })
        ).rejects.toThrow('badvalue')
      })

      it('accepts "ZTX" without throwing', async () => {
        vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '1000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(tools.check_payment_capability({ asset: 'ZTX' })).resolves.toBeDefined()
      })

      it('accepts a valid Zetrix contract address (starts with Z, 20-50 chars)', async () => {
        vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '5000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(
          tools.check_payment_capability({ asset: 'ZTP20CONTRACT123VALID1' })
        ).resolves.toBeDefined()
      })

      it('accepts undefined asset (defaults to ZTX)', async () => {
        vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '1000' })
        const tools = createMcpTools({ wallet: WALLET, node: NODE })
        await expect(tools.check_payment_capability({})).resolves.toBeDefined()
      })
    })
  })

  // -------------------------------------------------------------------------
  // check_payment_capability — HSM mode
  // -------------------------------------------------------------------------
  describe('check_payment_capability — HSM mode', () => {
    it('calls fetchAccountInfo with hsmConfig.address when wallet is null', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '5000000' })

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      await tools.check_payment_capability()

      expect(PaymentEngine.fetchAccountInfo).toHaveBeenCalledWith(HSM_CONFIG.address, NODE)
    })

    it('returns capable:true when HSM account has a non-zero balance', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '5000000' })

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      const result = await tools.check_payment_capability()

      expect(result.capable).toBe(true)
      expect(result.balance).toBe('5000000')
    })

    it('returns capable:false when HSM account balance is zero', async () => {
      vi.mocked(PaymentEngine.fetchAccountInfo).mockResolvedValueOnce({ balance: '0' })

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      const result = await tools.check_payment_capability()

      expect(result.capable).toBe(false)
    })

    it('calls fetchZTP20Balance with hsmConfig.address for ZTP20 asset in HSM mode', async () => {
      const CONTRACT = 'ZCONTRACT12345678901234'
      vi.mocked(PaymentEngine.fetchZTP20Balance).mockResolvedValueOnce({ balance: '9000000' })

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      await tools.check_payment_capability({ asset: CONTRACT })

      expect(PaymentEngine.fetchZTP20Balance).toHaveBeenCalledWith(CONTRACT, HSM_CONFIG.address, NODE)
    })
  })

  // -------------------------------------------------------------------------
  // HSM mode
  // -------------------------------------------------------------------------

  describe('fetch_with_payment — HSM mode', () => {
    it('calls PaymentEngine.pay with a signerFn (5th arg) when hsmConfig is set', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(PaymentEngine.pay).toHaveBeenCalledWith(
        PAYMENT_REQUIREMENTS,
        expect.objectContaining({ address: HSM_CONFIG.address }),
        NODE,
        { validBeforeOffset: undefined },
        expect.any(Function),
      )
    })

    it('uses pre-configured password when hsmPassword is absent from input', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      let capturedSignerFn: ((blob: string) => Promise<{ signBlob: string; publicKey: string }>) | undefined
      vi.mocked(PaymentEngine.pay).mockImplementationOnce(async (_req, _wallet, _node, _opts, signerFn) => {
        capturedSignerFn = signerFn
        return MOCK_X_PAYMENT
      })

      vi.mocked(HsmSigner.sign).mockResolvedValueOnce({ signBlob: 'sig', publicKey: 'pub' })

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      await capturedSignerFn!('testblob')
      expect(HsmSigner.sign).toHaveBeenCalledWith(
        'testblob', HSM_CONFIG.address, HSM_CONFIG.password, HSM_CONFIG.baseUrl,
      )
    })

    it('uses hsmPassword from input when no pre-configured password', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      let capturedSignerFn: ((blob: string) => Promise<{ signBlob: string; publicKey: string }>) | undefined
      vi.mocked(PaymentEngine.pay).mockImplementationOnce(async (_req, _wallet, _node, _opts, signerFn) => {
        capturedSignerFn = signerFn
        return MOCK_X_PAYMENT
      })

      vi.mocked(HsmSigner.sign).mockResolvedValueOnce({ signBlob: 'sig', publicKey: 'pub' })

      const hsmNoPass = { ...HSM_CONFIG, password: undefined }
      const tools = createMcpTools({ wallet: null, hsmConfig: hsmNoPass, node: NODE })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource', hsmPassword: 'runtime-pass' })

      await capturedSignerFn!('testblob')
      expect(HsmSigner.sign).toHaveBeenCalledWith(
        'testblob', HSM_CONFIG.address, 'runtime-pass', HSM_CONFIG.baseUrl,
      )
    })

    it('throws when HSM mode has no password from config or input', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const hsmNoPass = { ...HSM_CONFIG, password: undefined }
      const tools = createMcpTools({ wallet: null, hsmConfig: hsmNoPass, node: NODE })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow('HSM mode requires a password')
    })

    it('throws "no signer configured" when both wallet and hsmConfig are absent', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(make402())

      const tools = createMcpTools({ wallet: null, node: NODE })
      await expect(
        tools.fetch_with_payment({ url: 'https://api.example.com/resource' })
      ).rejects.toThrow('no signer configured')
    })

    it('passes fakeWallet with HSM address to PaymentEngine.pay', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200())

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      const payCall = vi.mocked(PaymentEngine.pay).mock.calls[0]
      expect(payCall[1]).toMatchObject({ address: HSM_CONFIG.address, network: HSM_CONFIG.network })
    })

    it('HSM mode: paymentMade is true after 402 payment', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make200('paid'))

      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      const result = await tools.fetch_with_payment({ url: 'https://api.example.com/resource' })

      expect(result.paymentMade).toBe(true)
    })
  })

  describe('get_wallet_info — signerMode', () => {
    it('returns signerMode:"local" when wallet is configured', () => {
      const tools = createMcpTools({ wallet: WALLET, node: NODE })
      expect(tools.get_wallet_info().signerMode).toBe('local')
    })

    it('returns signerMode:"hsm" when hsmConfig is set', () => {
      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      expect(tools.get_wallet_info().signerMode).toBe('hsm')
    })

    it('returns signerMode:"unconfigured" when neither wallet nor hsmConfig is set', () => {
      const tools = createMcpTools({ wallet: null, node: NODE })
      expect(tools.get_wallet_info().signerMode).toBe('unconfigured')
    })

    it('returns correct address from hsmConfig', () => {
      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      expect(tools.get_wallet_info().address).toBe(HSM_CONFIG.address)
    })

    it('returns configured:true when hsmConfig is set', () => {
      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      expect(tools.get_wallet_info().configured).toBe(true)
    })

    it('returns correct network from hsmConfig', () => {
      const tools = createMcpTools({ wallet: null, hsmConfig: HSM_CONFIG, node: NODE })
      expect(tools.get_wallet_info().network).toBe(HSM_CONFIG.network)
    })
  })
})
