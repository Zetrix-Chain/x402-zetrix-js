/**
 * [TEST] BlobBuilder — PAY_COIN (type 7) and INVOKE_CONTRACT unit tests
 *
 * Tests for BlobBuilder.build() — constructs Zetrix transaction blobs for
 * gasModel:client payments (combinations ① ZTX+client and ② ZTP20+client).
 *
 * BlobBuilder uses zetrix-sdk-nodejs transaction.buildBlob() which is a local
 * protobuf computation — no network calls, fully deterministic.
 *
 * RED phase: tests fail until BlobBuilder is implemented.
 */

import { describe, it, expect } from 'vitest'
import { BlobBuilder, BlobBuildParams } from '../blob-builder'
import type { OperationSpec } from '../blob-builder'

// ---------------------------------------------------------------------------
// Test fixtures — distinct ephemeral Zetrix addresses (APP-M02)
// Using three separate keypairs so CLIENT_ADDRESS, PAY_TO, and ZTP20_CONTRACT
// are all different — ensures tests catch accidental address conflation bugs.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keypair: zetrixKeypair } = require('zetrix-encryption-nodejs')

const CLIENT_ADDRESS: string = (zetrixKeypair.getKeyPair('ed25519') as { address: string }).address
const PAY_TO: string         = (zetrixKeypair.getKeyPair('ed25519') as { address: string }).address
const ZTP20_CONTRACT: string = (zetrixKeypair.getKeyPair('ed25519') as { address: string }).address

const BASE_PARAMS: Omit<BlobBuildParams, 'asset'> = {
  payTo:         PAY_TO,
  amount:        '1000000',
  clientAddress: CLIENT_ADDRESS,
  nonce:         '42',
  gasPrice:      '1000',
  feeLimit:      '2000000',
}

// Pre-built blobs for determinism tests (computed from real SDK — same input = same output)
const ZTX_PARAMS:    BlobBuildParams = { ...BASE_PARAMS, asset: 'ZTX' }
const ZTP20_PARAMS:  BlobBuildParams = { ...BASE_PARAMS, asset: ZTP20_CONTRACT }

// ---------------------------------------------------------------------------
// 1. Return value shape
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — return value', () => {
  it('returns an object with a blob property for ZTX asset (PAY_COIN)', () => {
    const result = BlobBuilder.build(ZTX_PARAMS)
    expect(result).toHaveProperty('blob')
  })

  it('blob is a non-empty lowercase hex string for ZTX', () => {
    const { blob } = BlobBuilder.build(ZTX_PARAMS)
    expect(typeof blob).toBe('string')
    expect(blob.length).toBeGreaterThan(0)
    expect(blob).toMatch(/^[0-9a-f]+$/)
  })

  it('returns an object with a blob property for ZTP20 asset (INVOKE_CONTRACT)', () => {
    const result = BlobBuilder.build(ZTP20_PARAMS)
    expect(result).toHaveProperty('blob')
  })

  it('blob is a non-empty lowercase hex string for ZTP20', () => {
    const { blob } = BlobBuilder.build(ZTP20_PARAMS)
    expect(typeof blob).toBe('string')
    expect(blob.length).toBeGreaterThan(0)
    expect(blob).toMatch(/^[0-9a-f]+$/)
  })
})

// ---------------------------------------------------------------------------
// 2. PAY_COIN path (asset === 'ZTX') vs INVOKE_CONTRACT path (ZTP20 contract)
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — PAY_COIN vs INVOKE_CONTRACT', () => {
  it('ZTX and ZTP20 blobs are different (different operation type encoded)', () => {
    const { blob: ztxBlob }   = BlobBuilder.build(ZTX_PARAMS)
    const { blob: ztp20Blob } = BlobBuilder.build(ZTP20_PARAMS)
    expect(ztxBlob).not.toBe(ztp20Blob)
  })

  it('ZTP20 blob is longer than ZTX blob (INVOKE_CONTRACT encodes input JSON)', () => {
    const { blob: ztxBlob }   = BlobBuilder.build(ZTX_PARAMS)
    const { blob: ztp20Blob } = BlobBuilder.build(ZTP20_PARAMS)
    expect(ztp20Blob.length).toBeGreaterThan(ztxBlob.length)
  })
})

