/**
 * MCP tool handlers for x402 Zetrix payments.
 * [IMPL] x402-zetrix-mcp MCP server
 *
 * Tools:
 *   fetch_with_payment        — HTTP fetch with automatic x402 payment
 *   get_wallet_info           — return configured wallet address/network
 *   check_payment_capability  — query Zetrix RPC for wallet balance
 */

import { PaymentEngine } from 'x402-zetrix-client'
import type { ZetrixNodeConfig, PayRequest, PayOptions } from 'x402-zetrix-client'
import type { WalletConfigData } from 'x402-zetrix-client'
import type { PaymentPolicy } from 'x402-zetrix-client'
import { HsmSigner } from './hsm-signer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HsmSignerConfig {
  address:   string
  network:   string
  password?: string
  baseUrl:   string
}

export interface McpToolConfig {
  wallet:              WalletConfigData | null
  hsmConfig?:          HsmSignerConfig
  node:                ZetrixNodeConfig
  policy?:             PaymentPolicy
  validBeforeOffset?:  number
  /**
   * Decimal places for ZTP20 tokens when formatting human-readable amounts.
   * ZTX is always 6. ZTP20 defaults to 6 (most tokens); override if your
   * token uses different precision (e.g. 8 for BTC-pegged tokens).
   */
  ztp20Decimals?:      number
}

export interface FetchInput {
  url:          string
  method?:      string
  headers?:     Record<string, string>
  body?:        string
  hsmPassword?: string
}

export interface FetchResult {
  status:           number
  body:             string
  paymentMade:      boolean
  /** Raw amount in smallest unit (e.g. "100000" zeta for ZTX, or token smallest unit) */
  amountPaid:       string
  /** Human-readable amount with correct decimals (e.g. "0.1 ZTX" or "0.01 tokens") */
  amountPaidHuman:  string
  asset:            string
}

export interface WalletInfo {
  address:    string
  network:    string
  configured: boolean
  signerMode: 'local' | 'hsm' | 'unconfigured'
}

export interface CapabilityResult {
  capable: boolean
  balance: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSafeAmount(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`fetch_with_payment: ${label} "${value}" is not a valid integer amount string`)
  }
  return BigInt(value)
}

/**
 * Format a raw smallest-unit amount into a human-readable string.
 * ZTX: 1 ZTX = 1,000,000 zeta  (6 decimals)
 * ZTP20: caller-supplied decimals (default 6)
 */
function formatAmount(amount: string, asset: string, ztp20Decimals: number): string {
  if (!/^\d+$/.test(amount)) return `${amount} (raw)`
  const raw      = BigInt(amount)
  const isZtx    = asset === 'ZTX'
  const decimals = isZtx ? 6 : ztp20Decimals
  const unit     = isZtx ? 'ZTX' : 'tokens'
  const divisor  = BigInt(10) ** BigInt(decimals)
  const whole    = raw / divisor
  const frac     = raw % divisor
  if (frac === 0n) return `${whole} ${unit}`
  const fracStr  = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole}.${fracStr} ${unit}`
}

// ---------------------------------------------------------------------------
// createMcpTools
// ---------------------------------------------------------------------------

export function createMcpTools(config: McpToolConfig) {
  const { wallet, hsmConfig, node, policy, validBeforeOffset, ztp20Decimals = 6 } = config
  const payOptions: PayOptions = { validBeforeOffset }

  return {
    async fetch_with_payment(input: FetchInput): Promise<FetchResult> {
      const { url, method, headers, body } = input
      const init: RequestInit = {}
      if (method)  init.method  = method
      if (headers) init.headers = headers
      if (body)    init.body    = body

      const response = await fetch(url, init)

      if (response.status !== 402) {
        return { status: response.status, body: await response.text(), paymentMade: false, amountPaid: '', amountPaidHuman: '', asset: '' }
      }

      // APP-M02: guard — at least one signer must be configured
      if (!wallet && !hsmConfig) {
        throw new Error(
          'fetch_with_payment: no signer configured — set X402_PRIVATE_KEY (local) or X402_ADDRESS without X402_PRIVATE_KEY (HSM)'
        )
      }

      let parsed: { x402Version: number; error: string; accepts: PayRequest[] }
      try {
        parsed = await response.json() as typeof parsed
      } catch {
        throw new Error('fetch_with_payment: 402 response did not return valid JSON')
      }

      if (!parsed.accepts?.length) {
        throw new Error('fetch_with_payment: 402 response has no payment options in accepts[]')
      }

      const req = parsed.accepts[0]

      // APP-M01: enforce PaymentPolicy before signing
      if (policy?.maxAmountPerRequest !== undefined) {
        const limit  = parseSafeAmount(policy.maxAmountPerRequest, 'policy.maxAmountPerRequest')
        const amount = parseSafeAmount(req.maxAmountRequired,      'maxAmountRequired')
        if (amount > limit) {
          throw new Error(
            `fetch_with_payment: payment amount ${req.maxAmountRequired} exceeds policy limit ${policy.maxAmountPerRequest}`
          )
        }
      }

      let signerFn: ((blob: string) => Promise<{ signBlob: string; publicKey: string }>) | undefined

      if (hsmConfig) {
        const password = input.hsmPassword ?? hsmConfig.password
        if (!password) {
          throw new Error(
            'fetch_with_payment: HSM mode requires a password — set X402_HSM_PASSWORD or pass hsmPassword in the tool call'
          )
        }
        signerFn = (blob) => HsmSigner.sign(blob, hsmConfig.address, password, hsmConfig.baseUrl)
      }

      const effectiveWallet = wallet ?? { privateKey: '', address: hsmConfig!.address, network: hsmConfig!.network }
      const xPayment = signerFn
        ? await PaymentEngine.pay(req, effectiveWallet, node, payOptions, signerFn)
        : await PaymentEngine.pay(req, effectiveWallet, node, payOptions)

      const retryInit: RequestInit = {
        ...init,
        headers: { ...(headers ?? {}), 'x-payment': xPayment },
      }

      const retryResponse = await fetch(url, retryInit)
      return {
        status:          retryResponse.status,
        body:            await retryResponse.text(),
        paymentMade:     true,
        amountPaid:      req.maxAmountRequired,
        amountPaidHuman: formatAmount(req.maxAmountRequired, req.asset, ztp20Decimals),
        asset:           req.asset,
      }
    },

    get_wallet_info(): WalletInfo {
      if (wallet)    return { address: wallet.address, network: wallet.network, configured: true, signerMode: 'local' }
      if (hsmConfig) return { address: hsmConfig.address, network: hsmConfig.network, configured: true, signerMode: 'hsm' }
      return { address: '', network: '', configured: false, signerMode: 'unconfigured' }
    },

    async check_payment_capability(input: { asset?: string } = {}): Promise<CapabilityResult> {
      const effectiveAddress = wallet?.address ?? hsmConfig?.address
      if (!effectiveAddress) {
        return { capable: false, balance: '0' }
      }

      const asset = input.asset ?? 'ZTX'
      if (asset !== 'ZTX' && !/^Z[A-Za-z0-9]{19,49}$/.test(asset)) {
        throw new Error(
          `check_payment_capability: invalid asset "${asset}" — must be "ZTX" or a valid Zetrix contract address`
        )
      }

      const { balance } = asset === 'ZTX'
        ? await PaymentEngine.fetchAccountInfo(effectiveAddress, node)
        : await PaymentEngine.fetchZTP20Balance(asset, effectiveAddress, node)
      return { capable: BigInt(balance) > 0n, balance }
    },
  }
}
