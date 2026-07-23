# Configuration

All configuration options for the three packages in x402-zetrix-js.

## Environment variables

### Client (`x402-zetrix-client`)

The client package does not read environment variables directly. Credentials are passed programmatically via `createX402Fetch`:

```typescript
const myFetch = createX402Fetch({
  wallet: {
    privateKey: process.env.X402_PRIVATE_KEY!,
    address:    process.env.X402_ADDRESS!,
    network:    process.env.X402_NETWORK ?? 'zetrix:testnet',
  },
  node: {
    host: process.env.X402_NODE_HOST ?? 'test-node.zetrix.com',
    port: process.env.X402_NODE_PORT ?? '',
  },
  policy: {
    maxAmountPerRequest: process.env.X402_MAX_AMOUNT_PER_REQUEST,
  },
})
```

### MCP server (`@x402-zetrix/mcp`)

The MCP server reads these environment variables at startup:

| Variable | Required | Default | Description |
|---|---|---|---|
| `X402_PRIVATE_KEY` | Local mode only | — | ED25519 private key. Set to activate local signing. Omit to use HSM mode. |
| `X402_ADDRESS` | Yes | — | Zetrix address (Z…). In HSM mode this is the HSM account address. |
| `X402_NETWORK` | Yes | — | `zetrix:mainnet` or `zetrix:testnet` |
| `X402_HSM_PASSWORD` | No | — | Pre-configured HSM account password (HSM mode). If not set, caller must pass `hsmPassword` per `fetch_with_payment` call. |
| `X402_HSM_BASE_URL` | No | auto-derived from `X402_NETWORK` | Zetrix HSM API base URL override. Defaults: `https://public-api-sandbox.zetrix.com` (testnet), `https://public-api.zetrix.com` (mainnet). |
| `X402_NODE_HOST` | No | auto-derived from `X402_NETWORK` | RPC node hostname. Defaults: `node.zetrix.com` (mainnet), `test-node.zetrix.com` (testnet) |
| `X402_NODE_PORT` | No | _(empty)_ | RPC node port. Leave empty for default DNS-mapped hosts. Use `18002` (mainnet) or `19333` (testnet) when connecting directly to a node IP. |
| `X402_MAX_AMOUNT_PER_REQUEST` | No | _(no limit)_ | Maximum payment per request in smallest unit |
| `X402_ZTP20_DECIMALS` | No | `6` | Decimal places for ZTP20 token amounts in human-readable output. ZTX is always 6 decimals. |

#### Signer modes

The MCP server selects a signer mode based on which env vars are present:

