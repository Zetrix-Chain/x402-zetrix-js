/**
 * BlobDecoder unit tests
 *
 * BlobDecoder.decode() / .verify():
 *   Two blob shapes:
 *     payCoin (ZTX)       → payTo = payCoin.destAddress, amount = payCoin.amount
 *     payCoin + input     → ZTP20: payTo/amount from input JSON transfer params
 *   verify() is the security gate — aborts payment if Paymaster tampered with blob.
 */

import { describe, it, expect } from 'vitest'
import { BlobDecoder, BlobVerificationError } from '../blob-decoder'

// ---------------------------------------------------------------------------
// Fixtures — deterministic blobs built with BlobBuilder (blob-builder.ts)
// Source address: ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6, nonce 42
// ---------------------------------------------------------------------------

/** payCoin (ZTX) blob — payTo=ADDR, amount=1000000 */
const PAY_COIN_BLOB =
  '0a255a54583364565a77456a7a48464a434e774e774d576736387259346f434177717373675836' +
  '102a222f0807622b0a255a54583364565a77456a7a48464a434e774e774d576736387259346f43' +
  '417771737367583610c0843d3080897a38e807'

/** contractInvokeByGas (ZTP20) blob — payTo=ADDR, amount=5000000 */
const CONTRACT_BLOB =
  '0a255a54583364565a77456a7a48464a434e774e774d576736387259346f434177717373675836' +
  '102a2290010807628b010a255a54583364565a77456a7a48464a434e774e774d576736387259346f' +
  '43417771737367583610001a607b226d6574686f64223a227472616e73666572222c22706172616d' +
  '73223a7b22746f223a225a54583364565a77456a7a48464a434e774e774d576736387259346f4341' +
  '7771737367583622'  +
  '2c22616d6f756e74223a2235303030303030227d7d3080897a38e807'

const ADDR = 'ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6'

// Build a ZTP20 blob with malformed input (no params) to test APP-M01 null-check
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _testSdk = new (require('zetrix-sdk-nodejs'))({ host: 'zetrix.com', port: '19943' })
function buildMalformedInputBlob(input: string) {
  const r = _testSdk.transaction.buildBlob({
    sourceAddress: ADDR,
    nonce: '42',
    gasPrice: '1000',
    feeLimit: '100000',
    operations: [{ type: 'contractInvokeByGas', data: { contractAddress: 'Z9xKtest', gasAmount: '0', input } }],
  })
  return r.result.transactionBlob
}

// ---------------------------------------------------------------------------
// decode()
// ---------------------------------------------------------------------------

