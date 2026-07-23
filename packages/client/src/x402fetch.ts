/**
 * x402Fetch — drop-in fetch wrapper with automatic x402 payment handling.
 * [IMPL] x402Fetch + PaymentPolicy
 *
 * Usage:
 *   const myFetch = createX402Fetch({ wallet, node, policy })
 *   const response = await myFetch(url, init)
 *
 * On 402: reads accepts[0] from response body, enforces PaymentPolicy,
 * calls PaymentEngine.pay, retries with X-PAYMENT header.
 */

import { PaymentEngine, type ZetrixNodeConfig, type PayRequest } from './payment-engine'
import type { WalletConfigData } from './wallet'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentPolicy {
  /** Maximum payment amount per request (smallest unit string). No limit if omitted. */
  maxAmountPerRequest?: string
}

export class PaymentPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentPolicyError'
  }
}

export interface X402FetchConfig {
  wallet:  WalletConfigData
  node:    ZetrixNodeConfig
  policy?: PaymentPolicy
  /**
   * Seconds from now until the signed_transaction expires (gasModel:client only).
   * Default: 300. Client-side config — the server cannot influence this value.
   */
  validBeforeOffset?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSafeAmount(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`x402Fetch: ${label} "${value}" is not a valid integer amount string`)
  }
  return BigInt(value)
}

function flattenHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const result: Record<string, string> = {}
    headers.forEach((v, k) => { result[k] = v })
    return result
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers as Record<string, string>
}

// ---------------------------------------------------------------------------
// createX402Fetch
// ---------------------------------------------------------------------------

/**
 * Returns a fetch-compatible function that transparently handles x402 payments.
 */
export function createX402Fetch(config: X402FetchConfig): typeof fetch {
  const { wallet, node, policy, validBeforeOffset } = config

  return async function x402Fetch(
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(url, init)

    if (response.status !== 402) {
      return response
    }

    let body: { x402Version: number; error: string; accepts: PayRequest[] }
    try {
      body = await response.json() as typeof body
    } catch {
      throw new Error('x402Fetch: 402 response did not return valid JSON')
    }

    if (!body.accepts?.length) {
      throw new Error('x402Fetch: 402 response has no payment options in accepts[]')
    }

    const req = body.accepts[0]

    if (policy?.maxAmountPerRequest !== undefined) {
      const limit  = parseSafeAmount(policy.maxAmountPerRequest, 'policy.maxAmountPerRequest')
      const amount = parseSafeAmount(req.maxAmountRequired,      'maxAmountRequired')
      if (amount > limit) {
        throw new PaymentPolicyError(
          `x402Fetch: payment amount ${req.maxAmountRequired} exceeds policy limit ${policy.maxAmountPerRequest}`
        )
      }
    }

    const xPayment = await PaymentEngine.pay(req, wallet, node, { validBeforeOffset })

    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...flattenHeaders(init?.headers),
        'x-payment': xPayment,
      },
    }

    return fetch(url, retryInit)
  } as typeof fetch
}
