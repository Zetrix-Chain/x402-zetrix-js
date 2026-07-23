# API Reference — x402-zetrix-mcp

MCP (Model Context Protocol) server that exposes x402 Zetrix payment tools to AI agents (Claude, and any MCP-compatible LLM client).

## Starting the server

**From the published npm package (recommended):**

```bash
npx x402-zetrix-mcp
```

`npx` downloads and runs the package on demand — no separate install step required. To install it explicitly instead (e.g. to put `x402-zetrix-mcp` on your `PATH`):

```bash
npm install -g x402-zetrix-mcp
# or, as a project dependency:
npm install x402-zetrix-mcp
```

**From a local build (development):**

```bash
# Build first
pnpm --filter x402-zetrix-mcp build

# Run the self-contained bundle
node packages/mcp/dist/server-bundle.js
```

The server uses **stdio transport** — it is launched as a child process by the MCP host (Claude Desktop, Claude Code, or any compatible client).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `X402_PRIVATE_KEY` | Local mode only | — | ED25519 private key. Set this to activate **local** signing. Omit to use HSM mode. |
| `X402_ADDRESS` | Yes | — | Zetrix wallet address (Z…). In HSM mode this is the HSM account address. |
| `X402_NETWORK` | Yes | — | Network identifier: `zetrix:mainnet` or `zetrix:testnet` |
| `X402_HSM_PASSWORD` | No | — | Pre-configured HSM account password (HSM mode). If omitted, HSM mode requires `hsmPassword` in each `fetch_with_payment` call. |
| `X402_HSM_BASE_URL` | No | auto-derived from `X402_NETWORK` | Override the Zetrix HSM API base URL. Defaults: `https://public-api-sandbox.zetrix.com` (testnet), `https://public-api.zetrix.com` (mainnet). |
| `X402_NODE_HOST` | No | `node.zetrix.com` (mainnet) / `test-node.zetrix.com` (testnet) | Zetrix RPC node hostname — auto-derived from `X402_NETWORK` if not set |
| `X402_NODE_PORT` | No | _(empty)_ | RPC node port — only set when connecting directly to a node IP (mainnet: `18002`, testnet: `19333`). Leave empty when using default DNS-mapped hosts. |
| `X402_MAX_AMOUNT_PER_REQUEST` | No | _(no limit)_ | Maximum payment allowed per request in smallest unit (e.g. `1000000` = 1 ZTX) |
| `X402_ZTP20_DECIMALS` | No | `6` | Decimal places for ZTP20 token amounts in human-readable output. ZTX is always 6 decimals. |

The MCP server supports two signing modes, selected by which env vars are set:

| Mode | Condition | Description |
|---|---|---|
| **Local** | `X402_PRIVATE_KEY` + `X402_ADDRESS` + `X402_NETWORK` | Signs transactions with the local private key |
| **HSM** | `X402_ADDRESS` + `X402_NETWORK` (no `X402_PRIVATE_KEY`) | Delegates signing to the Zetrix HSM API — private key never leaves the HSM |
| **Unconfigured** | Neither set | `fetch_with_payment` throws on 402; `check_payment_capability` returns `capable: false` |

## Configuring in Claude Desktop

**Local mode (recommended for development)** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

**HSM mode — pre-configured password** (private key never leaves the HSM service):

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "npx",
      "args": ["x402-zetrix-mcp"],
      "env": {
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet",
        "X402_HSM_PASSWORD": "your-hsm-password"
      }
    }
  }
}
```

**HSM mode — runtime password** (omit `X402_HSM_PASSWORD`; Claude passes `hsmPassword` in each `fetch_with_payment` call):

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "npx",
      "args": ["x402-zetrix-mcp"],
      "env": {
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet"
      }
    }
  }
}
```

> ⚠️ **Runtime mode security note:** In runtime mode, `hsmPassword` is passed as a plain argument in every `fetch_with_payment` call over the MCP stdio channel. MCP host tooling (debug logs, audit trails, MCP inspector) may record tool arguments including this password. Use `X402_HSM_PASSWORD` (pre-configured mode) for unattended or production deployments. Runtime mode is intended for interactive or short-lived sessions only.

**Local development build:**

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

## Configuring in Claude Code

**Local mode (recommended for development)** — add to `~/.claude/settings.json`:

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

**HSM mode — pre-configured password:**

```json
{
  "mcpServers": {
    "x402-zetrix": {
      "command": "npx",
      "args": ["x402-zetrix-mcp"],
      "env": {
        "X402_ADDRESS": "Z...",
        "X402_NETWORK": "zetrix:testnet",
        "X402_HSM_PASSWORD": "your-hsm-password"
      }
    }
  }
}
```

**Local development build:**

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

---

## Tools

### `fetch_with_payment`

Perform an HTTP request with automatic x402 payment handling. If the server responds with 402, pays using the configured wallet and retries.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | Yes | Request URL |
| `method` | `string` | No | HTTP method (default `GET`) |
| `headers` | `object` | No | Request headers as key-value pairs |
| `body` | `string` | No | Request body |
| `hsmPassword` | `string` | No | HSM account password. Required in HSM mode when `X402_HSM_PASSWORD` is not configured. Ignored in local mode. |

**Output:**

| Field | Type | Description |
|---|---|---|
| `status` | `number` | HTTP response status code |
| `body` | `string` | Response body text |
| `paymentMade` | `boolean` | `true` if a payment was made to access the resource |
| `amountPaid` | `string` | Amount paid in smallest unit (e.g. `"1000000"`) — empty string if no payment |
| `amountPaidHuman` | `string` | Human-readable amount (e.g. `"1 ZTX"`, `"0.01 tokens"`) — empty string if no payment |
| `asset` | `string` | Asset paid (e.g. `"ZTX"`) — empty string if no payment |

**Policy enforcement:** If `X402_MAX_AMOUNT_PER_REQUEST` is set and the server demands more, the tool throws before signing.

**Example prompt to Claude:**
> "Fetch data from http://localhost:3000/api/data and pay automatically if required."

---

### `get_wallet_info`

Return the configured wallet address and network.

**Input:** _(none)_

**Output:**

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Wallet/HSM address, or `""` if unconfigured |
| `network` | `string` | Network identifier, or `""` if unconfigured |
| `configured` | `boolean` | `true` if a signer (local or HSM) is configured |
| `signerMode` | `string` | `"local"`, `"hsm"`, or `"unconfigured"` |

---

### `check_payment_capability`

Query the Zetrix RPC node for the wallet balance and report whether payments are possible. Supports both ZTX (native coin) and ZTP20 token balances.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `asset` | `string` | No | `"ZTX"` to check native coin balance (default), or a ZTP20 contract address to check token balance |

**Output:**

| Field | Type | Description |
|---|---|---|
| `capable` | `boolean` | `true` if wallet is configured and balance > 0 |
| `balance` | `string` | Current balance in smallest unit, or `"0"` if unconfigured or account not found |

**Examples:**

Check ZTX balance (default):
> "Check my wallet balance before paying."

Check a ZTP20 token balance:
> "Check my ZTP20 token balance for contract ZTX3...abc before paying."

Claude calls `check_payment_capability({ asset: "ZTX3...abc" })` and reports the token balance.
