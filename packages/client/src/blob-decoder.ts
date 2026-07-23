/**
 * BlobDecoder — decodes raw Zetrix protobuf transaction blobs.
 * [IMPL] BlobDecoder + FacilitatorPrepareClient
 *
 * Used by PaymentEngine (gasModel:facilitator) as a security gate:
 *   BlobDecoder.verify(blob, expectedPayTo, expectedAmount)
 *
 * Two blob shapes decoded:
 *   payCoin, no input  → ZTX payment:  payTo = payCoin.destAddress, amount = payCoin.amount
 *   payCoin, has input → ZTP20 payment: payTo from params.to, amount from params.value
 *
 * Uses zetrix-sdk-nodejs bundled protobuf definitions — no network calls.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const protobuf = require('protobufjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundle   = require('zetrix-sdk-nodejs/lib/crypto/protobuf/bundle.json')

const _root        = protobuf.Root.fromJSON(bundle)
const _Transaction = _root.lookupType('protocol.Transaction')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlobDecodeResult {
  /** Recipient Zetrix address extracted from the blob */
  payTo:  string
  /** Payment amount (string, smallest unit) extracted from the blob */
  amount: string
}

export class BlobVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlobVerificationError'
  }
}

// ---------------------------------------------------------------------------
// BlobDecoder
// ---------------------------------------------------------------------------

export const BlobDecoder = {
  /**
   * Decode a hex-encoded Zetrix transaction blob and extract payTo + amount.
   *
   * @param blob - hex-encoded transaction blob (from Paymaster or BlobBuilder)
   * @returns BlobDecodeResult { payTo, amount }
   * @throws if blob is empty, non-hex, or has no operations
   */
  decode(blob: string): BlobDecodeResult {
    if (!blob) {
      throw new Error('BlobDecoder.decode: blob must not be empty')
    }

    let tx: ReturnType<typeof _Transaction.toObject>
    try {
      const bytes = Buffer.from(blob, 'hex')
      const decoded = _Transaction.decode(bytes)
      tx = _Transaction.toObject(decoded, { longs: String, enums: String, bytes: String })
    } catch (err) {
      throw new Error(`BlobDecoder.decode: failed to decode blob — ${(err as Error).message}`)
    }

    if (!tx.operations || tx.operations.length === 0) {
      throw new Error('BlobDecoder.decode: blob contains no operations')
    }

    const op = tx.operations[0]
    const payCoin = op.payCoin

    if (!payCoin) {
      throw new Error('BlobDecoder.decode: unsupported operation type — expected payCoin')
    }

    // ZTP20: payCoin blobs with input JSON encode a contract transfer.
    // Facilitator blobs use params.value; some callers may use params.amount (legacy).
    if (payCoin.input) {
      let inputObj: { method: string; params?: { to?: string; value?: string; amount?: string } }
      try {
        inputObj = JSON.parse(payCoin.input)
      } catch {
        throw new Error('BlobDecoder.decode: failed to parse payCoin.input as JSON')
      }
      const transferAmount = inputObj.params?.value ?? inputObj.params?.amount
      if (!inputObj.params?.to || !transferAmount) {
        throw new Error('BlobDecoder.decode: missing params.to or params.value in payCoin.input')
      }
      return {
        payTo:  inputObj.params.to,
        amount: transferAmount,
      }
    }

    // ZTX: plain payCoin — destAddress is the payTo, amount is the payment amount
    return {
      payTo:  payCoin.destAddress,
      amount: payCoin.amount,
    }
  },

  /**
   * Security gate: verify that the blob encodes the expected payTo and amount.
   *
   * Called by PaymentEngine after receiving a blob from the Facilitator /prepare
   * endpoint — ensures the Paymaster did not tamper with recipient or amount.
   *
   * @throws BlobVerificationError if payTo or amount does not match
   */
  verify(blob: string, expectedPayTo: string, expectedAmount: string): void {
    const { payTo, amount } = this.decode(blob)

    if (payTo !== expectedPayTo) {
      throw new BlobVerificationError(
        `BlobDecoder.verify: payTo mismatch — expected "${expectedPayTo}", got "${payTo}"`
      )
    }

    if (amount !== expectedAmount) {
      throw new BlobVerificationError(
        `BlobDecoder.verify: amount mismatch — expected "${expectedAmount}", got "${amount}"`
      )
    }
  },
}
