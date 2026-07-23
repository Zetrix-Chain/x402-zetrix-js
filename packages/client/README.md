# x402-zetrix-client

x402 payment client for Zetrix. Wraps the native `fetch` API with automatic 402-payment handling — detect, sign, and retry with a single call.

## Install

```bash
npm install x402-zetrix-client
# or
pnpm add x402-zetrix-client
```

## Quick start

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

// Works like fetch — pays automatically on 402
const res = await myFetch('https://api.example.com/paid-resource')
const data = await res.json()
```

## Spend limit

```typescript
const myFetch = createX402Fetch({
  wallet: { ... },
  node:   { ... },
  policy: {
    maxAmountPerRequest: '50000',  // refuse anything over 0.05 ZTX
  },
})
```

## Environment variables (conventional)

| Variable | Description |
|---|---|
| `X402_PRIVATE_KEY` | ED25519 wallet private key |
| `X402_ADDRESS` | Zetrix wallet address (Z…) |
| `X402_NETWORK` | `zetrix:mainnet` or `zetrix:testnet` |
| `X402_NODE_HOST` | RPC node hostname |
| `X402_NODE_PORT` | RPC node port (empty for DNS-mapped hosts) |

## How it works

```
Client                    Resource Server           Facilitator
  │                              │                       │
  │──── GET /api/data ──────────>│                       │
  │                              │                       │
  │<─── 402 + accepts[] ─────────│                       │
  │                              │                       │
  │  (sign ZTX transaction)      │                       │
  │                              │                       │
  │──── GET /api/data ──────────>│                       │
  │     X-Payment: <blob>        │                       │
  │                              │──── POST /verify ────>│
  │                              │<─── isValid:true ─────│
  │                              │                       │
  │<─── 200 + data ──────────────│                       │
  │     X-Payment-Response: ...  │                       │
  │                              │──── POST /settle ────>│ (async)
```

`createX402Fetch` handles the entire flow transparently — your application code only sees the final `200` response.

## Ecosystem

| Package | Purpose |
|---|---|
| [`x402-zetrix-server`](https://www.npmjs.com/package/x402-zetrix-server) | Server-side: Express middleware to gate routes behind ZTX payment |
| [`x402-zetrix-mcp`](https://www.npmjs.com/package/x402-zetrix-mcp) | MCP server: give AI agents (Claude, etc.) automatic payment capabilities |

## Node.js requirement

Node.js ≥ 18 (uses native `fetch`).

## License

MIT — [MyEG Services Berhad](https://www.myeg.com.my)
