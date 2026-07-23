/**
 * PaymentEngine unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PaymentEngine, InsufficientBalanceError } from '../payment-engine'
import { BlobBuilder } from '../blob-builder'
import type { OperationSpec } from '../blob-builder'
import { WalletSigner } from '../wallet'
import { BlobDecoder, BlobVerificationError } from '../blob-decoder'
import { FacilitatorPrepareClient } from '../facilitator/prepare-client'

vi.mock('../blob-decoder', () => ({
  BlobDecoder: {
    verify: vi.fn(),
    decode: vi.fn(),
  },
  BlobVerificationError: class BlobVerificationError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'BlobVerificationError'
    }
  },
}))

vi.mock('../facilitator/prepare-client', () => ({
  FacilitatorPrepareClient: {
    prepare: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// fetchNonce fixtures
// ---------------------------------------------------------------------------

const TEST_NODE    = { host: 'node.zetrix.com', port: '19943' }
const TEST_ADDRESS = 'ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6'

// ---------------------------------------------------------------------------
// pay() fixtures
// ---------------------------------------------------------------------------

const TEST_WALLET = {
  privateKey: 'privBtTEST',
  address:    'ZTESTaddress123',
  network:    'zetrix:testnet',
}

const CLIENT_REQ = {
  scheme:            'exact',
  network:           'zetrix:testnet',
  asset:             'ZTX',
  payTo:             'ZPAYTO123',
  maxAmountRequired: '1000000',
  extra: {
    gasModel: 'client' as const,
    gasPrice: '1000',
    feeLimit: '100000',
  },
}

const FACILITATOR_REQ = {
  scheme:            'exact',
  network:           'zetrix:testnet',
  asset:             'ZTP20CONTRACT',
  payTo:             'ZPAYTO123',
  maxAmountRequired: '5000000',
  extra: {
    gasModel:        'facilitator' as const,
    prepareEndpoint: 'https://facilitator.example.com/api/v1/facilitator',
    gasPrice:        '1000',
    feeLimit:        '100000',
  },
}

const MOCK_BLOB        = 'deadbeef1234'
const MOCK_SIGN_RESULT = { signBlob: 'sig123', publicKey: 'pub456' }
const MOCK_NONCE       = '42'
const MOCK_PREPARE     = {
  blob:             MOCK_BLOB,
  hash:             'hash999',
  blobId:           'BLOB-ID-001',
  paymasterAddress: 'ZPAYMASTER',
  validBefore:      Math.floor(Date.now() / 1000) + 3600,
}

function decodeHeader(b64: string) {
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

// ===========================================================================
// PaymentEngine.fetchNonce
// ===========================================================================

describe('PaymentEngine.fetchNonce', () => {
  let mockGetNonce: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetNonce = vi.fn()
    vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
      account: { getNonce: mockGetNonce },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful nonce fetch', () => {
    it('returns nonce+1 as string when SDK returns a number', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: 42 } })
      const nonce = await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      expect(nonce).toBe('43')
    })

    it('returns nonce+1 as string when SDK returns a string', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: '100' } })
      const nonce = await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      expect(nonce).toBe('101')
    })

    it('returns "1" for a new account with no outgoing transactions', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: '0' } })
      const nonce = await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      expect(nonce).toBe('1')
    })
  })

  describe('RPC error handling', () => {
    it('throws when SDK returns non-zero errorCode', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
      await expect(PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE))
        .rejects.toThrow('PaymentEngine.fetchNonce failed')
    })

    it('includes errorCode in the thrown message', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
      await expect(PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE))
        .rejects.toThrow('errorCode 4')
    })

    it('includes errorDesc in the thrown message', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
      await expect(PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE))
        .rejects.toThrow('ACCOUNT_NOT_EXIST')
    })

    it('throws with "unknown" when errorDesc is absent', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 99 })
      await expect(PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE))
        .rejects.toThrow('unknown')
    })

    it('propagates when SDK throws a network error', async () => {
      mockGetNonce.mockRejectedValue(new Error('ECONNREFUSED'))
      await expect(PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE))
        .rejects.toThrow('ECONNREFUSED')
    })
  })

  describe('SDK instantiation', () => {
    it('creates SDK with the provided host and port', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: '1' } })
      await PaymentEngine.fetchNonce(TEST_ADDRESS, { host: 'testnet.node.zetrix.com', port: '19943' })
      expect(PaymentEngine._createSdk).toHaveBeenCalledWith({
        host: 'testnet.node.zetrix.com',
        port: '19943',
      })
    })

    it('passes address to sdk.account.getNonce', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: '5' } })
      await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      expect(mockGetNonce).toHaveBeenCalledWith(TEST_ADDRESS)
    })

    it('creates a new SDK instance per call', async () => {
      mockGetNonce.mockResolvedValue({ errorCode: 0, result: { nonce: '1' } })
      await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      await PaymentEngine.fetchNonce(TEST_ADDRESS, TEST_NODE)
      expect(PaymentEngine._createSdk).toHaveBeenCalledTimes(2)
    })
  })
})

// ===========================================================================
// PaymentEngine.fetchAccountInfo
// ===========================================================================

describe('PaymentEngine.fetchAccountInfo', () => {
  let mockGetInfo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetInfo = vi.fn()
    vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
      account: { getInfo: mockGetInfo },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns balance string when errorCode is 0', async () => {
    mockGetInfo.mockResolvedValue({ errorCode: 0, result: { balance: '5000000000' } })
    const result = await PaymentEngine.fetchAccountInfo(TEST_ADDRESS, TEST_NODE)
    expect(result.balance).toBe('5000000000')
  })

  it('returns { balance: "0" } when errorCode is non-zero (account not found)', async () => {
    mockGetInfo.mockResolvedValue({ errorCode: 4 })
    const result = await PaymentEngine.fetchAccountInfo(TEST_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when result.balance is missing despite errorCode 0', async () => {
    mockGetInfo.mockResolvedValue({ errorCode: 0, result: {} })
    const result = await PaymentEngine.fetchAccountInfo(TEST_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('calls _createSdk with the provided node config', async () => {
    mockGetInfo.mockResolvedValue({ errorCode: 0, result: { balance: '1000' } })
    await PaymentEngine.fetchAccountInfo(TEST_ADDRESS, TEST_NODE)
    expect(PaymentEngine._createSdk).toHaveBeenCalledWith(TEST_NODE)
  })

  it('passes address to sdk.account.getInfo', async () => {
    mockGetInfo.mockResolvedValue({ errorCode: 0, result: { balance: '1000' } })
    await PaymentEngine.fetchAccountInfo(TEST_ADDRESS, TEST_NODE)
    expect(mockGetInfo).toHaveBeenCalledWith(TEST_ADDRESS)
  })
})

// ===========================================================================
// InsufficientBalanceError
// ===========================================================================

describe('InsufficientBalanceError', () => {
  it('is an instance of Error', () => {
    const err = new InsufficientBalanceError('msg', '1000', '500', 'ZTX')
    expect(err).toBeInstanceOf(Error)
  })

  it('name is "InsufficientBalanceError"', () => {
    const err = new InsufficientBalanceError('msg', '1000', '500', 'ZTX')
    expect(err.name).toBe('InsufficientBalanceError')
  })

  it('exposes required, available, asset as public readonly fields', () => {
    const err = new InsufficientBalanceError('msg', '9999', '100', 'ZTP20CONTRACT')
    expect(err.required).toBe('9999')
    expect(err.available).toBe('100')
    expect(err.asset).toBe('ZTP20CONTRACT')
  })

  it('message is passed to Error super()', () => {
    const err = new InsufficientBalanceError('Insufficient ZTX: required 1000, available 500', '1000', '500', 'ZTX')
    expect(err.message).toBe('Insufficient ZTX: required 1000, available 500')
  })

  it('instanceof check works correctly when caught as Error (APP-L02)', () => {
    let caught: Error | undefined
    try {
      throw new InsufficientBalanceError('msg', '1000', '500', 'ZTX')
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(InsufficientBalanceError)
  })
})

// ===========================================================================
// PaymentEngine.fetchZTP20Balance
// ===========================================================================

describe('PaymentEngine.fetchZTP20Balance', () => {
  const CONTRACT_ADDRESS = 'ZTP20CONTRACT123'
  const HOLDER_ADDRESS   = 'ZHOLDER456'
  let mockContractCall: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContractCall = vi.fn()
    vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
      contract: { call: mockContractCall },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns balance string when contract query returns valid { balance: "nnn" }', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: { value: '{"balance":"5000000"}' } }] },
    })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result.balance).toBe('5000000')
  })

  it('returns { balance: "0" } when errorCode is non-zero (contract call fails)', async () => {
    mockContractCall.mockResolvedValue({ errorCode: 4 })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when query_rets is empty array', async () => {
    mockContractCall.mockResolvedValue({ errorCode: 0, result: { query_rets: [] } })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when query_rets is undefined', async () => {
    mockContractCall.mockResolvedValue({ errorCode: 0, result: {} })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when result.result is undefined', async () => {
    mockContractCall.mockResolvedValue({ errorCode: 0 })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when value is undefined for the first query_ret', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: {} }] },
    })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('propagates network error from sdk.contract.call (does not swallow)', async () => {
    mockContractCall.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    ).rejects.toThrow('ECONNREFUSED')
  })

  it('returns { balance: "0" } when JSON.parse of value throws (malformed response)', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: { value: 'not-valid-json' } }] },
    })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('returns { balance: "0" } when parsed value has no balance field', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: { value: '{"amount":"9999"}' } }] },
    })
    const result = await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(result).toEqual({ balance: '0' })
  })

  it('calls sdk.contract.call with contractAddress, optType:2, and JSON-serialised balanceOf input', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: { value: '{"balance":"1"}' } }] },
    })
    await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    expect(mockContractCall).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: CONTRACT_ADDRESS,
        optType:         2,
      })
    )
  })

  it('passes { method: "balanceOf", params: { address } } as the contract input', async () => {
    mockContractCall.mockResolvedValue({
      errorCode: 0,
      result: { query_rets: [{ result: { value: '{"balance":"1"}' } }] },
    })
    await PaymentEngine.fetchZTP20Balance(CONTRACT_ADDRESS, HOLDER_ADDRESS, TEST_NODE)
    const callArg = mockContractCall.mock.calls[0][0]
    expect(JSON.parse(callArg.input)).toEqual({
      method: 'balanceOf',
      params: { address: HOLDER_ADDRESS },
    })
  })
})

// ===========================================================================
// PaymentEngine.checkBalance
// ===========================================================================

describe('PaymentEngine.checkBalance — gasModel:client, ZTX', () => {
  beforeEach(() => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '9999999' })
    vi.spyOn(PaymentEngine, 'fetchZTP20Balance').mockResolvedValue({ balance: '0' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const ZTX_CLIENT_REQ = {
    scheme: 'exact', network: 'zetrix:testnet', asset: 'ZTX',
    payTo: 'ZPAYTO123', maxAmountRequired: '1000000',
    extra: { gasModel: 'client' as const },
  }

  it('resolves when ZTX balance >= amount + feeLimit', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '1200000' })
    await expect(
      PaymentEngine.checkBalance(ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    ).resolves.toBeUndefined()
  })

  it('throws InsufficientBalanceError when ZTX balance < amount + feeLimit', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '500000' })
    await expect(
      PaymentEngine.checkBalance(ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    ).rejects.toThrow(InsufficientBalanceError)
  })

  it('resolves when maxAmountRequired is "0" (free resource, no cost)', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '50000' })
    const freeReq = { ...ZTX_CLIENT_REQ, maxAmountRequired: '0' }
    await expect(
      PaymentEngine.checkBalance(freeReq, TEST_WALLET, TEST_NODE, '0')
    ).resolves.toBeUndefined()
  })

  it('resolves when feeLimit is "0" even if ZTX balance is also "0" (no cost)', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '0' })
    const freeReq = { ...ZTX_CLIENT_REQ, maxAmountRequired: '0' }
    await expect(
      PaymentEngine.checkBalance(freeReq, TEST_WALLET, TEST_NODE, '0')
    ).resolves.toBeUndefined()
  })

  it('error.required === String(BigInt(amount) + BigInt(feeLimit))', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '500000' })
    const err = await PaymentEngine.checkBalance(
      ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.required).toBe(String(BigInt('1000000') + BigInt('100000')))
  })

  it('error.available === fetched ZTX balance', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '500000' })
    const err = await PaymentEngine.checkBalance(
      ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.available).toBe('500000')
  })

  it('error.asset === "ZTX"', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '500000' })
    const err = await PaymentEngine.checkBalance(
      ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.asset).toBe('ZTX')
  })

  it('does NOT call fetchZTP20Balance for ZTX asset', async () => {
    await PaymentEngine.checkBalance(ZTX_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000').catch(() => {})
    expect(PaymentEngine.fetchZTP20Balance).not.toHaveBeenCalled()
  })

  it('throws Error when req.asset is empty string (APP-L01)', async () => {
    const emptyAssetReq = { ...ZTX_CLIENT_REQ, asset: '' }
    await expect(
      PaymentEngine.checkBalance(emptyAssetReq, TEST_WALLET, TEST_NODE, '0')
    ).rejects.toThrow('checkBalance: req.asset must not be empty')
  })
})

describe('PaymentEngine.checkBalance — gasModel:client, ZTP20', () => {
  const ZTP20_CLIENT_REQ = {
    scheme: 'exact', network: 'zetrix:testnet', asset: 'ZTP20CONTRACT',
    payTo: 'ZPAYTO123', maxAmountRequired: '5000000',
    extra: { gasModel: 'client' as const },
  }

  beforeEach(() => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '9999999' })
    vi.spyOn(PaymentEngine, 'fetchZTP20Balance').mockResolvedValue({ balance: '9999999' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves when token balance >= amount AND ZTX balance >= feeLimit', async () => {
    await expect(
      PaymentEngine.checkBalance(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    ).resolves.toBeUndefined()
  })

  it('throws InsufficientBalanceError when token balance < amount', async () => {
    vi.spyOn(PaymentEngine, 'fetchZTP20Balance').mockResolvedValue({ balance: '100000' })
    await expect(
      PaymentEngine.checkBalance(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    ).rejects.toThrow(InsufficientBalanceError)
  })

  it('throws InsufficientBalanceError when ZTX balance < feeLimit (token ok)', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '50000' })
    await expect(
      PaymentEngine.checkBalance(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    ).rejects.toThrow(InsufficientBalanceError)
  })

  it('ZTP20 check runs before ZTX fee check (token error wins when both insufficient)', async () => {
    vi.spyOn(PaymentEngine, 'fetchZTP20Balance').mockResolvedValue({ balance: '100000' })
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '0' })
    const err = await PaymentEngine.checkBalance(
      ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.asset).toBe('ZTP20CONTRACT')
  })

  it('error.asset is the contract address when token is insufficient', async () => {
    vi.spyOn(PaymentEngine, 'fetchZTP20Balance').mockResolvedValue({ balance: '100000' })
    const err = await PaymentEngine.checkBalance(
      ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.asset).toBe('ZTP20CONTRACT')
  })

  it('error.asset is "ZTX" when only gas is insufficient', async () => {
    vi.spyOn(PaymentEngine, 'fetchAccountInfo').mockResolvedValue({ balance: '0' })
    const err = await PaymentEngine.checkBalance(
      ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000'
    ).catch((e: unknown) => e) as InsufficientBalanceError
    expect(err.asset).toBe('ZTX')
  })

  it('calls fetchZTP20Balance(asset, wallet.address, node)', async () => {
    await PaymentEngine.checkBalance(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    expect(PaymentEngine.fetchZTP20Balance).toHaveBeenCalledWith('ZTP20CONTRACT', TEST_WALLET.address, TEST_NODE)
  })

  it('calls fetchAccountInfo for the ZTX fee check', async () => {
    await PaymentEngine.checkBalance(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, '100000')
    expect(PaymentEngine.fetchAccountInfo).toHaveBeenCalledWith(TEST_WALLET.address, TEST_NODE)
  })

  it('resolves when maxAmountRequired is "0" (no token needed)', async () => {
    const freeReq = { ...ZTP20_CLIENT_REQ, maxAmountRequired: '0' }
    await expect(
      PaymentEngine.checkBalance(freeReq, TEST_WALLET, TEST_NODE, '100000')
    ).resolves.toBeUndefined()
  })
})

// ===========================================================================
// PaymentEngine.estimateFee
// ===========================================================================

const MOCK_OPERATION: OperationSpec = {
  type: 'payCoin',
  data: { destAddress: 'ZPAYTO123', gasAmount: '1000000' },
}

describe('PaymentEngine.estimateFee', () => {
  let mockEvaluateFee: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockEvaluateFee = vi.fn()
    vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
      transaction: { evaluateFee: mockEvaluateFee },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns feeLimit and gasPrice as strings on success', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 0, result: { feeLimit: 150000, gasPrice: 1000 } })
    const result = await PaymentEngine.estimateFee(
      { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
      TEST_NODE,
    )
    expect(result.feeLimit).toBe('150000')
    expect(result.gasPrice).toBe('1000')
  })

  it('coerces numeric feeLimit/gasPrice to strings', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 0, result: { feeLimit: 200000, gasPrice: 2000 } })
    const result = await PaymentEngine.estimateFee(
      { sourceAddress: TEST_ADDRESS, nonce: '5', operation: MOCK_OPERATION },
      TEST_NODE,
    )
    expect(typeof result.feeLimit).toBe('string')
    expect(typeof result.gasPrice).toBe('string')
  })

  it('throws with errorCode and errorDesc on non-zero errorCode', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('PaymentEngine.estimateFee failed')
  })

  it('includes errorCode in thrown message', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('errorCode 4')
  })

  it('includes errorDesc in thrown message', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 4, errorDesc: 'ACCOUNT_NOT_EXIST' })
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('ACCOUNT_NOT_EXIST')
  })

  it('throws with "unknown" when errorDesc is absent', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 99 })
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('unknown')
  })

  it('calls _createSdk with the provided node config', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 0, result: { feeLimit: 100000, gasPrice: 1000 } })
    await PaymentEngine.estimateFee(
      { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
      TEST_NODE,
    )
    expect(PaymentEngine._createSdk).toHaveBeenCalledWith(TEST_NODE)
  })

  it('passes signtureNumber "1" and the provided operation to evaluateFee', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 0, result: { feeLimit: 100000, gasPrice: 1000 } })
    await PaymentEngine.estimateFee(
      { sourceAddress: TEST_ADDRESS, nonce: '3', operation: MOCK_OPERATION },
      TEST_NODE,
    )
    expect(mockEvaluateFee).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAddress:  TEST_ADDRESS,
        nonce:          '3',
        operations:     [MOCK_OPERATION],
        signtureNumber: '1',
      })
    )
  })

  it('throws when errorCode is 0 but result is undefined (SDK contract violation)', async () => {
    mockEvaluateFee.mockResolvedValue({ errorCode: 0, result: undefined })
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('SDK returned errorCode 0 but result is empty')
  })

  it('propagates when sdk.transaction.evaluateFee throws', async () => {
    mockEvaluateFee.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      PaymentEngine.estimateFee(
        { sourceAddress: TEST_ADDRESS, nonce: '1', operation: MOCK_OPERATION },
        TEST_NODE,
      )
    ).rejects.toThrow('ECONNREFUSED')
  })
})

// ===========================================================================
// PaymentEngine.pay
// ===========================================================================

describe('PaymentEngine.pay', () => {
  const MOCK_ESTIMATE = { feeLimit: '150000', gasPrice: '1000' }

  beforeEach(() => {
    vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
      account: { getNonce: vi.fn().mockResolvedValue({ errorCode: 0, result: { nonce: MOCK_NONCE } }) },
    })
    vi.spyOn(PaymentEngine, 'estimateFee').mockResolvedValue(MOCK_ESTIMATE)
    vi.spyOn(PaymentEngine, 'checkBalance').mockResolvedValue(undefined)
    vi.spyOn(BlobBuilder, 'build').mockReturnValue({ blob: MOCK_BLOB })
    vi.spyOn(BlobBuilder, 'buildOperation').mockReturnValue({
      type: 'payCoin',
      data: { destAddress: 'ZPAYTO123', gasAmount: '1000000' },
    })
    vi.spyOn(WalletSigner, 'sign').mockReturnValue(MOCK_SIGN_RESULT)
    vi.mocked(FacilitatorPrepareClient.prepare).mockResolvedValue(MOCK_PREPARE)
    vi.mocked(BlobDecoder.verify).mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. gasModel:client — ZTX self-pay
  // -------------------------------------------------------------------------
  describe('gasModel:client — ZTX self-pay', () => {
    it('returns a valid base64-encoded JSON string', async () => {
      const result = await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(typeof result).toBe('string')
      expect(() => decodeHeader(result)).not.toThrow()
    })

    it('header has x402Version:2, scheme:exact, and correct network', async () => {
      const header = decodeHeader(await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
      expect(header.x402Version).toBe(2)
      expect(header.scheme).toBe('exact')
      expect(header.network).toBe('zetrix:testnet')
    })

    it('payload type is signed_transaction', async () => {
      const header = decodeHeader(await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.type).toBe('signed_transaction')
    })

    it('payload contains transactionBlob from BlobBuilder', async () => {
      const header = decodeHeader(await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.transactionBlob).toBe(MOCK_BLOB)
    })

    it('payload signatures use sign_data / public_key keys (Zetrix protocol format)', async () => {
      const header = decodeHeader(await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.signatures).toHaveLength(1)
      expect(header.payload.signatures[0].sign_data).toBe(MOCK_SIGN_RESULT.signBlob)
      expect(header.payload.signatures[0].public_key).toBe(MOCK_SIGN_RESULT.publicKey)
    })

    it('payload has validBefore set in the future', async () => {
      const now = Math.floor(Date.now() / 1000)
      const header = decodeHeader(await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.validBefore).toBeGreaterThan(now)
    })

    it('uses custom validBeforeOffset when provided via options', async () => {
      const before = Math.floor(Date.now() / 1000)
      const header = decodeHeader(
        await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE, { validBeforeOffset: 600 })
      )
      expect(header.payload.validBefore).toBeGreaterThanOrEqual(before + 600)
      expect(header.payload.validBefore).toBeLessThanOrEqual(before + 601)
    })

    it('fetches nonce using wallet address and provided node', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine._createSdk).toHaveBeenCalledWith(TEST_NODE)
    })

    it('calls BlobBuilder.build with correct params including fetched nonce+1', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(BlobBuilder.build).toHaveBeenCalledWith({
        asset:         'ZTX',
        payTo:         'ZPAYTO123',
        amount:        '1000000',
        clientAddress: TEST_WALLET.address,
        nonce:         String(BigInt(MOCK_NONCE) + 1n),
        gasPrice:      MOCK_ESTIMATE.gasPrice,
        feeLimit:      MOCK_ESTIMATE.feeLimit,
      })
    })

    it('always calls estimateFee regardless of extra.gasPrice/feeLimit (APP-L01)', async () => {
      const reqNoGas = {
        ...CLIENT_REQ,
        extra: { gasModel: 'client' as const },
      }
      await PaymentEngine.pay(reqNoGas, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.estimateFee).toHaveBeenCalled()
      expect(BlobBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({ gasPrice: MOCK_ESTIMATE.gasPrice, feeLimit: MOCK_ESTIMATE.feeLimit })
      )
    })

    it('calls BlobBuilder.buildOperation with asset, payTo, amount, clientAddress', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(BlobBuilder.buildOperation).toHaveBeenCalledWith(
        'ZTX', 'ZPAYTO123', '1000000', TEST_WALLET.address,
      )
    })

    it('calls estimateFee with operation from buildOperation and fetched nonce', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.estimateFee).toHaveBeenCalledWith(
        {
          sourceAddress: TEST_WALLET.address,
          nonce:         String(BigInt(MOCK_NONCE) + 1n),
          operation:     { type: 'payCoin', data: { destAddress: 'ZPAYTO123', gasAmount: '1000000' } },
        },
        TEST_NODE,
      )
    })

    it('propagates error when estimateFee throws', async () => {
      vi.spyOn(PaymentEngine, 'estimateFee').mockRejectedValue(new Error('fee estimation failed'))
      await expect(PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('fee estimation failed')
    })

    it('calls WalletSigner.sign with built blob and private key', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(WalletSigner.sign).toHaveBeenCalledWith(MOCK_BLOB, TEST_WALLET.privateKey)
    })

    it('does NOT call FacilitatorPrepareClient for client mode', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(FacilitatorPrepareClient.prepare).not.toHaveBeenCalled()
    })

    it('propagates error when fetchNonce throws', async () => {
      vi.spyOn(PaymentEngine, '_createSdk').mockReturnValue({
        account: { getNonce: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      })
      await expect(PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('ECONNREFUSED')
    })

    it('propagates error when BlobBuilder.build throws', async () => {
      vi.spyOn(BlobBuilder, 'build').mockImplementation(() => { throw new Error('invalid nonce') })
      await expect(PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('invalid nonce')
    })
  })

  // -------------------------------------------------------------------------
  // pay() — client path balance check
  // -------------------------------------------------------------------------
  describe('pay() — client path balance check', () => {
    it('calls checkBalance after estimateFee with the estimated feeLimit (APP-M02)', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.checkBalance).toHaveBeenCalledWith(
        CLIENT_REQ, TEST_WALLET, TEST_NODE, MOCK_ESTIMATE.feeLimit, { skipTokenCheck: false }
      )
    })

    it('throws InsufficientBalanceError when checkBalance throws (propagates)', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(
        new InsufficientBalanceError('Insufficient ZTX', '1100000', '500000', 'ZTX')
      )
      await expect(PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow(InsufficientBalanceError)
    })

    it('does NOT call BlobBuilder.build when checkBalance throws', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(new Error('balance error'))
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(BlobBuilder.build).not.toHaveBeenCalled()
    })

    it('does NOT call WalletSigner.sign when checkBalance throws', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(new Error('balance error'))
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(WalletSigner.sign).not.toHaveBeenCalled()
    })

    it('does NOT call checkBalance when estimateFee throws (error propagates before balance check)', async () => {
      vi.spyOn(PaymentEngine, 'estimateFee').mockRejectedValue(new Error('fee error'))
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(PaymentEngine.checkBalance).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // pay() — ZTP20 pre-check before estimateFee
  // -------------------------------------------------------------------------
  describe('pay() — ZTP20 pre-check before estimateFee', () => {
    const ZTP20_CLIENT_REQ = { ...CLIENT_REQ, asset: 'ZTP20CONTRACT' }

    it('calls checkBalance with "0" before estimateFee for ZTP20 asset', async () => {
      const callOrder: string[] = []
      vi.spyOn(PaymentEngine, 'checkBalance').mockImplementation(
        async (_req, _wallet, _node, feeLimit) => { callOrder.push(`checkBalance:${feeLimit}`) }
      )
      vi.spyOn(PaymentEngine, 'estimateFee').mockImplementation(async () => {
        callOrder.push('estimateFee')
        return MOCK_ESTIMATE
      })
      await PaymentEngine.pay(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE)
      const preIdx  = callOrder.indexOf(`checkBalance:0`)
      const feeIdx  = callOrder.indexOf('estimateFee')
      expect(preIdx).toBeGreaterThanOrEqual(0)
      expect(preIdx).toBeLessThan(feeIdx)
    })

    it('does NOT call estimateFee when ZTP20 pre-check throws InsufficientBalanceError', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(
        new InsufficientBalanceError('Insufficient tokens', '5000', '1000', 'ZTP20CONTRACT')
      )
      await PaymentEngine.pay(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(PaymentEngine.estimateFee).not.toHaveBeenCalled()
    })

    it('propagates InsufficientBalanceError from ZTP20 pre-check', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(
        new InsufficientBalanceError('Insufficient tokens', '5000', '1000', 'ZTP20CONTRACT')
      )
      await expect(PaymentEngine.pay(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow(InsufficientBalanceError)
    })

    // APP-M04 — AC3: ZTX gas shortfall with ZTP20 client payment
    it('throws InsufficientBalanceError with asset ZTX when ZTX gas is insufficient after fee estimate (APP-M04 AC3)', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance')
        .mockResolvedValueOnce(undefined) // pre-check: token ok
        .mockRejectedValueOnce(
          new InsufficientBalanceError('Insufficient ZTX for gas', '150000', '0', 'ZTX')
        )
      const err = await PaymentEngine.pay(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE).catch(e => e) as InsufficientBalanceError
      expect(err).toBeInstanceOf(InsufficientBalanceError)
      expect(err.asset).toBe('ZTX')
      expect(err.required).toBe('150000')
    })

    it('calls post-fee checkBalance with skipTokenCheck:true for ZTP20 asset (APP-M02)', async () => {
      await PaymentEngine.pay(ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.checkBalance).toHaveBeenLastCalledWith(
        ZTP20_CLIENT_REQ, TEST_WALLET, TEST_NODE, MOCK_ESTIMATE.feeLimit, { skipTokenCheck: true }
      )
    })

    it('does NOT call extra checkBalance for ZTX asset (only one call after estimateFee)', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.checkBalance).toHaveBeenCalledTimes(1)
      expect(PaymentEngine.checkBalance).toHaveBeenCalledWith(
        CLIENT_REQ, TEST_WALLET, TEST_NODE, MOCK_ESTIMATE.feeLimit, { skipTokenCheck: false }
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. gasModel:facilitator — sponsored ZTP20
  // -------------------------------------------------------------------------
  describe('gasModel:facilitator — sponsored ZTP20', () => {
    it('returns a valid base64-encoded JSON string', async () => {
      const result = await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(typeof result).toBe('string')
      expect(() => decodeHeader(result)).not.toThrow()
    })

    it('payload type is facilitator_prepared', async () => {
      const header = decodeHeader(await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.type).toBe('facilitator_prepared')
    })

    it('payload contains blobId, blob, hash, and validBefore from prepare response', async () => {
      const header = decodeHeader(await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.blobId).toBe(MOCK_PREPARE.blobId)
      expect(header.payload.blob).toBe(MOCK_PREPARE.blob)
      expect(header.payload.hash).toBe(MOCK_PREPARE.hash)
      expect(header.payload.validBefore).toBe(MOCK_PREPARE.validBefore)
    })

    it('payload clientSignature has signBlob and publicKey', async () => {
      const header = decodeHeader(await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
      expect(header.payload.clientSignature.signBlob).toBe(MOCK_SIGN_RESULT.signBlob)
      expect(header.payload.clientSignature.publicKey).toBe(MOCK_SIGN_RESULT.publicKey)
    })

    it('calls FacilitatorPrepareClient.prepare with correct params and endpoint', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(FacilitatorPrepareClient.prepare).toHaveBeenCalledWith(
        {
          clientAddress: TEST_WALLET.address,
          payTo:         'ZPAYTO123',
          amount:        '5000000',
          asset:         'ZTP20CONTRACT',
          network:       'zetrix:testnet',
        },
        FACILITATOR_REQ.extra.prepareEndpoint,
      )
    })

    it('calls BlobDecoder.verify as security gate before signing', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(BlobDecoder.verify).toHaveBeenCalledWith(
        MOCK_PREPARE.blob,
        'ZPAYTO123',
        '5000000',
      )
    })

    it('calls WalletSigner.sign with the Paymaster blob and private key', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(WalletSigner.sign).toHaveBeenCalledWith(MOCK_PREPARE.blob, TEST_WALLET.privateKey)
    })

    it('does NOT call BlobBuilder.build for facilitator mode', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(BlobBuilder.build).not.toHaveBeenCalled()
    })

    it('does NOT call fetchNonce for facilitator mode', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine._createSdk).not.toHaveBeenCalled()
    })

    it('does NOT call estimateFee for facilitator mode', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.estimateFee).not.toHaveBeenCalled()
    })

    it('propagates error when FacilitatorPrepareClient.prepare throws', async () => {
      vi.mocked(FacilitatorPrepareClient.prepare).mockRejectedValue(new Error('prepare failed'))
      await expect(PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('prepare failed')
    })

    it('propagates BlobVerificationError when blob has been tampered', async () => {
      vi.mocked(BlobDecoder.verify).mockImplementation(() => {
        throw new BlobVerificationError('payTo mismatch')
      })
      await expect(PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('payTo mismatch')
    })
  })

  // -------------------------------------------------------------------------
  // pay() — facilitator path balance check
  // -------------------------------------------------------------------------
  describe('pay() — facilitator path balance check', () => {
    it('calls checkBalance with feeLimit "0" after BlobDecoder.verify', async () => {
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)
      expect(PaymentEngine.checkBalance).toHaveBeenCalledWith(
        FACILITATOR_REQ, TEST_WALLET, TEST_NODE, '0'
      )
    })

    it('throws InsufficientBalanceError when ZTP20 balance is insufficient', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(
        new InsufficientBalanceError('Insufficient ZTP20', '5000000', '100000', 'ZTP20CONTRACT')
      )
      await expect(PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE))
        .rejects.toThrow(InsufficientBalanceError)
    })

    it('does NOT call WalletSigner.sign when checkBalance throws', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockRejectedValue(new Error('balance error'))
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(WalletSigner.sign).not.toHaveBeenCalled()
    })

    it('does NOT throw when wallet ZTX balance is "0" and ZTP20 balance is sufficient (sponsored gas)', async () => {
      vi.spyOn(PaymentEngine, 'checkBalance').mockResolvedValue(undefined)
      await expect(PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE)).resolves.toBeDefined()
    })

    it('does NOT call checkBalance when BlobDecoder.verify throws (error propagates before balance check)', async () => {
      vi.mocked(BlobDecoder.verify).mockImplementation(() => { throw new Error('tampered blob') })
      vi.spyOn(PaymentEngine, 'checkBalance').mockResolvedValue(undefined)
      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE).catch(() => {})
      expect(PaymentEngine.checkBalance).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 3. AC: all 3 valid gasModel×asset combinations
  //    Valid: ZTX+client, ZTP20+facilitator, ZTP20+client
  //    Invalid: ZTX+facilitator (native ZTX cannot use Paymaster)
  // -------------------------------------------------------------------------
  describe('valid gasModel×asset combinations', () => {
    it('ZTP20 + gasModel:client — payload type is signed_transaction', async () => {
      const ztp20ClientReq = { ...CLIENT_REQ, asset: 'ZTP20CONTRACT' }
      const header = decodeHeader(await PaymentEngine.pay(ztp20ClientReq, TEST_WALLET, TEST_NODE))
      expect(header.payload.type).toBe('signed_transaction')
    })

    it('ZTX + gasModel:facilitator — throws (invalid combination)', async () => {
      const ztxFacilitatorReq = { ...FACILITATOR_REQ, asset: 'ZTX' }
      await expect(PaymentEngine.pay(ztxFacilitatorReq, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('native ZTX asset requires gasModel:client')
    })
  })

  // -------------------------------------------------------------------------
  // 4. prepareEndpoint guard (APP-M01)
  // -------------------------------------------------------------------------
  describe('prepareEndpoint guard', () => {
    it('throws a descriptive error when gasModel:facilitator but prepareEndpoint is missing', async () => {
      const noEndpointReq = {
        ...FACILITATOR_REQ,
        extra: { gasModel: 'facilitator' as const, gasPrice: '1000', feeLimit: '100000' },
      }
      await expect(PaymentEngine.pay(noEndpointReq, TEST_WALLET, TEST_NODE))
        .rejects.toThrow('requires extra.prepareEndpoint')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Unknown gasModel
  // -------------------------------------------------------------------------
  describe('unknown gasModel', () => {
    it('throws for an unsupported gasModel value', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const badReq = { ...CLIENT_REQ, extra: { ...CLIENT_REQ.extra, gasModel: 'unknown' as any } }
      await expect(PaymentEngine.pay(badReq, TEST_WALLET, TEST_NODE))
        .rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Custom signerFn
  // -------------------------------------------------------------------------
  describe('pay() — custom signerFn', () => {
    it('calls signerFn with the blob instead of WalletSigner.sign for gasModel:client', async () => {
      const customSigner = vi.fn().mockResolvedValue({ signBlob: 'hsm-sig', publicKey: 'hsm-pub' })

      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE, {}, customSigner)

      expect(customSigner).toHaveBeenCalledWith(MOCK_BLOB)
      expect(WalletSigner.sign).not.toHaveBeenCalled()
    })

    it('uses signBlob and publicKey from signerFn in the header for gasModel:client', async () => {
      const customSigner = vi.fn().mockResolvedValue({ signBlob: 'hsm-sig', publicKey: 'hsm-pub' })

      const result = await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE, {}, customSigner)
      const header = decodeHeader(result)

      expect(header.payload.signatures[0].sign_data).toBe('hsm-sig')
      expect(header.payload.signatures[0].public_key).toBe('hsm-pub')
    })

    it('calls signerFn with the prepare blob instead of WalletSigner.sign for gasModel:facilitator', async () => {
      const customSigner = vi.fn().mockResolvedValue({ signBlob: 'hsm-fac-sig', publicKey: 'hsm-fac-pub' })

      await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE, {}, customSigner)

      expect(customSigner).toHaveBeenCalledWith(MOCK_BLOB)
      expect(WalletSigner.sign).not.toHaveBeenCalled()
    })

    it('uses signBlob and publicKey from signerFn in clientSignature for gasModel:facilitator', async () => {
      const customSigner = vi.fn().mockResolvedValue({ signBlob: 'hsm-fac-sig', publicKey: 'hsm-fac-pub' })

      const result = await PaymentEngine.pay(FACILITATOR_REQ, TEST_WALLET, TEST_NODE, {}, customSigner)
      const header = decodeHeader(result)

      expect(header.payload.clientSignature.signBlob).toBe('hsm-fac-sig')
      expect(header.payload.clientSignature.publicKey).toBe('hsm-fac-pub')
    })

    it('propagates error when signerFn throws', async () => {
      const failingSigner = vi.fn().mockRejectedValue(new Error('HSM signing failed'))

      await expect(
        PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE, {}, failingSigner)
      ).rejects.toThrow('HSM signing failed')
    })

    it('still calls WalletSigner.sign when no signerFn is provided (backward compatibility)', async () => {
      await PaymentEngine.pay(CLIENT_REQ, TEST_WALLET, TEST_NODE)
      expect(WalletSigner.sign).toHaveBeenCalledWith(MOCK_BLOB, TEST_WALLET.privateKey)
    })
  })
})
