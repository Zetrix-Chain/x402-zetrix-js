/**
 * FacilitatorSettleStatusClient — GET /settle/status?blobId= (C9 — NEW endpoint)
 *
 * Used ONLY after sponsored-mode /settle returns HTTP 202.
 * Polls until CONFIRMED (extract txHash) or FAILED (log errorCode+errorMsg).
 * Caps at ~20 attempts (~60–100 s). Treats QUEUED/SUBMITTED after cap as UNKNOWN.
 *
 * Do NOT use for self-pay settlements (HTTP 200 from /settle already has final txHash).
 */

import { SettleStatusResult, FacilitatorAuth } from '../types'

export const FacilitatorSettleStatusClient = {
  /**
   * Poll GET /settle/status?blobId= until terminal status.
   * @param blobId — blob ID returned in the HTTP 202 settle response
   * @param facilitatorUrl — Facilitator base URL
   * @param auth — optional API key and bearer token for Facilitator access
   */
  async poll(blobId: string, facilitatorUrl: string, auth?: FacilitatorAuth): Promise<SettleStatusResult> {
    const POLL_INTERVAL_MS = 5000
    const MAX_ATTEMPTS = 80  // 80 × 5s = 400s (~6 min) — testnet Paymaster can have high latency

    const headers: Record<string, string> = {
      ...(auth?.apiKey      && { 'x-api-key':     auth.apiKey }),
      ...(auth?.bearerToken && { 'Authorization': `Bearer ${auth.bearerToken}` }),
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const resp = await fetch(
        `${facilitatorUrl}/settle/status?blobId=${encodeURIComponent(blobId)}`,
        Object.keys(headers).length ? { headers } : undefined,
      )
      // C1: unwrap response.object
      const envelope = await resp.json() as { object: Record<string, unknown>; success: boolean }

      if (resp.status === 404 || !envelope.success) {
        return {
          status: 'UNKNOWN',
          blobId,
          errorCode: envelope.object?.errorCode as number | undefined,
          errorMsg: envelope.object?.errorMsg as string | undefined,
        }
      }

      const obj = envelope.object
      const status = obj.status as string

      if (status === 'CONFIRMED') {
        return { status: 'CONFIRMED', blobId, txHash: obj.txHash as string }
      }
      if (status === 'FAILED') {
        return {
          status: 'FAILED',
          blobId,
          errorCode: obj.errorCode as number,  // C8
          errorMsg: obj.errorMsg as string,    // C7
        }
      }
      // QUEUED or SUBMITTED — keep polling
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS))
      }
    }

    // Cap reached — treat as UNKNOWN
    return { status: 'UNKNOWN', blobId }
  },
}
