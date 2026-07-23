/**
 * PayloadVerifier unit tests
 *
 * PayloadVerifier.decode() / .verifyRequirements():
 *   Two blob shapes (mirrors packages/client's BlobDecoder):
 *     payCoin (native ZTX)   → payTo = payCoin.destAddress, amount = payCoin.amount
 *     payCoin + input (ZTP20)→ payTo/amount from input JSON transfer params,
 *                              tokenContract = payCoin.destAddress
 *   verifyRequirements() is the local defense-in-depth gate — runs before the
 *   Facilitator's /verify and never throws.
 */

import { describe, it, expect } from 'vitest'
import { BlobBuilder } from 'x402-zetrix-client'
import { PayloadVerifier } from '../payload-verifier'
import type {
  PaymentMiddlewareConfig,
  FacilitatorPreparedPayload,
  SignedTransactionPayload,
} from '../types'

// ---------------------------------------------------------------------------
// Fixtures — deterministic blobs built at test-run-time with BlobBuilder
// ---------------------------------------------------------------------------

const ADDR = 'ZTX3dVZwEjzHFJCNwNwMWg68rY4oCAwqssgX6'

function buildNativeBlob(amount: string): string {
  return BlobBuilder.build({
    asset:         'ZTX',
    payTo:         ADDR,
    amount,
    clientAddress: ADDR,
    nonce:         '1',
    gasPrice:      '1000',
    feeLimit:      '100000',
  }).blob
}

const CONTRACT = 'Z9xKtestZUSDcontractAddress123456789'

function buildZtp20Blob(amount: string): string {
  return BlobBuilder.build({
    asset:         CONTRACT,
    payTo:         ADDR,
    amount,
    clientAddress: ADDR,
    nonce:         '1',
    gasPrice:      '1000',
    feeLimit:      '100000',
  }).blob
}

// ---------------------------------------------------------------------------
// decode()
// ---------------------------------------------------------------------------

describe('PayloadVerifier.decode', () => {
  describe('native ZTX (payCoin, no input) blob', () => {
    it('extracts payTo from payCoin.destAddress', () => {
      const blob = buildNativeBlob('1000000')
      expect(PayloadVerifier.decode(blob).payTo).toBe(ADDR)
    })

    it('extracts amount from payCoin.amount', () => {
      const blob = buildNativeBlob('1000000')
      expect(PayloadVerifier.decode(blob).amount).toBe('1000000')
    })
  })

  describe('ZTP20 (payCoin with input) blob', () => {
    it('extracts payTo from input JSON params.to', () => {
      const blob = buildZtp20Blob('5000000')
      expect(PayloadVerifier.decode(blob).payTo).toBe(ADDR)
    })

    it('extracts amount from input JSON params.value', () => {
      const blob = buildZtp20Blob('5000000')
      expect(PayloadVerifier.decode(blob).amount).toBe('5000000')
    })

    it('extracts tokenContract from payCoin.destAddress', () => {
      const blob = buildZtp20Blob('5000000')
      expect(PayloadVerifier.decode(blob).tokenContract).toBe(CONTRACT)
    })
  })
})

const NATIVE_CONFIG: PaymentMiddlewareConfig = {
  amount:         '1000000',
  asset:          'ZTX',
  payTo:          ADDR,
  network:        'zetrix:testnet',
  facilitatorUrl: 'https://facilitator.example.com',
  gasModel:       'client',
}

function buildFacilitatorPreparedPayload(blob: string): FacilitatorPreparedPayload {
  return {
    type:            'facilitator_prepared',
    blobId:          'BLOB-test',
    blob,
    hash:            'hash123',
    clientSignature: { signBlob: 'sig', publicKey: 'pub' },
    validBefore:     Math.floor(Date.now() / 1000) + 3600,
  }
}

function buildSignedTransactionPayload(transactionBlob: string): SignedTransactionPayload {
  return {
    type:            'signed_transaction',
    transactionBlob,
    signatures:      [{ sign_data: 'sig', public_key: 'pub' }],
    validBefore:     Math.floor(Date.now() / 1000) + 3600,
  }
}

// ---------------------------------------------------------------------------
// verifyRequirements()
// ---------------------------------------------------------------------------