// ---------------------------------------------------------------------------
// 3. Determinism — same params always produce the same blob
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — determinism', () => {
  it('ZTX: same params always produce the same blob', () => {
    const { blob: b1 } = BlobBuilder.build(ZTX_PARAMS)
    const { blob: b2 } = BlobBuilder.build(ZTX_PARAMS)
    expect(b1).toBe(b2)
  })

  it('ZTP20: same params always produce the same blob', () => {
    const { blob: b1 } = BlobBuilder.build(ZTP20_PARAMS)
    const { blob: b2 } = BlobBuilder.build(ZTP20_PARAMS)
    expect(b1).toBe(b2)
  })
})

// ---------------------------------------------------------------------------
// 4. Parameter sensitivity — changing any param changes the blob
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — parameter sensitivity', () => {
  it('different amount produces a different ZTX blob', () => {
    const { blob: b1 } = BlobBuilder.build({ ...ZTX_PARAMS, amount: '1000000' })
    const { blob: b2 } = BlobBuilder.build({ ...ZTX_PARAMS, amount: '2000000' })
    expect(b1).not.toBe(b2)
  })

  it('different nonce produces a different ZTX blob', () => {
    const { blob: b1 } = BlobBuilder.build({ ...ZTX_PARAMS, nonce: '42' })
    const { blob: b2 } = BlobBuilder.build({ ...ZTX_PARAMS, nonce: '43' })
    expect(b1).not.toBe(b2)
  })

  it('different gasPrice produces a different ZTX blob', () => {
    const { blob: b1 } = BlobBuilder.build({ ...ZTX_PARAMS, gasPrice: '1000' })
    const { blob: b2 } = BlobBuilder.build({ ...ZTX_PARAMS, gasPrice: '2000' })
    expect(b1).not.toBe(b2)
  })

  it('different feeLimit produces a different ZTX blob', () => {
    const { blob: b1 } = BlobBuilder.build({ ...ZTX_PARAMS, feeLimit: '2000000' })
    const { blob: b2 } = BlobBuilder.build({ ...ZTX_PARAMS, feeLimit: '4000000' })
    expect(b1).not.toBe(b2)
  })

  it('different amount produces a different ZTP20 blob (encoded in input JSON)', () => {
    const { blob: b1 } = BlobBuilder.build({ ...ZTP20_PARAMS, amount: '1000000' })
    const { blob: b2 } = BlobBuilder.build({ ...ZTP20_PARAMS, amount: '5000000' })
    expect(b1).not.toBe(b2)
  })
})

// ---------------------------------------------------------------------------
// 5. ZTP20 INVOKE_CONTRACT — input JSON format
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — ZTP20 INVOKE_CONTRACT input encoding', () => {
  it('ZTP20 blob encodes the transfer method in input (hex-decode check)', () => {
    const { blob } = BlobBuilder.build(ZTP20_PARAMS)
    // The blob is hex-encoded protobuf. The input JSON is embedded as a UTF-8 string.
    // Decoding should reveal the method name and params.
    const decoded = Buffer.from(blob, 'hex').toString('latin1')
    expect(decoded).toContain('transfer')
    expect(decoded).toContain(PAY_TO)
  })

  it('ZTP20 blob encodes the amount in the input JSON', () => {
    const { blob } = BlobBuilder.build({ ...ZTP20_PARAMS, amount: '9876543' })
    const decoded = Buffer.from(blob, 'hex').toString('latin1')
    expect(decoded).toContain('9876543')
  })
})

// ---------------------------------------------------------------------------
// 6. Error handling
// ---------------------------------------------------------------------------

