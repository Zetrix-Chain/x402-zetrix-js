# x402-zetrix-js

NodeJS/TypeScript SDK for the [x402 payment protocol](https://x402.org) on the Zetrix blockchain.

## Packages

| Package | Description |
|---|---|
| [`@x402-zetrix/client`](packages/client) | x402 client — parse 402, sign, retry. Drop-in `x402Fetch` wrapper and `PaymentEngine` |
| [`@x402-zetrix/server`](packages/server) | x402 server — `paymentMiddleware` for Express/Fastify; verify and settle payments |
| [`@x402-zetrix/mcp`](packages/mcp) | MCP tool server — exposes x402 payment capability as tools for AI agents (Claude, etc.) |

## Documentation

See [`docs/`](docs/) for full documentation.

## Requirements

- Node.js ≥ 18
- pnpm ≥ 8

## Setup

```bash
pnpm install
pnpm build
```

## License

MIT — [MyEG Services Berhad](https://www.myeg.com.my)
