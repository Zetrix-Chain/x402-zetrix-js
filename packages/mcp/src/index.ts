#!/usr/bin/env node
/**
 * x402-zetrix-mcp — MCP server entry point.
 * [IMPL] x402-zetrix-mcp MCP server
 *
 * Start: node packages/mcp/dist/index.js
 *
 * Env vars:
 *   X402_PRIVATE_KEY            — wallet private key (local mode)
 *   X402_ADDRESS                — wallet/HSM address (required)
 *   X402_NETWORK                — e.g. "zetrix:testnet" (required)
 *   X402_HSM_PASSWORD           — pre-configured HSM password (HSM mode; optional — runtime mode omits this)
 *   X402_HSM_BASE_URL           — override Zetrix HSM API base URL (HSM mode; auto-derived from X402_NETWORK)
 *   X402_NODE_HOST              — Zetrix RPC host (default: node.zetrix.com)
 *   X402_NODE_PORT              — Zetrix RPC port (only set when connecting directly to a node IP)
 *   X402_MAX_AMOUNT_PER_REQUEST — max payment per request in smallest unit
 *   X402_ZTP20_DECIMALS         — decimal places for ZTP20 tokens (default: 6)
 */

import { Server }               from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createMcpTools } from './mcp-tools'
import { resolveHsmBaseUrl } from './hsm-signer'

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const privateKey  = process.env.X402_PRIVATE_KEY ?? ''
const address     = process.env.X402_ADDRESS     ?? ''
const network     = process.env.X402_NETWORK     ?? ''
const hsmPassword = process.env.X402_HSM_PASSWORD ?? ''
const hsmBaseUrl  = process.env.X402_HSM_BASE_URL  ?? resolveHsmBaseUrl(network)
const maxAmount     = process.env.X402_MAX_AMOUNT_PER_REQUEST
const _ztp20Raw    = parseInt(process.env.X402_ZTP20_DECIMALS ?? '', 10)
const ztp20Decimals = Number.isInteger(_ztp20Raw) ? _ztp20Raw : undefined

const isTestnet  = network.includes('testnet')
const nodeHost   = process.env.X402_NODE_HOST ?? (isTestnet ? 'test-node.zetrix.com' : 'node.zetrix.com')
const nodePort   = process.env.X402_NODE_PORT ?? ''

const wallet = (privateKey && address && network)
  ? { privateKey, address, network }
  : null

const hsmConfig = (!privateKey && address && network)
  ? { address, network, baseUrl: hsmBaseUrl, ...(hsmPassword && { password: hsmPassword }) }
  : undefined

const tools = createMcpTools({
  wallet,
  hsmConfig,
  node:   { host: nodeHost, port: nodePort },
  policy: maxAmount ? { maxAmountPerRequest: maxAmount } : undefined,
  ...(ztp20Decimals !== undefined && { ztp20Decimals }),
})

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'x402-zetrix-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        'fetch_with_payment',
      description: 'Perform an HTTP request with automatic x402 payment handling. Pays with ZTX if the server returns a 402.',
      inputSchema: {
        type: 'object',
        properties: {
          url:         { type: 'string', description: 'Request URL' },
          method:      { type: 'string', description: 'HTTP method (default GET)' },
          headers:     { type: 'object', description: 'Request headers' },
          body:        { type: 'string', description: 'Request body' },
          hsmPassword: { type: 'string', description: 'HSM account password (required when HSM mode is active and X402_HSM_PASSWORD is not configured)' },
        },
        required: ['url'],
      },
    },
    {
      name:        'get_wallet_info',
      description: 'Return the configured wallet address and network.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name:        'check_payment_capability',
      description: 'Query the Zetrix RPC node for the wallet balance and report whether payments are possible.',
      inputSchema: {
        type: 'object',
        properties: {
          asset: {
            type: 'string',
            description: '"ZTX" for native coin balance (default), or a ZTP20 contract address to check token balance',
          },
        },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'fetch_with_payment') {
    const result = await tools.fetch_with_payment(args as unknown as Parameters<typeof tools.fetch_with_payment>[0])
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }

  if (name === 'get_wallet_info') {
    return { content: [{ type: 'text', text: JSON.stringify(tools.get_wallet_info()) }] }
  }

  if (name === 'check_payment_capability') {
    const result = await tools.check_payment_capability((args as { asset?: string }) ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }

  throw new Error(`Unknown tool: ${name}`)
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
server.connect(transport).catch((err: Error) => {
  process.stderr.write(`x402-zetrix-mcp: fatal error — ${err.message}\n`)
  process.exit(1)
})
