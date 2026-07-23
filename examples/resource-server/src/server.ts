/**
 * Example resource server using @x402-zetrix/server.
 *
 * Demonstrates how to protect Express routes with x402 payment middleware.
 * Copy .env.example to .env and fill in the values before running.
 *
 * Run:
 *   pnpm dev          — TypeScript directly via ts-node
 *   pnpm build && pnpm start  — compiled JS
 */

import 'dotenv/config'
import express from 'express'
import { paymentMiddleware } from 'x402-zetrix-server'

const PORT    = parseInt(process.env.PORT ?? '3000', 10)
const NETWORK = process.env.X402_NETWORK ?? 'zetrix:testnet'
const AMOUNT  = process.env.X402_PAYMENT_AMOUNT ?? '10000'

const requiredEnv = ['X402_ADDRESS', 'X402_FACILITATOR_URL'] as const
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
}

if (!/^\d+$/.test(AMOUNT)) {
  console.error('X402_PAYMENT_AMOUNT must be a whole-number integer string (e.g. "10000")')
  process.exit(1)
}

const app = express()
app.use(express.json())

// ---- Free endpoints --------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', network: NETWORK })
})

// ---- Protected endpoints ---------------------------------------------------

app.get(
  '/api/data',
  paymentMiddleware({
    amount:                 AMOUNT,
    asset:                  'ZTX',
    payTo:                  process.env.X402_ADDRESS!,
    network:                NETWORK,
    facilitatorUrl:         process.env.X402_FACILITATOR_URL!,
    facilitatorApiKey:      process.env.X402_FACILITATOR_API_KEY,
    facilitatorBearerToken: process.env.X402_FACILITATOR_BEARER_TOKEN,
    prepareEndpoint:        process.env.X402_PREPARE_ENDPOINT || undefined,
    gasModel:               'client',
    logger:                 console,
  }),
  (_req, res) => {
    res.json({
      message:   'You have successfully accessed a paid resource.',
      data:      { value: 42, timestamp: new Date().toISOString() },
      paidWith:  'ZTX',
      amount:    AMOUNT,
      network:   NETWORK,
    })
  },
)

app.get(
  '/api/premium-content',
  paymentMiddleware({
    amount:                 String(BigInt(AMOUNT) * 10n),   // 10× the base amount
    asset:                  'ZTX',
    payTo:                  process.env.X402_ADDRESS!,
    network:                NETWORK,
    facilitatorUrl:         process.env.X402_FACILITATOR_URL!,
    facilitatorApiKey:      process.env.X402_FACILITATOR_API_KEY,
    facilitatorBearerToken: process.env.X402_FACILITATOR_BEARER_TOKEN,
    prepareEndpoint:        process.env.X402_PREPARE_ENDPOINT || undefined,
    gasModel:               'client',
    logger:                 console,
  }),
  (_req, res) => {
    res.json({
      message: 'Premium content unlocked.',
      content: 'This is the premium dataset that costs 10× the base rate.',
      network: NETWORK,
    })
  },
)

// ---- Start -----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[x402-resource-server] listening on http://localhost:${PORT}`)
  console.log(`  GET /health                — free`)
  console.log(`  GET /api/data             — requires ${AMOUNT} units of ZTX`)
  console.log(`  GET /api/premium-content  — requires ${String(BigInt(AMOUNT) * 10n)} units of ZTX`)
  console.log(`  Network: ${NETWORK}`)
})
