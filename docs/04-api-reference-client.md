# API Reference — x402-zetrix-client

Drop-in fetch replacement that transparently handles x402 payment challenges. The library signs and submits Zetrix transactions when a protected API returns `402 Payment Required`.

## `createX402Fetch(config)`

Returns a `fetch`-compatible function with automatic payment handling.

```typescript
import { createX402Fetch } from 'x402-zetrix-client'

const myFetch = createX402Fetch({
  wallet: {
    privateKey: process.env.X402_PRIVATE_KEY!,
    address:    process.env.X402_ADDRESS!,
    network:    'zetrix:testnet',
  },
  node: {
    host: 'test-node.zetrix.com',
    port: '',
  },
})

const res = await myFetch('https://api.example.com/paid')
```

### `X402FetchConfig`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `wallet` | `WalletConfigData` | Yes | — | Wallet credentials used to sign payments |
| `node` | `ZetrixNodeConfig` | Yes | — | Zetrix RPC node connection |
| `policy` | `PaymentPolicy` | No | — | Optional spend limits |
| `validBeforeOffset` | `number` | No | `300` | Seconds from now before a signed transaction expires (gasModel:client only) |

### `WalletConfigData`

| Field | Type | Description |
|---|---|---|
| `privateKey` | `string` | ED25519 private key for signing transactions |
| `address` | `string` | Zetrix wallet address (Z…) |
| `network` | `string` | `"zetrix:mainnet"` or `"zetrix:testnet"` — no `-1` suffix |

### `ZetrixNodeConfig`

| Field | Type | Description |
|---|---|---|
| `host` | `string` | RPC node hostname. Defaults: `node.zetrix.com` (mainnet), `test-node.zetrix.com` (testnet) |
| `port` | `string` | RPC node port. Leave empty when connecting via DNS-mapped default hosts; use `18002` (mainnet) or `19333` (testnet) when connecting directly to a node IP |

### `PaymentPolicy`

| Field | Type | Description |
|---|---|---|
| `maxAmountPerRequest` | `string` | Maximum payment allowed per request in smallest unit. If the server demands more, `PaymentPolicyError` is thrown before signing. |

---

## `InsufficientBalanceError`

Thrown by `createX402Fetch` (and `PaymentEngine.pay`) when the wallet cannot cover the payment before signing. Extends `Error`.

```typescript
import { createX402Fetch, InsufficientBalanceError } from 'x402-zetrix-client'

const myFetch = createX402Fetch({ wallet, node })

try {
  await myFetch('https://api.example.com/paid')
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    console.error(`Need ${err.required} ${err.asset}, have ${err.available}`)
  }
}
```

| Property | Type | Description |
|---|---|---|
| `required` | `string` | Amount needed (smallest unit). For ZTX, this is `amount + feeLimit`. |
| `available` | `string` | Balance currently held by the wallet |
| `asset` | `string` | `"ZTX"` or the ZTP20 contract address |
| `message` | `string` | Human-readable description |

**When is it thrown?**

- `gasModel:client` + ZTX: if ZTX balance < payment amount + estimated gas fee.
- `gasModel:client` + ZTP20: if token balance < payment amount (checked *before* fee estimation), or if ZTX balance < gas fee.
- `gasModel:facilitator` + ZTP20: if token balance < payment amount (facilitator sponsors gas, so no ZTX check).

---

## `PaymentPolicyError`

Thrown by `createX402Fetch` when the server's `maxAmountRequired` exceeds `policy.maxAmountPerRequest`.

```typescript
import { PaymentPolicyError } from 'x402-zetrix-client'

try {
  await myFetch(url)
} catch (err) {
  if (err instanceof PaymentPolicyError) {
    console.error('Payment refused by policy:', err.message)
  }
}
```

---

## `PaymentEngine`

Core orchestrator. Called internally by `createX402Fetch`. Exposed for advanced use.

```typescript
import { PaymentEngine } from 'x402-zetrix-client'

const xPayment = await PaymentEngine.pay(payRequest, walletConfig, nodeConfig)
```

### `PaymentEngine.pay(req, wallet, node, opts?)`

| Parameter | Type | Description |
|---|---|---|
| `req` | `PayRequest` | Payment requirements from the 402 `accepts[]` array |
| `wallet` | `WalletConfigData` | Wallet credentials |
| `node` | `ZetrixNodeConfig` | Zetrix RPC node |
| `opts.validBeforeOffset` | `number` | Seconds offset for `validBefore` (default: 300) |

Returns a base64-encoded `X-Payment` header string. Throws `InsufficientBalanceError` if the wallet cannot cover the payment.

**ZTP20 + gasModel:client — balance check sequence:**
For ZTP20 client-gas payments, `pay()` performs two balance checks:
1. **Pre-fee**: token balance is checked before `estimateFee`. This prevents an opaque `errorCode 151` from contract simulation when the wallet holds zero tokens.
2. **Post-fee**: ZTX gas balance is checked using the estimated `feeLimit`. The token check is skipped here (it already passed in step 1), so only one `sdk.contract.call` is made.

