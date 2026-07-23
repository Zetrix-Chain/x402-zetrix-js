/**
 * XPaymentParser — decodes the X-Payment header.
 *
 * X-Payment header value is base64-encoded JSON matching the XPaymentHeader shape.
 */

import { XPaymentHeader } from './types'

export const XPaymentParser = {
  /**
   * Parse and decode a base64 X-Payment header value.
   * @throws if header is missing, not valid base64, or not valid JSON
   */
  parse(header: string): XPaymentHeader {
    if (!header) {
      throw new Error('XPaymentParser.parse: header is empty')
    }
    let parsed: unknown
    try {
      const json = Buffer.from(header, 'base64').toString('utf8')
      parsed = JSON.parse(json)
    } catch (e) {
      throw new Error(`XPaymentParser.parse: invalid base64 or JSON — ${String(e)}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('XPaymentParser.parse: payload is not an object')
    }
    const obj = parsed as Record<string, unknown>
    if (typeof obj.x402Version !== 'number') {
      throw new Error('XPaymentParser.parse: missing or invalid x402Version')
    }
    if (typeof obj.scheme !== 'string') {
      throw new Error('XPaymentParser.parse: missing or invalid scheme')
    }
    if (typeof obj.network !== 'string') {
      throw new Error('XPaymentParser.parse: missing or invalid network')
    }
    if (typeof obj.payload !== 'object' || obj.payload === null) {
      throw new Error('XPaymentParser.parse: missing or invalid payload')
    }
    return parsed as XPaymentHeader
  },
}
