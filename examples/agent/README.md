# Example: AI Agent with Automatic Payments

An AI agent powered by Claude that accesses x402-protected APIs automatically. When the agent needs data from a paid API, it calls `fetch_with_payment` which signs and submits a ZTX payment on its behalf — no manual intervention required.

Two usage modes are included:

| Mode | Description |
|---|---|
| **Programmatic** (`src/agent.ts`) | Node.js script using the Anthropic SDK. Claude runs in a loop, calling payment tools when it encounters a 402. |
| **MCP** (`mcp-config.json`) | Configure the MCP server in Claude Desktop or Claude Code so the AI can call the tools directly in the chat UI. |

## Prerequisites

- Node.js ≥ 18, pnpm ≥ 8
- A funded Zetrix testnet wallet
- An Anthropic API key (for the programmatic mode)
- The resource server running: `pnpm --filter @x402-zetrix/example-resource-server dev`

## Mode 1 — Programmatic agent

### Setup

```bash
# From workspace root
pnpm install

# In this directory
cp .env.example .env
```

Edit `.env` and fill in:
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `X402_PRIVATE_KEY`, `X402_ADDRESS`, `X402_NETWORK` — your Zetrix wallet

### Run

```bash
# Default prompt (fetches RESOURCE_URL from .env)
pnpm dev

# Custom prompt
pnpm dev -- --prompt "Fetch data from http://localhost:3000/api/data and tell me what you got"

# Premium content (higher price)
pnpm dev -- --prompt "Get the premium content from http://localhost:3000/api/premium-content"
```

### What you'll see

```
User: Fetch data from http://localhost:3000/api/data. If the API requires payment, pay automatically.

[tool] get_wallet_info({})
[tool result] {"address":"Z...","network":"zetrix:testnet","configured":true}

[tool] fetch_with_payment({"url":"http://localhost:3000/api/data"})
[tool result] {"status":200,"body":"{\"message\":\"You have successfully...","paymentMade":true,"amountPaid":"10000","asset":"ZTX"}

Claude: I successfully accessed the paid API. The resource returned the following data:
{
  "message": "You have successfully accessed a paid resource.",
  "data": { "value": 42, "timestamp": "2026-06-05T..." },
  "paidWith": "ZTX",
  "amount": "10000"
}
A payment of 10000 units of ZTX was made automatically from your wallet.
```

---

## Mode 2 — MCP server (Claude Desktop / Claude Code)

### Step 1 — Build the MCP server

```bash
pnpm --filter @x402-zetrix/mcp build
```

### Step 2 — Configure Claude

Copy the relevant section from `mcp-config.json` into your Claude config file and update the paths and env vars:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"],
      "env": {
        "X402_PRIVATE_KEY": "your-private-key",
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet"
      }
    }
  }
}
```

**Claude Desktop** — same structure, file location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 3 — Start the resource server

```bash
pnpm --filter @x402-zetrix/example-resource-server dev
```

### Step 4 — Prompt Claude

Restart Claude after updating the config, then:

> "Fetch data from http://localhost:3000/api/data. Pay automatically if it requires payment."

Claude will call `get_wallet_info` to verify the wallet, then `fetch_with_payment` to access the resource.

---

## Environment variables (programmatic mode)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `X402_PRIVATE_KEY` | Yes | Zetrix wallet private key |
| `X402_ADDRESS` | Yes | Zetrix wallet address (Z…) |
| `X402_NETWORK` | Yes | `zetrix:mainnet` or `zetrix:testnet` |
| `X402_NODE_HOST` | No | RPC node hostname (auto-derived from network) |
| `X402_NODE_PORT` | No | RPC node port (empty for DNS-mapped hosts) |
| `X402_MAX_AMOUNT_PER_REQUEST` | No | Maximum payment per request in smallest unit |
| `RESOURCE_URL` | No | Default URL to fetch (default: `http://localhost:3000/api/data`) |
| `AGENT_PROMPT` | No | Default agent prompt (overridden by `--prompt` flag) |

---

## How it works

```
User prompt
    │
    ▼
Claude (Anthropic API)
    │
    │  Tool call: get_wallet_info()
    │─────────────────────────────────>  Wallet info returned
    │
    │  Tool call: fetch_with_payment(url)
    │─────────────────────────────────>
    │                                    fetch(url) → 402 + accepts[]
    │                                    Sign ZTX transaction (BlobBuilder)
    │                                    fetch(url, X-Payment header) → 200
    │<─────────────────────────────────  { status: 200, body: "...", paymentMade: true }
    │
    ▼
Claude response with data
```
