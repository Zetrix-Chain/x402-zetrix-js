/**
 * BlobBuilder — builds Zetrix transaction blobs for gasModel:client payments.
 *
 * Supports two asset types (from the 402 `asset` field):
 *   "ZTX"            → PAY_COIN (type 7) operation  — SEND_GAS
 *   "<contract_addr>" → INVOKE_CONTRACT operation    — ERC20-style transfer(to, amount)
 *
 * Uses zetrix-sdk-nodejs transaction.buildBlob() which is a local protobuf
 * serialisation — no network calls, fully synchronous and deterministic.
 *
 * Nonce is provided by the caller (PaymentEngine fetches it via RPC).
 */

// zetrix-sdk-nodejs ships as CommonJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ZetrixSdk = require('zetrix-sdk-nodejs')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlobBuildParams {
  /** 'ZTX' for native coin, or ZTP20 contract address */
  asset:         string
  /** Recipient Zetrix address */
  payTo:         string
  /** Payment amount in smallest unit (string) */
  amount:        string
  /** Payer Zetrix address (tx source_address) */
  clientAddress: string
  /** Account nonce — fetched by caller before invoking build() */
  nonce:         string
  gasPrice:      string
  feeLimit:      string
}

export interface BlobBuildResult {
  /** Hex-encoded Zetrix transaction blob, ready to sign */
  blob: string
}

export interface OperationSpec {
  type: string
  data: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// BlobBuilder
// ---------------------------------------------------------------------------

// Single SDK instance — buildBlob is local (no network calls).
// The host/port are never contacted during blob construction.
const _sdk = new ZetrixSdk({ host: 'zetrix.com', port: '19943' })

export const BlobBuilder = {
  /**
   * Build the operation spec for a payment — shared by build() and PaymentEngine.estimateFee().
   */
  buildOperation(
    asset:         string,
    payTo:         string,
    amount:        string,
    clientAddress: string,
  ): OperationSpec {
    if (asset === 'ZTX') {
      return {
        type: 'payCoin',
        data: {
          destAddress: payTo,
          gasAmount:   amount,
        },
      }
    }
    return {
      type: 'contractInvokeByGas',
      data: {
        contractAddress: asset,
        // gasAmount is omitted — the HTTP proxy rejects blobs where gasAmount is
        // explicitly set to '0' (string '0' is truthy, so the protobuf encoder
        // includes amount:0 in the wire format; the proxy rejects that with error 93).
        // Omitting the field entirely is what sdk.operation.contractInvokeByGasOperation
        // does when gasAmount==='0', and that path succeeds.
        input: JSON.stringify({
          method: 'transfer',
          params: { to: payTo, value: amount },
        }),
      },
    }
  },

  /**
   * Build a Zetrix transaction blob for a gasModel:client payment.
   *
   * @param params - payment parameters including pre-fetched nonce
   * @returns BlobBuildResult { blob } — hex-encoded transaction blob
   * @throws if params are invalid (bad address, non-numeric amounts, or zero ZTX)
   */
  build(params: BlobBuildParams): BlobBuildResult {
    const { asset, payTo, amount, clientAddress, nonce, gasPrice, feeLimit } = params

    // SDK validates nonce/gasPrice/feeLimit but silently coerces invalid gasAmount to 0.
    // Validate amount explicitly so callers get a clear error instead of a zero-amount blob.
    if (!/^\d+$/.test(amount)) {
      throw new Error(`BlobBuilder.build: amount must be a non-negative integer string, got "${amount}"`)
    }
    if (amount === '0' && asset === 'ZTX') {
      throw new Error(`BlobBuilder.build: ZTX amount must be greater than 0`)
    }

    const operation = BlobBuilder.buildOperation(asset, payTo, amount, clientAddress)

    const result = _sdk.transaction.buildBlob({
      sourceAddress: clientAddress,
      nonce,
      gasPrice,
      feeLimit,
      operations: [operation],
    })

    if (result.errorCode !== 0) {
      throw new Error(
        `BlobBuilder.build failed: ${result.errorDesc} (errorCode: ${result.errorCode})`
      )
    }

    return { blob: result.result.transactionBlob }
  },
}
