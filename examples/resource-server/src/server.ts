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

// The merchant address that receives payments. Falls back to X402_ADDRESS for
// backward compatibility, but must be a DIFFERENT address than the wallet used
// to pay in any test client — Zetrix rejects self-transfers.
const PAY_TO = process.env.X402_MERCHANT_ADDRESS || process.env.X402_ADDRESS!

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
    payTo:                  PAY_TO,
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
    payTo:                  PAY_TO,
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

// ZTP20 token-priced endpoint — exercises the server SDK's ZTP20 payload
// verification path (payTo + amount + token-contract check), gasModel:facilitator
// since ZTP20 transfers are sponsored (client has no ZTX to pay gas with).
if (process.env.X402_ZTP20_CONTRACT) {
  app.get(
    '/api/token-data',
    paymentMiddleware({
      amount:                 AMOUNT,
      asset:                  process.env.X402_ZTP20_CONTRACT,
      payTo:                  PAY_TO,
      network:                NETWORK,
      facilitatorUrl:         process.env.X402_FACILITATOR_URL!,
      facilitatorApiKey:      process.env.X402_FACILITATOR_API_KEY,
      facilitatorBearerToken: process.env.X402_FACILITATOR_BEARER_TOKEN,
      prepareEndpoint:        process.env.X402_PREPARE_ENDPOINT!,
      gasModel:               'facilitator',
      logger:                 console,
    }),
    (_req, res) => {
      res.json({
        message:  'You have successfully accessed a paid resource with a ZTP20 token.',
        data:      { value: 42, timestamp: new Date().toISOString() },
        paidWith:  process.env.X402_ZTP20_CONTRACT,
        amount:    AMOUNT,
        network:   NETWORK,
      })
    },
  )
}

// ---- Start -----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[x402-resource-server] listening on http://localhost:${PORT}`)
  console.log(`  GET /health                — free`)
  console.log(`  GET /api/data             — requires ${AMOUNT} units of ZTX`)
  console.log(`  GET /api/premium-content  — requires ${String(BigInt(AMOUNT) * 10n)} units of ZTX`)
  if (process.env.X402_ZTP20_CONTRACT) {
    console.log(`  GET /api/token-data       — requires ${AMOUNT} units of ZTP20 token ${process.env.X402_ZTP20_CONTRACT}`)
  }
  console.log(`  Network: ${NETWORK}`)
})
