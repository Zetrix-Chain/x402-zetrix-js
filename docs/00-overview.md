# Overview

> Cross-references: §01 for architecture, §03 for flows, §08 for quickstart.

## What this repo is

`x402-zetrix-js` is the NodeJS/TypeScript implementation of the x402 payment protocol for the Zetrix blockchain. It provides three packages that enable autonomous AI agents and API servers to transact using HTTP 402 "Payment Required" with Zetrix as the settlement layer.

## Package inventory

| Package | npm name | Role |
|---|---|---|
| client | `x402-zetrix-client` | Parses 402 responses, builds payment blobs, signs with ED25519, retries request. Core of both integration modes. |
| server | `x402-zetrix-server` | Express/Fastify middleware. Emits 402 for protected routes, calls Facilitator /verify before serving, calls /settle async after |
| mcp | `x402-zetrix-mcp` | Standalone MCP server. Wraps client as AI agent tools: fetch_with_payment, get_wallet_info, check_payment_capability |

## Non-goals

- This SDK does not implement the Facilitator service (a separate repo)
- This SDK does not implement the Zetrix Paymaster (lives in myeg-ms-zetrix baas-v2)
- This SDK does not support EVM/EIP-712 signing — Zetrix uses ED25519 blob signing
- The `mcp` package is NodeJS only; Java SDK (x402-zetrix-java) has no MCP package
