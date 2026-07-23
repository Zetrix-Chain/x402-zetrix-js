/**
 * FacilitatorSettleClient — POST /settle
 *
 * Branches on HTTP status (C4):
 *   200 → self-pay (sync); check status SUBMITTED/FAILED; parse errorCode on FAILED (C5)
 *   202 → sponsored (async); caller must poll /settle/status via FacilitatorSettleStatusClient (C9)
 *   409 → idempotency hit; treat as already-settled (C6)
 *
 * Unwraps response.object (C1). Uses errorMsg (C7), errorCode integer (C8).
 */

import { XPaymentHeader, SettleResult, FacilitatorAuth } from '../types'

export const FacilitatorSettleClient = {
  /**
   * Call POST /settle on the Facilitator.
   * @param payload — the full decoded X-Payment payload
   * @param facilitatorUrl — Facilitator base URL
   * @param auth — optional API key and bearer token for Facilitator access
   * @returns SettleResult discriminated union keyed by httpStatus
   */
  async settle(payload: XPaymentHeader, facilitatorUrl: string, auth?: FacilitatorAuth): Promise<SettleResult> {
    const bodyStr = JSON.stringify(payload)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)

    let resp: Response
    try {
      resp = await fetch(`${facilitatorUrl}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth?.apiKey      && { 'x-api-key':     auth.apiKey }),
          ...(auth?.bearerToken && { 'Authorization': `Bearer ${auth.bearerToken}` }),
        },
        body:   bodyStr,
        signal: controller.signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`FacilitatorSettleClient.settle: timed out after 30s (${facilitatorUrl}/settle)`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

    const httpStatus = resp.status
    // C1: unwrap response.object
    const envelope = await resp.json() as { object: Record<string, unknown>; success: boolean }
    const obj = envelope.object

    if (httpStatus === 200) {
      return {
        httpStatus: 200,
        result: {
          status: obj.status as 'SUBMITTED' | 'FAILED',
          txHash: (obj.txHash ?? '') as string,
          errorCode: obj.errorCode as number | undefined,  // C5, C8
          errorMsg: obj.errorMsg as string | undefined,    // C5, C7
        },
      }
    }
    if (httpStatus === 202) {
      return {
        httpStatus: 202,
        result: {
          status: 'QUEUED',
          blobId: obj.blobId as string,
        },
      }
    }
    if (httpStatus === 409) {
      // C6: idempotency — already settled, not a failure
      return {
        httpStatus: 409,
        result: {
          errorCode: obj.errorCode as number,  // 460810 C8
          errorMsg: obj.errorMsg as string,    // 'blob_already_settled' C7
        },
      }
    }
    throw new Error(`FacilitatorSettleClient.settle: unexpected HTTP status ${httpStatus}`)
  },
}
