# Quickstart

Three tracks to get up and running with x402-zetrix-js.

## Prerequisites

- Node.js ≥ 18, pnpm ≥ 8
- A funded Zetrix testnet wallet (see [x402-zetrix-development.md](x402-zetrix-development.md))
- A running x402 Facilitator instance

---

## Track 1 — Protect an Express route (resource server)

Install the server package:

```bash
pnpm add x402-zetrix-server express
```

Create your server:

```typescript
import express from 'express'
import { paymentMiddleware } from 'x402-zetrix-server'

const app = express()

// Free endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Protected endpoint — requires ZTX payment
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

app.listen(3000, () => console.log('listening on :3000'))
```

Set your environment variables:

```bash
X402_ADDRESS=Z...
X402_FACILITATOR_URL=https://facilitator.internal/api/v1/facilitator
X402_FACILITATOR_API_KEY=your-api-key
X402_FACILITATOR_BEARER_TOKEN=your-bearer-token
```

A plain `GET /api/data` now returns `402 Payment Required`:

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

See the full working example in [`examples/resource-server/`](../examples/resource-server/).

---

## Track 2 — Access a paid API (library client)

Install the client package:

```bash
pnpm add x402-zetrix-client
```

Replace `fetch` with `createX402Fetch`:

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

// Payment is handled automatically
const res = await myFetch('http://localhost:3000/api/data')
const data = await res.json()
console.log(data)
```

Set your environment variables:

```bash
X402_PRIVATE_KEY=your-ed25519-private-key
X402_ADDRESS=Z...
X402_NETWORK=zetrix:testnet
```

To add a spend limit:

```typescript
const myFetch = createX402Fetch({
  wallet: { ... },
  node:   { ... },
  policy: {
    maxAmountPerRequest: '50000',   // refuse anything over 0.05 ZTX
  },
})
```

To handle insufficient balance gracefully:

```typescript
import { createX402Fetch, InsufficientBalanceError } from 'x402-zetrix-client'

const myFetch = createX402Fetch({ wallet, node })

try {
  const res = await myFetch('https://api.example.com/paid')
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    // Clean error before any signing happens
    console.error(
      `Cannot pay: need ${err.required} ${err.asset}, wallet has ${err.available}`
    )
  }
}
```

`InsufficientBalanceError` is thrown before signing, so no transaction is broadcast if the wallet is underfunded.

---

## Track 3 — AI agent with automatic payments (MCP)

This track wires up Claude (or any MCP-compatible LLM) so it can call x402-protected APIs automatically when prompted.

### Step 1 — Set up the MCP server

**Option A — Published package (simplest, after npm publish):**

No build step needed. Skip to Step 2 and use `npx x402-zetrix-mcp` as the command.

**Option B — Local build (development):**

```bash
pnpm --filter @x402-zetrix/mcp build
# produces packages/mcp/dist/server-bundle.js — a self-contained Node bundle
```

### Step 2 — Configure Claude Code

Add to `~/.claude/settings.json`:

**Published package:**

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "npx",
      "args": ["x402-zetrix-mcp"],
      "env": {
        "X402_PRIVATE_KEY": "your-private-key",
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet"
      }
    }
  }
}
```

**Local build:**

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/server-bundle.js"],
      "env": {
        "X402_PRIVATE_KEY": "your-private-key",
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet"
      }
    }
  }
}
```

### Step 3 — Start the resource server

```bash
cd examples/resource-server
cp .env.example .env
# fill in your credentials
node dist/server.js
```

### Step 4 — Prompt Claude

Claude can now access x402-protected APIs:

> "Use fetch_with_payment to get data from http://localhost:3000/api/data"

Or naturally:

> "Fetch the data from the API at http://localhost:3000/api/data. Pay automatically if required."

Claude calls `fetch_with_payment`, which detects the 402 response, signs the Zetrix transaction with your wallet, retries the request, and returns the data — all without manual intervention. The result includes `amountPaidHuman` (e.g. `"0.01 ZTX"`) so Claude can report the exact cost in a human-readable format.

### Verify the wallet before paying

Ask Claude to check before making payments:

> "Check my wallet status before fetching the paid resource."

Claude calls `get_wallet_info` and `check_payment_capability` to confirm the wallet is funded, then proceeds with `fetch_with_payment`.

See the full working example in [`examples/agent/`](../examples/agent/).

---

## What happens under the hood

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
  │                              │<─── 202 QUEUED ───────│
```
