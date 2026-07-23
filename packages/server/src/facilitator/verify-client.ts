/**
 * FacilitatorVerifyClient — POST /verify
 *
 * Unwraps response.object (C1). Returns VerifyResult with isValid, errorCode?, errorMsg?.
 * Switches on errorCode integer (C8), uses errorMsg for logging (C7).
 */

import { XPaymentHeader, VerifyResult, FacilitatorAuth } from '../types'

export const FacilitatorVerifyClient = {
  /**
   * Call POST /verify on the Facilitator.
   * @param payload — the full decoded X-Payment payload
   * @param facilitatorUrl — Facilitator base URL
   * @param auth — optional API key and bearer token for Facilitator access
   */
  async verify(payload: XPaymentHeader, facilitatorUrl: string, auth?: FacilitatorAuth): Promise<VerifyResult> {
    const resp = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth?.apiKey      && { 'x-api-key':     auth.apiKey }),
        ...(auth?.bearerToken && { 'Authorization': `Bearer ${auth.bearerToken}` }),
      },
      body: JSON.stringify(payload),
    })
    // C1: unwrap response.object; object field may be absent on non-2xx errors
    const envelope = await resp.json() as { object?: Record<string, unknown>; success: boolean }

    if (!resp.ok || !envelope.success) {
      return {
        isValid: false,
        errorCode: envelope.object?.errorCode as number | undefined,
        errorMsg: envelope.object?.errorMsg as string | undefined,
      }
    }
    const obj = envelope.object
    return {
      isValid: obj?.isValid as boolean ?? false,
      errorCode: obj?.errorCode as number | undefined,
      errorMsg: obj?.errorMsg as string | undefined,
    }
  },
}
