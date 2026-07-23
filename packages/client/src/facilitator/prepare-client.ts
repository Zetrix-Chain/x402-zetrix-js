/**
 * FacilitatorPrepareClient — HTTP client for POST /prepare.
 * [IMPL] BlobDecoder + FacilitatorPrepareClient
 *
 * Called by PaymentEngine when gasModel === "facilitator" (ZTP20 only).
 * The Facilitator builds a Paymaster-sponsored blob; the client verifies
 * it (BlobDecoder.verify) and signs it (WalletSigner.sign) before attaching
 * to the X-PAYMENT header.
 *
 * Applies Facilitator API changes:
 *   C1 — response.object envelope: always read response.object
 *   C7 — errorMsg field (not "error" or "invalidReason")
 *   C8 — errorCode is integer
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepareParams {
  clientAddress: string
  payTo:         string
  amount:        string
  /** ZTP20 contract address — ZTX payments never call /prepare */
  asset:         string
  /** "zetrix:mainnet" | "zetrix:testnet" (C2 — no -1 suffix) */
  network:       string
}

export interface PrepareResult {
  blob:             string
  hash:             string
  blobId:           string
  paymasterAddress: string
  validBefore:      number
}

// ---------------------------------------------------------------------------
// FacilitatorPrepareClient
// ---------------------------------------------------------------------------

export const FacilitatorPrepareClient = {
  /**
   * Call POST /prepare and return the Paymaster-built blob details.
   *
   * @param params       - prepare request params
   * @param facilitatorUrl - Facilitator base URL (e.g. https://…/api/v1/facilitator)
   * @returns PrepareResult — unwrapped from C1 envelope
   * @throws if Facilitator returns success:false, or fetch fails
   */
  async prepare(params: PrepareParams, facilitatorUrl: string): Promise<PrepareResult> {
    if (!facilitatorUrl.startsWith('https://')) {
      throw new Error('FacilitatorPrepareClient.prepare: facilitatorUrl must use HTTPS')
    }
    const url = `${facilitatorUrl}/prepare`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':   'x402-zetrix-js/1.0 (+https://github.com/Zetrix-Chain/x402-zetrix-js)',
        },
        body:   JSON.stringify(params),
        signal: controller.signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`FacilitatorPrepareClient.prepare: timed out after 30s (${url})`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      let errBody = ''
      try { errBody = await response.text() } catch { /* ignore */ }
      throw new Error(
        `FacilitatorPrepareClient.prepare: HTTP ${response.status} from ${url} — ${errBody.slice(0, 300)}`
      )
    }

    const envelope = await response.json() as {
      object:  PrepareResult | { errorCode: number; errorMsg: string }
      success: boolean
    }

    // C1: unwrap envelope — check success before reading object
    if (!envelope.success) {
      const err = envelope.object as { errorCode: number; errorMsg: string }
      throw new Error(
        `FacilitatorPrepareClient.prepare failed: ${err.errorMsg} (errorCode: ${err.errorCode})`
      )
    }

    const result = envelope.object as PrepareResult
    // Zetrix SDK sign() requires lowercase hex; normalize at ingress.
    result.blob = result.blob.toLowerCase()
    return result
  },
}
