/**
 * PaymentEngine — orchestrates x402 payment signing for Zetrix.
 * fetchNonce (get nonce from Zetrix RPC)
 * pay() decision tree (gasModel:client + gasModel:facilitator)
 */

import { BlobBuilder, type OperationSpec } from './blob-builder'
import { WalletSigner, type WalletConfigData } from './wallet'
import { BlobDecoder } from './blob-decoder'
import { FacilitatorPrepareClient } from './facilitator/prepare-client'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _sdkCtor = require('zetrix-sdk-nodejs')

export class InsufficientBalanceError extends Error {
  constructor(
    message: string,
    public readonly required: string,
    public readonly available: string,
    public readonly asset: string,
  ) {
    super(message)
    this.name = 'InsufficientBalanceError'
    // Required for correct instanceof checks in ES5-transpiled environments
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype)
  }
}

export interface ZetrixNodeConfig {
  /** Zetrix RPC node hostname, e.g. 'node.zetrix.com' */
  host: string
  /** Zetrix RPC node port, e.g. '19943' */
  port: string
}

export interface PayRequest {
  scheme:            string
  network:           string
  asset:             string
  payTo:             string
  maxAmountRequired: string
  extra: {
    gasModel:         'client' | 'facilitator'
    prepareEndpoint?: string
    /** Ignored for gasModel:client — fee is always estimated via evaluateFee(). */
    gasPrice?:        string
    /** Ignored for gasModel:client — fee is always estimated via evaluateFee(). */
    feeLimit?:        string
  }
}

export interface PayOptions {
  /**
   * Seconds from now until the signed_transaction expires (gasModel:client only).
   * Default: 300. Client-side config — not read from the server 402 response.
   */
  validBeforeOffset?: number
}

