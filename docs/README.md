# x402-zetrix-js Documentation

NodeJS/TypeScript SDK for the x402 payment protocol on Zetrix.

## Status

| Area | Status | See |
|---|---|---|
| @x402-zetrix/client | In development | §04 |
| @x402-zetrix/server | In development | §05 |
| @x402-zetrix/mcp | In development | §06 |

## Document index

| # | File | Purpose | Audience |
|---|---|---|---|
| 00 | [00-overview.md](00-overview.md) | Repo scope, package inventory, non-goals | All readers — start here |
| 01 | [01-architecture.md](01-architecture.md) | Package dependency graph, integration mode diagram (Mode A vs Mode B) | Architects, developers |
| 02 | [02-package-structure.md](02-package-structure.md) | pnpm workspace layout, TypeScript config, build scripts | Developers |
| 03 | [03-flows.md](03-flows.md) | Sequence diagrams: Mode A (interceptor), Mode B (MCP), server middleware flow | Developers, integrators |
| 04 | [04-api-reference-client.md](04-api-reference-client.md) | Public API for @x402-zetrix/client | Developers |
| 05 | [05-api-reference-server.md](05-api-reference-server.md) | Public API for @x402-zetrix/server | Developers |
| 06 | [06-api-reference-mcp.md](06-api-reference-mcp.md) | MCP tool specs: fetch_with_payment, get_wallet_info, check_payment_capability | AI agent developers |
| 07 | [07-configuration.md](07-configuration.md) | WalletConfig, PaymentPolicy, MCP server config, env vars | Developers, DevOps |
| 08 | [08-quickstart.md](08-quickstart.md) | 5-minute guide: wire a server route + call it from an agent | New developers |

## Recommended reading order

**New developer:** 00 → 01 → 08 → 03

**Server-side developer:** 00 → 02 → 05 → 07

**AI agent / MCP developer:** 00 → 06 → 07 → 08

**Contributor / reviewer:** 00 → 01 → 02 → 03 → 04 → 05 → 06
