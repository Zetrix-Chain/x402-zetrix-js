# Example: Resource Server

An Express server that protects API routes with x402 payment middleware using `@x402-zetrix/server`.

A plain `GET /api/data` returns `402 Payment Required`. Any client using `createX402Fetch` (or the x402-zetrix MCP server) automatically pays with ZTX and receives the resource.

## Prerequisites

- Node.js ≥ 18, pnpm ≥ 8
- A funded Zetrix testnet wallet
- A running x402 Facilitator

## Setup

```bash
# Install dependencies (from workspace root)
pnpm install

# Copy the env template
cp .env.example .env
```

Edit `.env` and fill in all the required values.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `3000`) |
| `X402_ADDRESS` | Yes | Your Zetrix wallet address — receives payments |
| `X402_NETWORK` | No | `zetrix:mainnet` or `zetrix:testnet` (default: `zetrix:testnet`) |
| `X402_PAYMENT_AMOUNT` | No | Payment amount in smallest unit (default: `10000` = 0.01 ZTX) |
| `X402_FACILITATOR_URL` | Yes | **Private** Facilitator base URL — server-side only |
| `X402_FACILITATOR_API_KEY` | No | `x-api-key` header for Facilitator API |
| `X402_FACILITATOR_BEARER_TOKEN` | No | `Authorization: Bearer` token for Facilitator API |
| `X402_PREPARE_ENDPOINT` | No | **Public** proxy URL for `/prepare` (gasModel:facilitator only) |

## Run

```bash
# Development (TypeScript via ts-node)
pnpm dev

# Production
pnpm build
pnpm start
```

## Endpoints

| Endpoint | Auth required | Description |
|---|---|---|
| `GET /health` | No | Returns `{ status: "ok" }` |
| `GET /api/data` | Yes — x402 payment | Returns a small JSON payload |
| `GET /api/premium-content` | Yes — x402 payment (10×) | Returns premium content at a higher price |

## Test with curl

```bash
# Should return 402
curl http://localhost:3000/api/data

# Should return 200
curl http://localhost:3000/health
```

## Test with createX402Fetch

```typescript
import { createX402Fetch } from '@x402-zetrix/client'

const myFetch = createX402Fetch({
  wallet: {
    privateKey: process.env.X402_PRIVATE_KEY!,
    address:    process.env.X402_ADDRESS!,
    network:    'zetrix:testnet',
  },
  node: { host: 'test-node.zetrix.com', port: '' },
})

const res = await myFetch('http://localhost:3000/api/data')
console.log(await res.json())
```

## Test with Claude (MCP)

Configure the MCP server in `~/.claude/settings.json` (see [examples/agent/](../agent/)) and prompt:

> "Fetch data from http://localhost:3000/api/data, pay automatically if required."
