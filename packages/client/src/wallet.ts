/**
 * WalletSigner — ED25519 signing wrapper for Zetrix transactions.
 * WalletConfig — loads wallet credentials from environment variables.
 *
 * [IMPL] WalletSigner + WalletConfig
 *
 * Delegates to sdk.transaction.sign() — the SDK owns the correct signing path
 * (Buffer → Uint8Array conversion, nacl.sign.detached) for all key types.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _sdkCtor = require('zetrix-sdk-nodejs')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Matches the Zetrix baas-v2 SignerEntity schema exactly.
 *
 * signBlob  — hex-encoded ED25519 signature
 * publicKey — hex-encoded public key (76 chars for ED25519; 76–3980 per spec)
 */
export interface SignerEntity {
  signBlob:  string
  publicKey: string
}

/**
 * Wallet configuration loaded from environment variables.
 */
export interface WalletConfigData {
  privateKey: string
  address:    string
  network:    string
}

// Single SDK instance — sign() is local (no network calls); host/port are unused.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _Ctor: new (opts: { host: string; port: string }) => any = _sdkCtor.default ?? _sdkCtor
const _sdk = new _Ctor({ host: 'localhost', port: '' }) /* host/port unused — sign() is pure-local */

// ---------------------------------------------------------------------------
// WalletSigner
// ---------------------------------------------------------------------------

/**
 * Signs a Zetrix transaction blob using the Zetrix SDK's signing path.
 *
 * Delegates to sdk.transaction.sign() so the SDK owns Buffer→Uint8Array
 * conversion and nacl.sign.detached — avoiding divergence from the SDK's
 * canonical signing behaviour for all key types (ED25519, SM2, hybrid).
 */
export const WalletSigner = {
  /**
   * Sign a hex-encoded transaction blob.
   *
   * @param blob       - hex-encoded Zetrix transaction blob
   * @param privateKey - Zetrix-encoded private key (e.g. "privBt...")
   * @returns SignerEntity { signBlob, publicKey } matching baas-v2 schema
   * @throws if blob is empty or not a valid even-length hex string, or if privateKey is empty/invalid
   */
  sign(blob: string, privateKey: string): SignerEntity {
    if (!blob) {
      throw new Error('WalletSigner.sign: blob must not be empty')
    }
    if (!/^[0-9a-fA-F]+$/.test(blob) || blob.length % 2 !== 0) {
      throw new Error('WalletSigner.sign: blob must be a valid even-length hex string')
    }
    if (!privateKey) {
      throw new Error('WalletSigner.sign: privateKey must not be empty')
    }

    const result = _sdk.transaction.sign({ privateKeys: [privateKey], blob })
    if (result.errorCode !== 0) {
      throw new Error(`WalletSigner.sign: ${result.errorDesc ?? 'signing failed'} (errorCode: ${result.errorCode})`)
    }

    const { signData, publicKey } = result.result.signatures[0]
    return { signBlob: signData, publicKey }
  },
}

// ---------------------------------------------------------------------------
// WalletConfig
// ---------------------------------------------------------------------------

const VALID_NETWORKS = ['zetrix:mainnet', 'zetrix:testnet'] as const
const DEFAULT_NETWORK: string = 'zetrix:testnet'

/**
 * Loads wallet credentials from environment variables.
 *
 * Required:
 *   X402_PRIVATE_KEY — Zetrix-encoded ED25519 private key
 *   X402_ADDRESS     — Zetrix address (Z...)
 *
 * Optional:
 *   X402_NETWORK — network ID (default: zetrix:testnet)
 *                  Valid values: zetrix:mainnet | zetrix:testnet
 *                  NOTE: The `-1` suffix (e.g. zetrix:testnet-1) is no longer
 *                  accepted — the Facilitator uses the short form.
 */
export const WalletConfig = {
  /**
   * Load and validate wallet config from process.env.
   *
   * @returns WalletConfigData
   * @throws if X402_PRIVATE_KEY or X402_ADDRESS is missing, or network is invalid
   */
  load(): WalletConfigData {
    const privateKey = process.env.X402_PRIVATE_KEY?.trim()
    const address    = process.env.X402_ADDRESS?.trim()
    const network    = (process.env.X402_NETWORK ?? DEFAULT_NETWORK).trim()

    if (!privateKey) {
      throw new Error(
        'WalletConfig.load: X402_PRIVATE_KEY environment variable is required but not set'
      )
    }
    if (!address) {
      throw new Error(
        'WalletConfig.load: X402_ADDRESS environment variable is required but not set'
      )
    }
    if (!(VALID_NETWORKS as readonly string[]).includes(network)) {
      throw new Error(
        `WalletConfig.load: X402_NETWORK "${network}" is not valid; ` +
        `must be one of: ${VALID_NETWORKS.join(', ')}`
      )
    }

    return { privateKey, address, network }
  },
}
