/**
 * PaymentResponseBuilder — builds the X-Payment-Response header value.
 */

export const PaymentResponseBuilder = {
  /**
   * Build a base64-encoded X-Payment-Response header value.
   * @param data — response data to encode
   */
  build(data: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(data)).toString('base64')
  },
}