| Mode | Condition | Description |
|---|---|---|
| **Local** | `X402_PRIVATE_KEY` + `X402_ADDRESS` + `X402_NETWORK` | Signs transactions locally using the ED25519 private key. Simple to set up; suitable for development and automated agents where the private key is already secured. |
| **HSM** | `X402_ADDRESS` + `X402_NETWORK`, no `X402_PRIVATE_KEY` | Delegates signing to the [Zetrix HSM API](https://docs.zetrix.com/en/developer-resources/blockchain-as-a-services-baas/zetrix-service/hsm). The private key never leaves the Zetrix HSM service. Suitable for production deployments where key exposure is a concern. |
| **Unconfigured** | Neither set | `fetch_with_payment` throws when a 402 is received; `check_payment_capability` returns `capable: false`. |

In HSM mode the password can be supplied in two ways:
- **Pre-configured** (`X402_HSM_PASSWORD` set at startup) — fully autonomous; no per-call input needed
- **Runtime** (`X402_HSM_PASSWORD` not set) — the LLM must pass `hsmPassword` in each `fetch_with_payment` call

> ⚠️ **Runtime mode security note:** In runtime mode, `hsmPassword` is passed as a plain argument in every `fetch_with_payment` call over the MCP stdio channel. MCP host tooling (debug logs, audit trails, MCP inspector) may record tool arguments including this password. Use `X402_HSM_PASSWORD` (pre-configured) for unattended or production deployments. Runtime mode is intended for interactive or short-lived sessions only.

### Resource server (using `@x402-zetrix/server`)

The server package does not read environment variables directly. Pass them programmatically:

| Variable (conventional) | Required | Description |
|---|---|---|
| `X402_ADDRESS` | Yes | Recipient address — value of `payTo` |
| `X402_NETWORK` | Yes | Network for `paymentMiddleware` config |
| `X402_FACILITATOR_URL` | Yes | **Private** Facilitator base URL (server-side only) |
| `X402_FACILITATOR_API_KEY` | No | `x-api-key` for Facilitator calls |
| `X402_FACILITATOR_BEARER_TOKEN` | No | `Authorization: Bearer` token for Facilitator calls |
| `X402_PREPARE_ENDPOINT` | No | **Public** proxy URL for `/prepare` — advertised to clients |

---

## Network values

Valid network identifiers:

| Network | Value |
|---|---|
| Zetrix Mainnet | `zetrix:mainnet` |
| Zetrix Testnet | `zetrix:testnet` |

The old `-1` suffix format (`zetrix:mainnet-1`, `zetrix:testnet-1`) is **rejected** by validation.

---

## Amount units

All payment amounts are strings representing the smallest indivisible unit:

**ZTX (native coin — always 6 decimal places):**

| ZTX amount | String value |
|---|---|
| 0.000001 ZTX | `"1"` |
| 0.01 ZTX | `"10000"` |
| 1 ZTX | `"1000000"` |
| 100 ZTX | `"100000000"` |

**ZTP20 tokens** — decimal places depend on the token contract. The MCP server uses `X402_ZTP20_DECIMALS` (default `6`) to format human-readable amounts. For example, with 6 decimals: `"1000000"` → `"1 tokens"`.

Use string, not number, to avoid JavaScript floating-point precision loss on large values.

---

## `PaymentMiddlewareConfig` (server)

Full options for `paymentMiddleware()`:

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `amount` | `string` | Yes | — | Payment amount in smallest unit |
| `asset` | `string` | Yes | — | `"ZTX"` or ZTP20 contract address |
| `payTo` | `string` | Yes | — | Recipient address |
| `network` | `string` | Yes | — | `zetrix:mainnet` or `zetrix:testnet` |
| `facilitatorUrl` | `string` | Yes | — | Private Facilitator base URL |
| `facilitatorApiKey` | `string` | No | — | `x-api-key` header for Facilitator |
| `facilitatorBearerToken` | `string` | No | — | `Authorization: Bearer` token for Facilitator |
| `gasModel` | `"client" \| "facilitator"` | No | `"facilitator"` | Gas model. ZTX requires `"client"`. |
| `gasPrice` | `string` | No | — | Gas price in smallest unit |
| `feeLimit` | `string` | No | — | Fee limit in smallest unit |
| `prepareEndpoint` | `string` | No | — | Public proxy URL for `/prepare` (gasModel:facilitator only) |
| `logger` | `Logger` | No | silent | Pass `console` to enable output |

---

## `X402FetchConfig` (client)

Full options for `createX402Fetch()`:

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `wallet.privateKey` | `string` | Yes | — | ED25519 private key |
| `wallet.address` | `string` | Yes | — | Wallet address |
| `wallet.network` | `string` | Yes | — | Network identifier |
| `node.host` | `string` | Yes | — | RPC node hostname |
| `node.port` | `string` | Yes | — | RPC node port (empty string for DNS-mapped hosts) |
| `policy.maxAmountPerRequest` | `string` | No | — | Max payment per request |
| `validBeforeOffset` | `number` | No | `300` | Transaction expiry offset in seconds |

---

## Gas model selection

| Scenario | `gasModel` | Notes |
|---|---|---|
| Paying with ZTX (native coin) | `"client"` | Payer holds ZTX and pays their own gas — required for native ZTX |
| Paying with ZTP20 token, gas sponsored | `"facilitator"` | Gas paid by Facilitator's wallet; client calls `/prepare` first |