export const PaymentEngine = {
  /**
   * Create a Zetrix SDK instance for the given node config.
   * Exposed on the object so tests can spy on it via vi.spyOn.
   */
  /* v8 ignore next 6 */
  _createSdk(node: ZetrixNodeConfig) {
    // Handles both real CJS export (no .default) and ESM-interop mock (with .default)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: new (opts: { host: string; port: string }) => any = _sdkCtor.default ?? _sdkCtor
    return new Ctor({ host: node.host, port: node.port })
  },

  /**
   * Fetch the ZTX balance for an account from a Zetrix RPC node.
   * Returns `{ balance: '0' }` when the account does not exist (errorCode 4) or any RPC error.
   *
   * @param address — Zetrix account address
   * @param node — RPC node config (host + port)
   */
  async fetchAccountInfo(address: string, node: ZetrixNodeConfig): Promise<{ balance: string }> {
    const sdk = PaymentEngine._createSdk(node)
    const result = await sdk.account.getInfo(address) as {
      errorCode: number
      result?: { balance: string }
    }
    if (result.errorCode !== 0) {
      return { balance: '0' }
    }
    return { balance: result.result?.balance ?? '0' }
  },

  /**
   * Fetch the ZTP20 token balance for an address by calling the contract's balanceOf method.
   * Network errors from `sdk.contract.call` propagate to the caller.
   * Returns `{ balance: '0' }` for non-zero errorCode, missing response fields, or malformed JSON.
   *
   * @param contractAddress — ZTP20 contract address
   * @param address — holder address to query
   * @param node — RPC node config (host + port)
   */
  async fetchZTP20Balance(
    contractAddress: string,
    address: string,
    node: ZetrixNodeConfig,
  ): Promise<{ balance: string }> {
    const sdk = PaymentEngine._createSdk(node)
    const result = await sdk.contract.call({
      contractAddress,
      input:   JSON.stringify({ method: 'balanceOf', params: { address } }),
      optType: 2,
    }) as {
      errorCode: number
      result?: { query_rets?: Array<{ result?: { value?: string } }> }
    }
    if (result.errorCode !== 0) return { balance: '0' }
    const raw = result.result?.query_rets?.[0]?.result?.value
    if (!raw) return { balance: '0' }
    try {
      const parsed = JSON.parse(raw) as { balance?: string }
      return { balance: parsed.balance ?? '0' }
    } catch {
      return { balance: '0' }
    }
  },

  /**
   * Fetch the current account nonce from a Zetrix RPC node.
   *
   * @param address — Zetrix payer address
   * @param node — RPC node config (host + port)
   * @returns nonce as a decimal string — pass directly to BlobBuildParams.nonce
   */
  async fetchNonce(address: string, node: ZetrixNodeConfig): Promise<string> {
    const sdk = PaymentEngine._createSdk(node)
    const result = await sdk.account.getNonce(address) as {
      errorCode: number
      errorDesc?: string
      result?: { nonce: string | number }
    }
    if (result.errorCode !== 0) {
      throw new Error(
        `PaymentEngine.fetchNonce failed: errorCode ${result.errorCode} — ${result.errorDesc ?? 'unknown'}`
      )
    }
    // getNonce returns the last committed nonce; the next transaction must use nonce+1
    return String(BigInt(result.result!.nonce) + 1n)
  },

  /**
   * Check that the wallet has sufficient balance before signing a payment.
   * Throws InsufficientBalanceError if balance is too low — call before BlobBuilder.build/WalletSigner.sign.
   *
   * For ZTX: checks ZTX balance >= amount + feeLimit.
   * For ZTP20: checks token balance >= amount (unless skipTokenCheck), then (if feeLimit > 0) ZTX >= feeLimit.
   * Pass feeLimit='0' for gasModel:facilitator to skip the ZTX gas check.
   * Pass opts.skipTokenCheck=true to skip the ZTP20 token check (used when it was already verified earlier).
   *
   * Precondition: `req.maxAmountRequired` and `feeLimit` must be non-negative integer strings
   * (e.g. '0', '1000000'). Non-numeric values throw a native SyntaxError from BigInt(), not
   * InsufficientBalanceError. The `createX402Fetch` path validates amounts upstream; direct
   * callers are responsible for passing valid strings.
   */
  async checkBalance(
    req: PayRequest,
    wallet: WalletConfigData,
    node: ZetrixNodeConfig,
    feeLimit: string,
    opts: { skipTokenCheck?: boolean } = {},
  ): Promise<void> {
    if (!req.asset) {
      throw new Error('checkBalance: req.asset must not be empty')
    }

    const amount = BigInt(req.maxAmountRequired)
    const fee    = BigInt(feeLimit)

    if (req.asset === 'ZTX') {
      const { balance } = await PaymentEngine.fetchAccountInfo(wallet.address, node)
      const required = amount + fee
      if (BigInt(balance) < required) {
        throw new InsufficientBalanceError(
          `Insufficient ZTX: required ${required}, available ${balance}`,
          String(required), balance, 'ZTX',
        )
      }
      return
    }

    // ZTP20: check token balance first (unless already checked upstream), then ZTX for gas
    if (!opts.skipTokenCheck) {
      const { balance: tokenBal } = await PaymentEngine.fetchZTP20Balance(req.asset, wallet.address, node)
      if (BigInt(tokenBal) < amount) {
        throw new InsufficientBalanceError(
          `Insufficient ${req.asset}: required ${req.maxAmountRequired}, available ${tokenBal}`,
          req.maxAmountRequired, tokenBal, req.asset,
        )
      }
    }

    if (fee > 0n) {
      const { balance: ztxBal } = await PaymentEngine.fetchAccountInfo(wallet.address, node)
      if (BigInt(ztxBal) < fee) {
        throw new InsufficientBalanceError(
          `Insufficient ZTX for gas: required ${feeLimit}, available ${ztxBal}`,
          feeLimit, ztxBal, 'ZTX',
        )
      }
    }
  },

  /**
   * Estimate feeLimit and gasPrice for a transaction via sdk.transaction.evaluateFee.
   * Uses Scenario 3 (no private key — transaction_json path) so no signing is needed.
   */
  async estimateFee(
    params: { sourceAddress: string; nonce: string; operation: OperationSpec },
    node: ZetrixNodeConfig,
  ): Promise<{ feeLimit: string; gasPrice: string }> {
    const sdk = PaymentEngine._createSdk(node)
    const result = await sdk.transaction.evaluateFee({
      sourceAddress:  params.sourceAddress,
      nonce:          params.nonce,
      operations:     [params.operation],
      signtureNumber: '1',
    }) as {
      errorCode:  number
      errorDesc?: string
      result?:    { feeLimit: number | string; gasPrice: number | string }
    }

    if (result.errorCode !== 0) {
      throw new Error(
        `PaymentEngine.estimateFee failed: errorCode ${result.errorCode} — ${result.errorDesc ?? 'unknown'}`
      )
    }

    if (!result.result) {
      throw new Error('PaymentEngine.estimateFee: SDK returned errorCode 0 but result is empty')
    }
    return {
      feeLimit: String(result.result.feeLimit),
      gasPrice: String(result.result.gasPrice),
    }
  },

  /**
   * Build and sign an x402 payment header for the given payment requirements.
   *
   * Routes by gasModel:
   *   client      — fetchNonce → buildOperation → estimateFee → BlobBuilder.build → WalletSigner.sign → signed_transaction
   *   facilitator — FacilitatorPrepareClient.prepare → BlobDecoder.verify → sign → facilitator_prepared
   *
   * @param options.validBeforeOffset — client-side expiry window in seconds (default 300, gasModel:client only)
   * @returns base64-encoded JSON string — use directly as X-PAYMENT header value
   */
  async pay(
    req:       PayRequest,
    wallet:    WalletConfigData,
    node:      ZetrixNodeConfig,
    options:   PayOptions = {},
    signerFn?: (blob: string) => Promise<{ signBlob: string; publicKey: string }>,
  ): Promise<string> {
    const { scheme, network, asset, payTo, maxAmountRequired, extra } = req
    const sign = signerFn ?? ((b: string) => Promise.resolve(WalletSigner.sign(b, wallet.privateKey)))

    if (extra.gasModel === 'client') {
      const nonce     = await PaymentEngine.fetchNonce(wallet.address, node)
      const operation = BlobBuilder.buildOperation(asset, payTo, maxAmountRequired, wallet.address)
      // For ZTP20: check token balance before estimateFee so that insufficient tokens yield a
      // clean InsufficientBalanceError instead of an opaque contract simulation failure (errorCode 151).
      if (asset !== 'ZTX') {
        await PaymentEngine.checkBalance(req, wallet, node, '0')
      }
      const { feeLimit, gasPrice } = await PaymentEngine.estimateFee(
        { sourceAddress: wallet.address, nonce, operation },
        node,
      )
      // skipTokenCheck: token already verified in the pre-check above; only re-check ZTX gas here
      await PaymentEngine.checkBalance(req, wallet, node, feeLimit, { skipTokenCheck: asset !== 'ZTX' })
      const { blob } = BlobBuilder.build({
        asset,
        payTo,
        amount:        maxAmountRequired,
        clientAddress: wallet.address,
        nonce,
        gasPrice,
        feeLimit,
      })
      const { signBlob, publicKey } = await sign(blob)
      const validBefore = Math.floor(Date.now() / 1000) + (options.validBeforeOffset ?? 300)

      const header = {
        x402Version: 2,
        scheme,
        network,
        payload: {
          type:            'signed_transaction',
          transactionBlob: blob,
          signatures:      [{ sign_data: signBlob, public_key: publicKey }],
          validBefore,
        },
      }
      return Buffer.from(JSON.stringify(header)).toString('base64')
    }

    if (extra.gasModel === 'facilitator') {
      if (asset === 'ZTX') {
        throw new Error('PaymentEngine.pay: native ZTX asset requires gasModel:client, not gasModel:facilitator')
      }
      if (!extra.prepareEndpoint) {
        throw new Error('PaymentEngine.pay: gasModel:facilitator requires extra.prepareEndpoint')
      }
      const prepareResult = await FacilitatorPrepareClient.prepare(
        {
          clientAddress: wallet.address,
          payTo,
          amount:        maxAmountRequired,
          asset,
          network,
        },
        extra.prepareEndpoint,
      )

      BlobDecoder.verify(prepareResult.blob, payTo, maxAmountRequired)
      await PaymentEngine.checkBalance(req, wallet, node, '0')

      const { signBlob, publicKey } = await sign(prepareResult.blob)

      const header = {
        x402Version: 2,
        scheme,
        network,
        payload: {
          type:            'facilitator_prepared',
          blobId:          prepareResult.blobId,
          blob:            prepareResult.blob,
          hash:            prepareResult.hash,
          validBefore:     prepareResult.validBefore,
          clientSignature: { signBlob, publicKey },
        },
      }
      return Buffer.from(JSON.stringify(header)).toString('base64')
    }

    throw new Error(`PaymentEngine.pay: unsupported gasModel "${extra.gasModel}"`)
  },
}
