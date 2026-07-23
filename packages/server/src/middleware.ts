/**
 * paymentMiddleware — Express middleware for x402 payment protection.
 *
 * On no X-PAYMENT header: returns 402 with accepts[].
 * On X-PAYMENT present: verifies with Facilitator, serves resource, settles async.
 *
 * Settlement is non-blocking — resource is returned to client before settle completes.
 */

import { Request, Response, NextFunction } from 'express'
import type { PaymentMiddlewareConfig, FacilitatorAuth, SettleQueuedResult, SettleIdempotentResult } from './types'
import { FacilitatorVerifyClient } from './facilitator/verify-client'
import { FacilitatorSettleClient } from './facilitator/settle-client'
import { FacilitatorSettleStatusClient } from './facilitator/settle-status-client'
import { XPaymentParser } from './x-payment-parser'
import { PaymentResponseBuilder } from './payment-response-builder'

/**
 * Protect an Express route with x402 payment.
 *
 * @param config — payment requirements and Facilitator URL
 * @returns Express middleware function
 */
export function paymentMiddleware(config: PaymentMiddlewareConfig) {
  if (config.asset === 'ZTX' && (config.gasModel ?? 'facilitator') === 'facilitator') {
    throw new Error('[x402] Invalid config: native ZTX asset requires gasModel: "client"')
  }
  const auth: FacilitatorAuth = {
    apiKey:      config.facilitatorApiKey,
    bearerToken: config.facilitatorBearerToken,
  }
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const xPaymentHeader = req.headers['x-payment'] as string | undefined

    // -----------------------------------------------------------------------
    // No X-Payment header → return 402 with accepts[]
    // -----------------------------------------------------------------------
    if (!xPaymentHeader) {
      res.status(402).json({
        x402Version: 2,
        error: 'payment_required',
        accepts: [
          {
            scheme: 'exact',
            network: config.network,           // C2: short form (no -1)
            asset: config.asset,
            payTo: config.payTo,
            maxAmountRequired: config.amount,
            extra: {
              gasModel: config.gasModel ?? 'facilitator',
              ...(config.prepareEndpoint && { prepareEndpoint: config.prepareEndpoint }),
              ...(config.gasPrice && { gasPrice: config.gasPrice }),
              ...(config.feeLimit && { feeLimit: config.feeLimit }),
            },
          },
        ],
      })
      return
    }

    // -----------------------------------------------------------------------
    // Parse X-Payment header
    // -----------------------------------------------------------------------
    let payload: ReturnType<typeof XPaymentParser.parse>
    try {
      payload = XPaymentParser.parse(xPaymentHeader)
    } catch (e) {
      res.status(402).json({
        x402Version: 2,
        error: 'malformed_payment_header',
        errorMsg: String(e),
      })
      return
    }

    // -----------------------------------------------------------------------
    // validBefore pre-check — reject expired payments before hitting Facilitator
    // -----------------------------------------------------------------------
    const validBefore = payload.payload.validBefore
    if (validBefore !== undefined && Math.floor(Date.now() / 1000) >= validBefore) {
      res.status(402).json({
        x402Version: 2,
        error: 'payment_invalid',
        errorCode: 460807,
        errorMsg: 'blob_expired',
      })
      return
    }

    // -----------------------------------------------------------------------
    // Verify with Facilitator — C1 (envelope unwrap), C3, C7, C8
    // -----------------------------------------------------------------------
    let verifyResult: Awaited<ReturnType<typeof FacilitatorVerifyClient.verify>>
    try {
      verifyResult = await FacilitatorVerifyClient.verify(payload, config.facilitatorUrl, auth)
    } catch {
      res.status(503).json({ x402Version: 2, error: 'facilitator_unavailable' })
      return
    }

    if (!verifyResult.isValid) {
      res.status(402).json({
        x402Version: 2,
        error: 'payment_invalid',
        errorMsg: verifyResult.errorMsg,       // C7: errorMsg not "error"
        errorCode: verifyResult.errorCode,     // C8: integer
      })
      return
    }

    // -----------------------------------------------------------------------
    // Valid payment — attach X-Payment-Response, hook non-blocking settle
    // -----------------------------------------------------------------------
    res.setHeader(
      'X-Payment-Response',
      PaymentResponseBuilder.build({ status: 'accepted', network: config.network })
    )

    // Fire-and-forget settle on response finish (non-blocking)
    res.on('finish', () => {
      FacilitatorSettleClient.settle(payload, config.facilitatorUrl, auth)
        .then(({ httpStatus, result }) => {
          if (httpStatus === 200) {
            // C5: self-pay — log result for diagnostics
            const settled = result as { status: string; txHash?: string; errorCode?: number; errorMsg?: string }
            config.logger?.log(`[x402] settle 200 status=${settled.status} txHash=${settled.txHash ?? 'n/a'} errorCode=${settled.errorCode ?? 'n/a'} errorMsg=${settled.errorMsg ?? 'n/a'}`)
          } else if (httpStatus === 202) {
            // C4/C9: sponsored — poll for final status
            const queued = result as SettleQueuedResult
            config.logger?.log(`[x402] settle 202 status=QUEUED blobId=${queued.blobId}`)
            FacilitatorSettleStatusClient.poll(queued.blobId, config.facilitatorUrl, auth)
              .then(statusResult => {
                config.logger?.log(`[x402] settle/status final status=${statusResult.status} blobId=${queued.blobId}`)
              })
              .catch(err => config.logger?.error('[x402] settle/status poll error:', err))
          } else if (httpStatus === 409) {
            // C6: idempotency — already settled, not a failure
            const idem = result as SettleIdempotentResult
            config.logger?.log(`[x402] settle 409 idempotency (${idem.errorCode}): ${idem.errorMsg}`)
          }
        })
        .catch(err => config.logger?.error('[x402] settle error:', err))
    })

    next()
  }
}
