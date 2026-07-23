# x402-zetrix-server

Express middleware for protecting routes with x402 payment requirements on the Zetrix network. Returns `402 Payment Required` with a machine-readable `accepts[]` body; verifies and settles payments through a Facilitator.

## Install

```bash
npm install x402-zetrix-server
# or
pnpm add x402-zetrix-server
```

Express is a peer dependency — install it separately if not already present:

```bash
npm install express
```

## Quick start

```typescript
import express from 'express'
import { paymentMiddleware } from 'x402-zetrix-server'

const app = express()

app.get(
  '/api/data',
  paymentMiddleware({
    amount:                 '10000',           // 0.01 ZTX
    asset:                  'ZTX',
    payTo:                  process.env.X402_ADDRESS!,
    network:                'zetrix:testnet',
    facilitatorUrl:         process.env.X402_FACILITATOR_URL!,
    facilitatorApiKey:      process.env.X402_FACILITATOR_API_KEY,
    facilitatorBearerToken: process.env.X402_FACILITATOR_BEARER_TOKEN,
    gasModel:               'client',
  }),
  (_req, res) => {
    res.json({ data: 'protected resource' })
  },
)

app.listen(3000)
```

A plain `GET /api/data` without payment returns:

```json
{
  "x402Version": 2,
  "error": "X-Payment header required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "zetrix:testnet",
      "maxAmountRequired": "10000",
      "asset": "ZTX",
      "payTo": "Z...",
      "gasModel": "client"
    }
  ]
}
```

## Configuration

| Field | Required | Description |
|---|---|---|
| `amount` | Yes | Payment amount in smallest unit (e.g. `"10000"` = 0.01 ZTX) |
| `asset` | Yes | `"ZTX"` or ZTP20 contract address |
| `payTo` | Yes | Recipient Zetrix address |
| `network` | Yes | `"zetrix:mainnet"` or `"zetrix:testnet"` |
| `facilitatorUrl` | Yes | Private Facilitator base URL (server-side only) |
| `facilitatorApiKey` | No | `x-api-key` header for Facilitator |
| `facilitatorBearerToken` | No | `Authorization: Bearer` token for Facilitator |
| `gasModel` | No | `"client"` (ZTX native) or `"facilitator"` (ZTP20 sponsored). Default: `"facilitator"` |
| `logger` | No | Pass `console` to enable logging |

## Environment variables

| Variable | Description |
|---|---|
| `X402_ADDRESS` | Recipient Zetrix wallet address (`payTo` value) |
| `X402_FACILITATOR_URL` | Private Facilitator base URL (server-side only, never exposed to clients) |
| `X402_FACILITATOR_API_KEY` | `x-api-key` header for Facilitator (optional) |
| `X402_FACILITATOR_BEARER_TOKEN` | `Authorization: Bearer` token for Facilitator (optional) |

## How it works

```
Client                    Resource Server           Facilitator
  │                              │                       │
  │──── GET /api/data ──────────>│                       │
  │                              │                       │
  │<─── 402 + accepts[] ─────────│                       │
  │                              │                       │
  │  (client signs ZTX tx)       │                       │
  │                              │                       │
  │──── GET /api/data ──────────>│                       │
  │     X-Payment: <blob>        │                       │
  │                              │──── POST /verify ────>│
  │                              │<─── isValid:true ─────│
  │                              │                       │
  │<─── 200 + data ──────────────│                       │
  │                              │──── POST /settle ────>│ (async)
```

## Ecosystem

| Package | Purpose |
|---|---|
| [`x402-zetrix-client`](https://www.npmjs.com/package/x402-zetrix-client) | Client-side: auto-pay 402 responses with a Zetrix wallet |
| [`x402-zetrix-mcp`](https://www.npmjs.com/package/x402-zetrix-mcp) | MCP server: give AI agents (Claude, etc.) automatic payment capabilities |

## Node.js requirement

Node.js ≥ 18.

## License

MIT — [MyEG Services Berhad](https://www.myeg.com.my)