### `PaymentEngine.fetchAccountInfo(address, node)`

Fetch the ZTX balance for a Zetrix address. Returns `{ balance: '0' }` when the account does not exist or any RPC error occurs.

```typescript
const { balance } = await PaymentEngine.fetchAccountInfo(wallet.address, node)
console.log(`ZTX balance: ${balance}`)  // smallest unit (zeta)
```

### `PaymentEngine.fetchZTP20Balance(contractAddress, address, node)`

Fetch the ZTP20 token balance for an address by calling the contract's `balanceOf` method (ZTP20 standard). Network errors from the RPC call propagate to the caller. Returns `{ balance: '0' }` for non-zero `errorCode`, missing response fields, or malformed JSON.

```typescript
const { balance } = await PaymentEngine.fetchZTP20Balance(
  'ZTX3...contractAddress',
  wallet.address,
  node,
)
console.log(`Token balance: ${balance}`)   // smallest unit
```

### `PaymentEngine.checkBalance(req, wallet, node, feeLimit)`

Check that the wallet has sufficient balance to cover a payment. Throws `InsufficientBalanceError` if balance is too low.

| Parameter | Type | Description |
|---|---|---|
| `req` | `PayRequest` | Payment requirements (used for `asset`, `maxAmountRequired`) |
| `wallet` | `WalletConfigData` | Wallet to check |
| `node` | `ZetrixNodeConfig` | Zetrix RPC node |
| `feeLimit` | `string` | Gas fee limit in smallest unit. Pass `'0'` to skip the ZTX gas check (e.g. gasModel:facilitator). |

**Behaviour by asset:**
- `ZTX`: checks `ZTX balance >= maxAmountRequired + feeLimit`
- ZTP20: checks `token balance >= maxAmountRequired`; then if `feeLimit > 0`, checks `ZTX balance >= feeLimit`

---

## `WalletSigner`

Low-level ED25519 signing. Used internally by `PaymentEngine`. All methods are static.

```typescript
import { WalletSigner } from 'x402-zetrix-client'

const { signBlob, publicKey } = WalletSigner.sign(blob, wallet.privateKey)
```

| Parameter | Type | Description |
|---|---|---|
| `blob` | `string` | Hex-encoded Zetrix transaction blob from `BlobBuilder.build` |
| `privateKey` | `string` | Zetrix-encoded ED25519 private key (e.g. `"privBt…"`) |

Returns `{ signBlob, publicKey }` — both hex-encoded strings matching the Zetrix baas-v2 `SignerEntity` schema.

---

## `BlobBuilder`

Builds a Zetrix transaction blob for gasModel:client payments. The nonce is provided by the caller (use `PaymentEngine.fetchNonce()` to retrieve it). All methods are static.

```typescript
import { BlobBuilder } from 'x402-zetrix-client'

const { blob } = BlobBuilder.build({
  asset:         'ZTX',           // 'ZTX' or a ZTP20 contract address
  payTo,
  amount:        amountStr,
  clientAddress: wallet.address,
  nonce,                          // from PaymentEngine.fetchNonce()
  gasPrice:      '1000',
  feeLimit:      '1000000',
})
```

---

## `BlobDecoder`

Verifies and decodes a Facilitator-prepared blob (gasModel:facilitator).

```typescript
import { BlobDecoder, BlobVerificationError } from 'x402-zetrix-client'
```

### `BlobVerificationError`

Thrown when blob verification fails (hash mismatch, signature invalid, expired).

---

## `FacilitatorPrepareClient`

HTTP client for `POST /prepare`. Called internally for gasModel:facilitator flows.

```typescript
import { FacilitatorPrepareClient } from 'x402-zetrix-client'

const result = await FacilitatorPrepareClient.prepare(payRequest, walletAddress, prepareEndpoint)
```

---

## Types

### `PayRequest`

Payment requirements from the `accepts[]` array in a 402 response:

| Field | Type | Description |
|---|---|---|
| `scheme` | `string` | Payment scheme identifier |
| `network` | `string` | Target network |
| `maxAmountRequired` | `string` | Maximum amount in smallest unit |
| `asset` | `string` | Asset code or contract address |
| `payTo` | `string` | Recipient address |
| `gasModel` | `string` | `"client"` or `"facilitator"` |
| `gasPrice` | `string` | Gas price in smallest unit |
| `feeLimit` | `string` | Fee limit in smallest unit |
| `prepareEndpoint` | `string \| undefined` | Public proxy URL for `/prepare` (facilitator gas model only) |
| `x402Version` | `number` | Protocol version |

### `XPaymentPayload` (union)

- **`SignedTransactionPayload`** — gasModel:client. Contains `transactionBlob`, `signatures`, `validBefore`.
- **`FacilitatorPreparedPayload`** — gasModel:facilitator. Contains `blobId`, `blob`, `hash`, `clientSignature`, `validBefore`.