describe('BlobBuilder.build — error handling', () => {
  it('throws when clientAddress is invalid (not a Zetrix address)', () => {
    expect(() =>
      BlobBuilder.build({ ...ZTX_PARAMS, clientAddress: 'not-an-address' })
    ).toThrow()
  })

  it('throws when amount is non-numeric', () => {
    expect(() =>
      BlobBuilder.build({ ...ZTX_PARAMS, amount: 'invalid' })
    ).toThrow()
  })

  it('throws when amount is zero for ZTX (APP-M01)', () => {
    expect(() =>
      BlobBuilder.build({ ...ZTX_PARAMS, amount: '0' })
    ).toThrow('ZTX amount must be greater than 0')
  })

  it('allows zero amount for ZTP20 (token amount; gasAmount is a separate field)', () => {
    expect(() =>
      BlobBuilder.build({ ...ZTP20_PARAMS, amount: '0' })
    ).not.toThrow()
  })

  it('throws when nonce is non-numeric', () => {
    expect(() =>
      BlobBuilder.build({ ...ZTX_PARAMS, nonce: 'abc' })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 7. BlobBuilder.buildOperation — extracted operation builder
// ---------------------------------------------------------------------------

describe('BlobBuilder.buildOperation', () => {
  it('returns payCoin operation for ZTX asset', () => {
    const op: OperationSpec = BlobBuilder.buildOperation('ZTX', PAY_TO, '1000000', CLIENT_ADDRESS)
    expect(op.type).toBe('payCoin')
    expect((op.data as Record<string, unknown>).destAddress).toBe(PAY_TO)
    expect((op.data as Record<string, unknown>).gasAmount).toBe('1000000')
  })

  it('returns contractInvokeByGas operation for ZTP20 asset', () => {
    const op: OperationSpec = BlobBuilder.buildOperation(ZTP20_CONTRACT, PAY_TO, '5000', CLIENT_ADDRESS)
    expect(op.type).toBe('contractInvokeByGas')
    expect((op.data as Record<string, unknown>).contractAddress).toBe(ZTP20_CONTRACT)
    // sourceAddress must be absent — outer tx sourceAddress covers the operation
    expect((op.data as Record<string, unknown>).sourceAddress).toBeUndefined()
    // gasAmount must be absent — string '0' is truthy so the protobuf encoder sets
    // amount:0 in the wire format; the Zetrix HTTP proxy rejects that with error 93.
    // Omitting the field entirely matches sdk.operation.contractInvokeByGasOperation behaviour.
    expect((op.data as Record<string, unknown>).gasAmount).toBeUndefined()
  })

  it('ZTP20 input JSON has method "transfer" with to and value params', () => {
    const op: OperationSpec = BlobBuilder.buildOperation(ZTP20_CONTRACT, PAY_TO, '9999', CLIENT_ADDRESS)
    const input = JSON.parse((op.data as Record<string, unknown>).input as string)
    expect(input.method).toBe('transfer')
    expect(input.params.to).toBe(PAY_TO)
    expect(input.params.value).toBe('9999')
  })

  it('ZTX and ZTP20 operations have different types', () => {
    const ztx   = BlobBuilder.buildOperation('ZTX', PAY_TO, '1000', CLIENT_ADDRESS)
    const ztp20 = BlobBuilder.buildOperation(ZTP20_CONTRACT, PAY_TO, '1000', CLIENT_ADDRESS)
    expect(ztx.type).not.toBe(ztp20.type)
  })

  it('treats unrecognised asset string as ZTP20 contract address (fallthrough)', () => {
    const op = BlobBuilder.buildOperation('NOT_ZTX', PAY_TO, '100', CLIENT_ADDRESS)
    expect(op.type).toBe('contractInvokeByGas')
    expect((op.data as Record<string, unknown>).contractAddress).toBe('NOT_ZTX')
  })
})
