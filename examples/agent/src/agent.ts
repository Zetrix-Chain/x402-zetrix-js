/**
 * AI Agent example — Claude + x402 automatic payment tools.
 *
 * Demonstrates how to build an AI agent that can access x402-protected APIs
 * automatically. When Claude encounters a 402-protected resource, it calls
 * the fetch_with_payment tool which signs and submits a ZTX payment on the
 * agent's behalf.
 *
 * Usage:
 *   pnpm dev
 *   pnpm dev -- --prompt "Get data from http://localhost:3000/api/data"
 *   node dist/agent.js --prompt "Fetch premium content from http://localhost:3000/api/premium-content"
 *
 * Prerequisites:
 *   - Copy .env.example to .env and fill in credentials
 *   - Start examples/resource-server (pnpm --filter @x402-zetrix/example-resource-server dev)
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { createX402Fetch, PaymentPolicyError } from 'x402-zetrix-client'

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) {
  console.error('Missing required env var: ANTHROPIC_API_KEY')
  process.exit(1)
}

const privateKey = process.env.X402_PRIVATE_KEY ?? ''
const address    = process.env.X402_ADDRESS    ?? ''
const network    = process.env.X402_NETWORK    ?? 'zetrix:testnet'

const isTestnet  = network.includes('testnet')
const nodeHost   = process.env.X402_NODE_HOST || (isTestnet ? 'test-node.zetrix.com' : 'node.zetrix.com')
const nodePort   = process.env.X402_NODE_PORT ?? ''
const maxAmount  = process.env.X402_MAX_AMOUNT_PER_REQUEST

const walletConfigured = !!(privateKey && address && network)

// ---------------------------------------------------------------------------
// x402 fetch with payment
// ---------------------------------------------------------------------------

let x402Fetch: ReturnType<typeof createX402Fetch> | null = null

if (walletConfigured) {
  x402Fetch = createX402Fetch({
    wallet: { privateKey, address, network },
    node:   { host: nodeHost, port: nodePort },
    policy: maxAmount ? { maxAmountPerRequest: maxAmount } : undefined,
  })
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function fetchWithPayment(url: string, method?: string, headers?: Record<string, string>, body?: string): Promise<object> {
  if (!x402Fetch) {
    throw new Error('Wallet not configured — set X402_PRIVATE_KEY, X402_ADDRESS, and X402_NETWORK')
  }

  const init: RequestInit = {}
  if (method)  init.method  = method
  if (headers) init.headers = headers
  if (body)    init.body    = body

  const response = await x402Fetch(url, init)
  const text = await response.text()

  let paymentMade = false
  let amountPaid  = ''
  let asset       = ''

  // Detect if a payment was made by checking response headers or the non-402 status
  const paymentResponse = response.headers.get('x-payment-response')
  if (paymentResponse) {
    paymentMade = true
    // Parse payment details from response header if available
    try {
      const parsed = JSON.parse(Buffer.from(paymentResponse, 'base64').toString('utf-8')) as { amount?: string; asset?: string }
      amountPaid = parsed.amount ?? ''
      asset      = parsed.asset  ?? 'ZTX'
    } catch {
      asset = 'ZTX'
    }
  }

  return { status: response.status, body: text, paymentMade, amountPaid, asset }
}

function getWalletInfo(): object {
  if (!walletConfigured) {
    return { address: '', network: '', configured: false }
  }
  return { address, network, configured: true }
}

// ---------------------------------------------------------------------------
// Anthropic tool definitions (mirrors the MCP server tools)
// ---------------------------------------------------------------------------

const tools: Anthropic.Tool[] = [
  {
    name:        'fetch_with_payment',
    description: 'Perform an HTTP request with automatic x402 payment handling. If the server responds with 402 Payment Required, pays automatically using the configured Zetrix wallet and retries the request. Use this whenever you need to access a paid API.',
    input_schema: {
      type:       'object',
      properties: {
        url:     { type: 'string',  description: 'The URL to fetch' },
        method:  { type: 'string',  description: 'HTTP method (default: GET)' },
        headers: { type: 'object',  description: 'Request headers as key-value pairs' },
        body:    { type: 'string',  description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
  },
  {
    name:         'get_wallet_info',
    description:  'Returns the configured wallet address and network. Use this to confirm the wallet is set up before making payments.',
    input_schema: {
      type:       'object',
      properties: {},
    },
  },
]

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

async function runAgent(prompt: string): Promise<void> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ]

  console.log(`\nUser: ${prompt}\n`)

  while (true) {
    const response = await client.messages.create({
      model:      process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
      max_tokens: 1024,
      tools,
      messages,
    })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      if (textBlock && textBlock.type === 'text') {
        console.log(`\nClaude: ${textBlock.text}\n`)
      }
      break
    }

    if (response.stop_reason === 'tool_use') {
      // Add Claude's response (including tool use blocks) to history
      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        console.log(`[tool] ${block.name}(${JSON.stringify(block.input)})`)

        let result: string
        try {
          let output: object

          if (block.name === 'fetch_with_payment') {
            const input = block.input as { url: string; method?: string; headers?: Record<string, string>; body?: string }
            output = await fetchWithPayment(input.url, input.method, input.headers, input.body)
          } else if (block.name === 'get_wallet_info') {
            output = getWalletInfo()
          } else {
            output = { error: `Unknown tool: ${block.name}` }
          }

          result = JSON.stringify(output)
          console.log(`[tool result] ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}\n`)
        } catch (err) {
          if (err instanceof PaymentPolicyError) {
            result = JSON.stringify({ error: err.message, type: 'PaymentPolicyError' })
          } else {
            result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          }
          console.log(`[tool error] ${result}\n`)
        }

        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     result,
        })
      }

      // Add tool results to history
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Unexpected stop reason
    console.warn(`[agent] Unexpected stop_reason: ${response.stop_reason}`)
    break
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const promptFlagIdx = args.indexOf('--prompt')
const defaultUrl    = process.env.RESOURCE_URL ?? 'http://localhost:3000/api/data'

const prompt = promptFlagIdx !== -1 && args[promptFlagIdx + 1]
  ? args[promptFlagIdx + 1]
  : (process.env.AGENT_PROMPT || `Fetch data from ${defaultUrl}. If the API requires payment, pay automatically and return the response.`)

runAgent(prompt).catch(err => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
