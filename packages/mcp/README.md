# x402-zetrix-mcp

MCP (Model Context Protocol) server that gives AI agents (Claude, and any MCP-compatible LLM) automatic x402 payment capabilities on the Zetrix network.

Three tools exposed:
- **`fetch_with_payment`** — HTTP fetch with automatic 402 payment handling
- **`get_wallet_info`** — return configured wallet address and network
- **`check_payment_capability`** — query ZTX balance from Zetrix RPC

## Quick start (Claude Code / Claude Desktop)

**Option A — Published package (recommended):**

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "npx",
      "args": ["-y", "x402-zetrix-mcp"],
      "env": {
        "X402_PRIVATE_KEY": "your-ed25519-private-key",
        "X402_ADDRESS":     "Z...",
        "X402_NETWORK":     "zetrix:testnet"
      }
    }
  }
}
```

Add to:
- **Claude Code**: `~/.claude/settings.json`
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

**Option B — Local build (development):**

```bash
pnpm --filter x402-zetrix-mcp build
# produces packages/mcp/dist/server-bundle.js
```

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/server-bundle.js"],
      "env": {
        "X402_PRIVATE_KEY": "your-ed25519-private-key",
        "X402_ADDRESS":     "Z...",
        "X402_NETWORK":     "zetrix:testnet"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `X402_PRIVATE_KEY` | Yes | — | ED25519 wallet private key |
| `X402_ADDRESS` | Yes | — | Zetrix wallet address (Z…) |
| `X402_NETWORK` | Yes | — | `zetrix:mainnet` or `zetrix:testnet` |
| `X402_NODE_HOST` | No | auto-derived | RPC node hostname |
| `X402_NODE_PORT` | No | _(empty)_ | RPC node port |
| `X402_MAX_AMOUNT_PER_REQUEST` | No | _(no limit)_ | Max payment per request in smallest unit |
| `X402_ZTP20_DECIMALS` | No | `6` | Decimal places for ZTP20 token display |

## Programmatic use

```typescript
import { createMcpTools } from 'x402-zetrix-mcp'

const tools = createMcpTools({
  wallet: {
    privateKey: process.env.X402_PRIVATE_KEY!,
    address:    process.env.X402_ADDRESS!,
    network:    'zetrix:testnet',
  },
  node: { host: 'test-node.zetrix.com', port: '' },
})

const result = await tools.fetch_with_payment({ url: 'https://api.example.com/data' })
console.log(result.amountPaidHuman)  // e.g. "0.01 ZTX"
```

## Example prompts

> "Use fetch_with_payment to get data from https://api.example.com/data"

> "Fetch the premium dataset. Pay automatically if required."

### Verify wallet before paying

Ask Claude to check funds before spending:

> "Check my wallet status before fetching the paid resource."

Claude calls `get_wallet_info` and `check_payment_capability` to confirm the wallet is funded, then proceeds with `fetch_with_payment`. The response includes `amountPaidHuman` (e.g. `"0.01 ZTX"`) so Claude can report the exact cost.

## Ecosystem

| Package | Purpose |
|---|---|
| [`x402-zetrix-client`](https://www.npmjs.com/package/x402-zetrix-client) | Library: `createX402Fetch` for programmatic use in Node.js/browser apps |
| [`x402-zetrix-server`](https://www.npmjs.com/package/x402-zetrix-server) | Express middleware to gate routes behind ZTX payment |

## Node.js requirement

Node.js ≥ 18.

## License

MIT — [MyEG Services Berhad](https://www.myeg.com.my)
