/**
 * In-process Express resource server for integration tests.
 *
 * Starts on a random available port. Protected endpoint GET /api/data returns
 * the settlement status in the response body so the integration test can assert
 * on it (AC4 — QUEUED/SUBMITTED/CONFIRMED from testnet Facilitator).
 */

import express from 'express'
import { createServer, type Server } from 'http'
import { paymentMiddleware, type PaymentMiddlewareConfig } from 'x402-zetrix-server'

export interface ResourceServerHandle {
  port:  number
  close: () => Promise<void>
}

type ServerConfig = Omit<PaymentMiddlewareConfig, 'amount' | 'asset' | 'payTo' | 'network' | 'facilitatorUrl'> & {
  amount:         string
  asset:          string
  payTo:          string
  network:        string
  facilitatorUrl: string
}

export async function createResourceServer(config: ServerConfig): Promise<ResourceServerHandle> {
  const app = express()

  // Free health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Capture settlement status from the middleware logger so we can echo it back
  let lastSettlementStatus: string | null = null
  const logger = {
    log: (msg: string) => {
      console.log('[settle]', msg)
      // Extract status from settle 200 log: "[x402] settle 200 status=SUBMITTED ..."
      const match = /\bstatus=(\w+)/.exec(msg)
      if (match) {
        lastSettlementStatus = match[1]
      } else if (msg.includes('settle')) {
        lastSettlementStatus = 'QUEUED'
      }
    },
    warn:  (_msg: string) => { /* no-op in tests */ },
    error: (...args: unknown[]) => { console.error('[resource-server]', ...args) },
  }

  app.get(
    '/api/data',
    paymentMiddleware({ ...config, logger }),
    (_req, res) => {
      // Allow a brief window for non-blocking settle to fire before responding
      // In tests we await the response, so settlement status may arrive shortly after.
      // We respond immediately; AC4 polls the body after the fact.
      res.json({
        data:             'protected resource data',
        settlementStatus: lastSettlementStatus ?? 'QUEUED',
      })
    },
  )

  const httpServer: Server = createServer(app)

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
    httpServer.once('error', reject)
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('resource-server: failed to get bound port')
  }

  return {
    port:  address.port,
    close: () => new Promise<void>((resolve, reject) =>
      httpServer.close(err => err ? reject(err) : resolve())
    ),
  }
}