describe('BlobDecoder.decode', () => {
  describe('payCoin (ZTX) blob', () => {
    it('returns payTo and amount', () => {
      const result = BlobDecoder.decode(PAY_COIN_BLOB)
      expect(result).toHaveProperty('payTo')
      expect(result).toHaveProperty('amount')
    })

    it('extracts payTo from payCoin.destAddress', () => {
      expect(BlobDecoder.decode(PAY_COIN_BLOB).payTo).toBe(ADDR)
    })

    it('extracts amount from payCoin.amount', () => {
      expect(BlobDecoder.decode(PAY_COIN_BLOB).amount).toBe('1000000')
    })
  })

  describe('contractInvokeByGas (ZTP20) blob', () => {
    it('returns payTo and amount', () => {
      const result = BlobDecoder.decode(CONTRACT_BLOB)
      expect(result).toHaveProperty('payTo')
      expect(result).toHaveProperty('amount')
    })

    it('extracts payTo from input JSON params.to', () => {
      expect(BlobDecoder.decode(CONTRACT_BLOB).payTo).toBe(ADDR)
    })

    it('extracts amount from input JSON params.amount (legacy field)', () => {
      expect(BlobDecoder.decode(CONTRACT_BLOB).amount).toBe('5000000')
    })
  })

  describe('contractInvokeByGas (ZTP20) blob — params.value (Facilitator format)', () => {
    it('extracts amount from params.value (Facilitator-format blob)', () => {
      const blob = buildMalformedInputBlob(
        JSON.stringify({ method: 'transfer', params: { to: ADDR, value: '7000000' } })
      )
      const result = BlobDecoder.decode(blob)
      expect(result.payTo).toBe(ADDR)
      expect(result.amount).toBe('7000000')
    })

    it('prefers params.value over params.amount when both are present', () => {
      const blob = buildMalformedInputBlob(
        JSON.stringify({ method: 'transfer', params: { to: ADDR, value: '7000000', amount: '9999999' } })
      )
      expect(BlobDecoder.decode(blob).amount).toBe('7000000')
    })
  })

  describe('ZTP20 blob with malformed input JSON (APP-M01)', () => {
    it('throws descriptively when params field is missing from input JSON', () => {
      const blob = buildMalformedInputBlob(JSON.stringify({ method: 'transfer' }))
      expect(() => BlobDecoder.decode(blob))
        .toThrow('missing params.to or params.value in payCoin.input')
    })

    it('throws descriptively when params.to is missing', () => {
      const blob = buildMalformedInputBlob(JSON.stringify({ method: 'transfer', params: { value: '1000' } }))
      expect(() => BlobDecoder.decode(blob))
        .toThrow('missing params.to or params.value in payCoin.input')
    })

    it('throws descriptively when params.value (and params.amount) is missing', () => {
      const blob = buildMalformedInputBlob(JSON.stringify({ method: 'transfer', params: { to: ADDR } }))
      expect(() => BlobDecoder.decode(blob))
        .toThrow('missing params.to or params.value in payCoin.input')
    })
  })

  describe('error handling', () => {
    it('throws on empty blob string', () => {
      expect(() => BlobDecoder.decode('')).toThrow()
    })

    it('throws on non-hex garbage', () => {
      expect(() => BlobDecoder.decode('not-hex')).toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// verify()
// ---------------------------------------------------------------------------

describe('BlobDecoder.verify', () => {
  describe('payCoin (ZTX) — matching values', () => {
    it('does not throw when payTo and amount match', () => {
      expect(() => BlobDecoder.verify(PAY_COIN_BLOB, ADDR, '1000000')).not.toThrow()
    })
  })

  describe('payCoin (ZTX) — mismatched values', () => {
    it('throws BlobVerificationError when payTo does not match', () => {
      expect(() => BlobDecoder.verify(PAY_COIN_BLOB, 'ZWRONG_ADDRESS', '1000000'))
        .toThrow(BlobVerificationError)
    })

    it('throws BlobVerificationError when amount does not match', () => {
      expect(() => BlobDecoder.verify(PAY_COIN_BLOB, ADDR, '9999999'))
        .toThrow(BlobVerificationError)
    })

    it('error message mentions payTo mismatch', () => {
      expect(() => BlobDecoder.verify(PAY_COIN_BLOB, 'ZWRONG', '1000000')).toThrow(/payTo/)
    })

    it('error message mentions amount mismatch', () => {
      expect(() => BlobDecoder.verify(PAY_COIN_BLOB, ADDR, '0')).toThrow(/amount/)
    })
  })

  describe('ZTP20 contract blob — matching values', () => {
    it('does not throw when payTo and amount match', () => {
      expect(() => BlobDecoder.verify(CONTRACT_BLOB, ADDR, '5000000')).not.toThrow()
    })
  })

  describe('ZTP20 contract blob — mismatched values', () => {
    it('throws BlobVerificationError when payTo does not match', () => {
      expect(() => BlobDecoder.verify(CONTRACT_BLOB, 'ZWRONG', '5000000'))
        .toThrow(BlobVerificationError)
    })

    it('throws BlobVerificationError when amount does not match', () => {
      expect(() => BlobDecoder.verify(CONTRACT_BLOB, ADDR, '1'))
        .toThrow(BlobVerificationError)
    })
  })
})
