/**
 * [TEST] WalletSigner + WalletConfig — RED phase
 *
 * Tests for WalletSigner.sign() and WalletConfig.load().
 * These tests MUST FAIL until the implementation is written.
 *
 * WalletSigner wraps zetrix-encryption-nodejs ED25519 signing and returns
 * a SignerEntity matching the Zetrix baas-v2 schema: { signBlob, publicKey }.
 *
 * WalletConfig loads wallet credentials from environment variables:
 * X402_PRIVATE_KEY, X402_ADDRESS, X402_NETWORK (optional, default: zetrix:testnet).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { signature: zetrixSig, keypair: zetrixKeypair } = require('zetrix-encryption-nodejs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ZetrixKeyPair = require('zetrix-encryption-nodejs/lib/keypair')

import { WalletSigner, WalletConfig } from '../wallet'

// ---------------------------------------------------------------------------
// Test fixtures — ephemeral ED25519 keypair generated at test-suite load time.
// Never commit real keys. TEST_PUBLIC_KEY is derived the same way wallet.ts
// does it (ZetrixKeyPair.getEncPublicKey) so the assertion stays meaningful.
// ---------------------------------------------------------------------------
const _kp = zetrixKeypair.getKeyPair('ed25519')
const TEST_PRIVATE_KEY: string = _kp.encPrivateKey
const TEST_PUBLIC_KEY:  string = ZetrixKeyPair.getEncPublicKey(TEST_PRIVATE_KEY)
const TEST_ADDRESS:     string = _kp.address
const TEST_BLOB        = '0a3cdeadbeef01020304050607080900aabbccdd' // simulated Zetrix tx blob (hex)

// ---------------------------------------------------------------------------
// WalletSigner
// ---------------------------------------------------------------------------
describe('WalletSigner', () => {
  describe('sign(blob, privateKey)', () => {
    it('returns an object with signBlob and publicKey properties', () => {
      const result = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      expect(result).toHaveProperty('signBlob')
      expect(result).toHaveProperty('publicKey')
    })

    it('signBlob is a non-empty lowercase hex string (ED25519 = 64 bytes = 128 hex chars)', () => {
      const { signBlob } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      expect(typeof signBlob).toBe('string')
      expect(signBlob.length).toBe(128)
      expect(signBlob).toMatch(/^[0-9a-f]+$/)
    })

    it('publicKey is a non-empty lowercase hex string (76–3980 chars per baas-v2 spec)', () => {
      const { publicKey } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      expect(typeof publicKey).toBe('string')
      expect(publicKey.length).toBeGreaterThanOrEqual(76)
      expect(publicKey.length).toBeLessThanOrEqual(3980)
      expect(publicKey).toMatch(/^[0-9a-f]+$/)
    })

    it('publicKey matches the key derived from the given private key', () => {
      const { publicKey } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      expect(publicKey).toBe(TEST_PUBLIC_KEY)
    })

    it('returns a signature that verifies against the returned publicKey using zetrix-encryption-nodejs', () => {
      const { signBlob, publicKey } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      // WalletSigner signs the hex-decoded bytes (not the raw hex string).
      // nacl.sign.detached() requires a typed array — passing the hex string
      // directly causes string-to-byte coercion issues where different hex
      // strings of the same length can produce the same signature.
      // We pass the same bytes here so the verify call matches what was signed.
      const blobBytes = Buffer.from(TEST_BLOB, 'hex')
      const isValid = zetrixSig.verify(blobBytes, signBlob, publicKey)
      expect(isValid).toBe(true)
    })

    it('different blobs produce different signatures', () => {
      const blob1 = '0a3cdeadbeef'
      const blob2 = '0a3ccafebabe'

      const { signBlob: sig1 } = WalletSigner.sign(blob1, TEST_PRIVATE_KEY)
      const { signBlob: sig2 } = WalletSigner.sign(blob2, TEST_PRIVATE_KEY)

      expect(sig1).not.toBe(sig2)
    })

    it('same blob + same key always produces the same signature (ED25519 is deterministic)', () => {
      const { signBlob: sig1 } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)
      const { signBlob: sig2 } = WalletSigner.sign(TEST_BLOB, TEST_PRIVATE_KEY)

      expect(sig1).toBe(sig2)
    })

    it('throws when blob is an empty string', () => {
      expect(() => WalletSigner.sign('', TEST_PRIVATE_KEY)).toThrow()
    })

    it('throws when blob has odd-length hex (would mis-decode)', () => {
      expect(() => WalletSigner.sign('abc', TEST_PRIVATE_KEY)).toThrow(/hex/)
    })

    it('throws when blob contains non-hex characters', () => {
      expect(() => WalletSigner.sign('xyz12345', TEST_PRIVATE_KEY)).toThrow(/hex/)
    })

    it('throws when privateKey is an empty string', () => {
      expect(() => WalletSigner.sign(TEST_BLOB, '')).toThrow()
    })

    it('throws when privateKey is malformed (not a valid Zetrix key)', () => {
      expect(() => WalletSigner.sign(TEST_BLOB, 'notavalidprivkey')).toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// WalletConfig
// ---------------------------------------------------------------------------
describe('WalletConfig', () => {
  // Save and restore env vars around each test so they don't leak
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      X402_PRIVATE_KEY: process.env.X402_PRIVATE_KEY,
      X402_ADDRESS:     process.env.X402_ADDRESS,
      X402_NETWORK:     process.env.X402_NETWORK,
    }
  })

  afterEach(() => {
    if (savedEnv.X402_PRIVATE_KEY === undefined) delete process.env.X402_PRIVATE_KEY
    else process.env.X402_PRIVATE_KEY = savedEnv.X402_PRIVATE_KEY

    if (savedEnv.X402_ADDRESS === undefined) delete process.env.X402_ADDRESS
    else process.env.X402_ADDRESS = savedEnv.X402_ADDRESS

    if (savedEnv.X402_NETWORK === undefined) delete process.env.X402_NETWORK
    else process.env.X402_NETWORK = savedEnv.X402_NETWORK
  })

  describe('load()', () => {
    it('reads privateKey from X402_PRIVATE_KEY environment variable', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS

      const config = WalletConfig.load()

      expect(config.privateKey).toBe(TEST_PRIVATE_KEY)
    })

    it('reads address from X402_ADDRESS environment variable', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS

      const config = WalletConfig.load()

      expect(config.address).toBe(TEST_ADDRESS)
    })

    it('uses zetrix:testnet as default network when X402_NETWORK is not set', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS
      delete process.env.X402_NETWORK

      const config = WalletConfig.load()

      // C2: Facilitator uses short form — no -1 suffix
      expect(config.network).toBe('zetrix:testnet')
    })

    it('reads network from X402_NETWORK when set to mainnet', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS
      process.env.X402_NETWORK     = 'zetrix:mainnet'

      const config = WalletConfig.load()

      // C2: Facilitator uses short form — no -1 suffix
      expect(config.network).toBe('zetrix:mainnet')
    })

    it('rejects old network ID format with -1 suffix', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS
      process.env.X402_NETWORK     = 'zetrix:mainnet-1'

      // C2: old format is no longer valid
      expect(() => WalletConfig.load()).toThrow()
    })

    it('throws a descriptive error when X402_PRIVATE_KEY is missing', () => {
      delete process.env.X402_PRIVATE_KEY
      process.env.X402_ADDRESS = TEST_ADDRESS

      expect(() => WalletConfig.load()).toThrow(/X402_PRIVATE_KEY/)
    })

    it('throws a descriptive error when X402_ADDRESS is missing', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      delete process.env.X402_ADDRESS

      expect(() => WalletConfig.load()).toThrow(/X402_ADDRESS/)
    })

    it('trims trailing newline from X402_PRIVATE_KEY', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY + '\n'
      process.env.X402_ADDRESS     = TEST_ADDRESS

      const config = WalletConfig.load()

      expect(config.privateKey).toBe(TEST_PRIVATE_KEY)
    })

    it('trims trailing whitespace from X402_ADDRESS', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS + ' '

      const config = WalletConfig.load()

      expect(config.address).toBe(TEST_ADDRESS)
    })

    it('trims trailing whitespace from X402_NETWORK', () => {
      process.env.X402_PRIVATE_KEY = TEST_PRIVATE_KEY
      process.env.X402_ADDRESS     = TEST_ADDRESS
      process.env.X402_NETWORK     = 'zetrix:testnet '

      const config = WalletConfig.load()

      expect(config.network).toBe('zetrix:testnet')
    })
  })
})
