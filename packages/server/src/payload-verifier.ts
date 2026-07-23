/**
 * PayloadVerifier — decodes and verifies X-PAYMENT blobs locally, before calling
 * the external Facilitator's /verify endpoint.
 * [IMPL] PayloadVerifier — local payload verification (defense-in-depth)
 *
 * Ports the decode logic from packages/client/src/blob-decoder.ts (BlobDecoder.decode).
 *
 * Uses zetrix-sdk-nodejs bundled protobuf definitions — no network calls.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const protobuf = require('protobufjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundle   = require('zetrix-sdk-nodejs/lib/crypto/protobuf/bundle.json')

import { PaymentMiddlewareConfig, XPaymentPayload } from './types'

const _root        = protobuf.Root.fromJSON(bundle)
const _Transaction = _root.lookupType('protocol.Transaction')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayloadDecodeResult {
  /** Recipient Zetrix address extracted from the blob */
  payTo:  string
  /** Payment amount (string, smallest unit) extracted from the blob */
  amount: string
  /** ZTP20 contract-invoke destination address — present only for ZTP20 payloads */
  tokenContract?: string
}

export interface PayloadVerifyResult {
  isValid:   boolean
  errorCode?: string
  errorMsg?:  string
}

// ---------------------------------------------------------------------------
// PayloadVerifier
// ---------------------------------------------------------------------------

export const PayloadVerifier = {
  /**
   * Decode a hex-encoded Zetrix transaction blob and extract payTo + amount.
   *
   * @throws if blob is empty, non-hex, has no operations, or the first operation
   *   is not a payCoin operation
   */
  decode(blobHex: string): PayloadDecodeResult {
    if (!blobHex) {
      throw new Error('PayloadVerifier.decode: blob must not be empty')
    }

    let tx: ReturnType<typeof _Transaction.toObject>
    try {
      const bytes = Buffer.from(blobHex, 'hex')
      const decoded = _Transaction.decode(bytes)
      tx = _Transaction.toObject(decoded, { longs: String, enums: String, bytes: String })
    } catch (err) {
      throw new Error(`PayloadVerifier.decode: failed to decode blob — ${(err as Error).message}`)
    }

    if (!tx.operations || tx.operations.length === 0) {
      throw new Error('PayloadVerifier.decode: blob contains no operations')
    }

    const op = tx.operations[0]
    const payCoin = op.payCoin

    if (!payCoin) {
      throw new Error('PayloadVerifier.decode: unsupported operation type — expected payCoin')
    }

    // ZTP20: payCoin blobs with input JSON encode a contract transfer.
    if (payCoin.input) {
      let inputObj: { method: string; params?: { to?: string; value?: string; amount?: string } }
      try {
        inputObj = JSON.parse(payCoin.input)
      } catch {
        throw new Error('PayloadVerifier.decode: failed to parse payCoin.input as JSON')
      }
      const transferAmount = inputObj.params?.value ?? inputObj.params?.amount
      if (!inputObj.params?.to || !transferAmount) {
        throw new Error('PayloadVerifier.decode: missing params.to or params.value in payCoin.input')
      }
      return {
        payTo:         inputObj.params.to,
        amount:        transferAmount,
        tokenContract: payCoin.destAddress,
      }
    }

    // Native ZTX: plain payCoin — destAddress is the payTo, amount is the payment amount
    return {
      payTo:  payCoin.destAddress,
      amount: payCoin.amount,
    }
  },

  /**
   * Local defense-in-depth check: verify the X-Payment payload's blob actually pays
   * the configured payTo/amount — called BEFORE the external Facilitator's /verify.
   */
  verifyRequirements(payload: XPaymentPayload, config: PaymentMiddlewareConfig): PayloadVerifyResult {
    const blobHex = payload.type === 'facilitator_prepared' ? payload.blob : payload.transactionBlob

    let decoded: PayloadDecodeResult
    try {
      decoded = PayloadVerifier.decode(blobHex)
    } catch (err) {
      return {
        isValid:   false,
        errorCode: 'payload_decode_failed',
        errorMsg:  (err as Error).message,
      }
    }

    if (decoded.payTo !== config.payTo) {
      return {
        isValid:   false,
        errorCode: 'payload_requirements_mismatch',
        errorMsg:  `payTo mismatch — expected "${config.payTo}", got "${decoded.payTo}"`,
      }
    }

    if (decoded.amount !== config.amount) {
      return {
        isValid:   false,
        errorCode: 'payload_requirements_mismatch',
        errorMsg:  `amount mismatch — expected "${config.amount}", got "${decoded.amount}"`,
      }
    }

    if (config.asset === 'ZTX') {
      if (decoded.tokenContract) {
        return {
          isValid:   false,
          errorCode: 'payload_requirements_mismatch',
          errorMsg:  `tokenContract mismatch — expected native ZTX (no tokenContract), got "${decoded.tokenContract}"`,
        }
      }
    } else if (decoded.tokenContract !== config.asset) {
      return {
        isValid:   false,
        errorCode: 'payload_requirements_mismatch',
        errorMsg:  `tokenContract mismatch — expected "${config.asset}", got "${decoded.tokenContract}"`,
      }
    }

    return { isValid: true }
  },
}