describe('PayloadVerifier.verifyRequirements', () => {
  describe('native ZTX — matching payTo/amount', () => {
    it('returns isValid: true (facilitator_prepared payload, reads payload.blob)', () => {
      const blob = buildNativeBlob('1000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      expect(PayloadVerifier.verifyRequirements(payload, NATIVE_CONFIG)).toEqual({ isValid: true })
    })

    it('returns isValid: true (signed_transaction payload, reads payload.transactionBlob)', () => {
      const blob = buildNativeBlob('1000000')
      const payload = buildSignedTransactionPayload(blob)
      expect(PayloadVerifier.verifyRequirements(payload, NATIVE_CONFIG)).toEqual({ isValid: true })
    })
  })

  describe('native ZTX — payTo mismatch', () => {
    it('returns isValid: false with errorCode payload_requirements_mismatch', () => {
      const blob = buildNativeBlob('1000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      const config: PaymentMiddlewareConfig = { ...NATIVE_CONFIG, payTo: 'ZTX_DIFFERENT_ADDRESS_000000000000' }
      const result = PayloadVerifier.verifyRequirements(payload, config)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_requirements_mismatch')
    })
  })

  describe('native ZTX — amount mismatch', () => {
    it('returns isValid: false with errorCode payload_requirements_mismatch', () => {
      const blob = buildNativeBlob('1000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      const config: PaymentMiddlewareConfig = { ...NATIVE_CONFIG, amount: '9999999' }
      const result = PayloadVerifier.verifyRequirements(payload, config)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_requirements_mismatch')
    })
  })

  describe('native ZTX config — ZTP20-shaped blob (tokenContract present)', () => {
    it('returns isValid: false even when decoded payTo/amount match the native config', () => {
      // A ZTP20 (contract-transfer) blob whose decoded payTo/amount happen to match
      // a native-ZTX-priced config's payTo/amount. This must NOT be accepted as a
      // valid native ZTX payment — decoded.tokenContract proves it's a token
      // transfer, not a plain payCoin transfer, regardless of payTo/amount matching.
      const blob = buildZtp20Blob('1000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      const result = PayloadVerifier.verifyRequirements(payload, NATIVE_CONFIG)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_requirements_mismatch')
    })
  })

  const ZTP20_CONFIG: PaymentMiddlewareConfig = {
    amount:         '5000000',
    asset:          CONTRACT,
    payTo:          ADDR,
    network:        'zetrix:testnet',
    facilitatorUrl: 'https://facilitator.example.com',
    gasModel:       'facilitator',
  }

  describe('ZTP20 — matching payTo/amount/contract', () => {
    it('returns isValid: true', () => {
      const blob = buildZtp20Blob('5000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      expect(PayloadVerifier.verifyRequirements(payload, ZTP20_CONFIG)).toEqual({ isValid: true })
    })
  })

  describe('ZTP20 — contract mismatch (payTo/amount otherwise match)', () => {
    it('returns isValid: false with errorCode payload_requirements_mismatch', () => {
      const blob = buildZtp20Blob('5000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      const config: PaymentMiddlewareConfig = { ...ZTP20_CONFIG, asset: 'Z9xDIFFERENTCONTRACTaddress00000000' }
      const result = PayloadVerifier.verifyRequirements(payload, config)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_requirements_mismatch')
    })
  })

  describe('ZTP20 — amount mismatch', () => {
    it('returns isValid: false with errorCode payload_requirements_mismatch', () => {
      const blob = buildZtp20Blob('5000000')
      const payload = buildFacilitatorPreparedPayload(blob)
      const config: PaymentMiddlewareConfig = { ...ZTP20_CONFIG, amount: '1' }
      const result = PayloadVerifier.verifyRequirements(payload, config)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_requirements_mismatch')
    })
  })

  // Helper for building blobs with malformed ZTP20 input
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _testSdk = new (require('zetrix-sdk-nodejs'))({ host: 'zetrix.com', port: '19943' })
  function buildMalformedInputBlob(input: string): string {
    const r = _testSdk.transaction.buildBlob({
      sourceAddress: ADDR,
      nonce:         '1',
      gasPrice:      '1000',
      feeLimit:      '100000',
      operations:    [{ type: 'contractInvokeByGas', data: { contractAddress: CONTRACT, gasAmount: '0', input } }],
    })
    return r.result.transactionBlob
  }

  describe('malformed/empty blob → payload_decode_failed (never throws)', () => {
    it('returns isValid: false with errorCode payload_decode_failed for empty blob', () => {
      const payload = buildFacilitatorPreparedPayload('')
      const result = PayloadVerifier.verifyRequirements(payload, NATIVE_CONFIG)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_decode_failed')
    })

    it('returns isValid: false with errorCode payload_decode_failed for non-hex garbage', () => {
      const payload = buildFacilitatorPreparedPayload('not-hex-at-all')
      const result = PayloadVerifier.verifyRequirements(payload, NATIVE_CONFIG)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_decode_failed')
    })

    it('returns isValid: false with errorCode payload_decode_failed when ZTP20 input is not valid JSON', () => {
      const blob = buildMalformedInputBlob('not-json{')
      const payload = buildFacilitatorPreparedPayload(blob)
      const result = PayloadVerifier.verifyRequirements(payload, ZTP20_CONFIG)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_decode_failed')
    })

    it('returns isValid: false with errorCode payload_decode_failed when ZTP20 input JSON has no params', () => {
      const blob = buildMalformedInputBlob(JSON.stringify({ method: 'transfer' }))
      const payload = buildFacilitatorPreparedPayload(blob)
      const result = PayloadVerifier.verifyRequirements(payload, ZTP20_CONFIG)
      expect(result.isValid).toBe(false)
      expect(result.errorCode).toBe('payload_decode_failed')
    })
  })
})
