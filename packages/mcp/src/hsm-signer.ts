/**
 * HsmSigner — signs Zetrix transaction blobs via the Zetrix HSM API.
 * HSM keypair support for x402-zetrix-mcp
 *
 * API endpoint: POST /api/hsm/sign-blob
 *   Testnet: https://public-api-sandbox.zetrix.com/api/hsm/sign-blob
 *   Mainnet: https://public-api.zetrix.com/api/hsm/sign-blob
 */

export interface HsmSignerEntity {
  signBlob:  string
  publicKey: string
}

export function resolveHsmBaseUrl(network: string): string {
  return network.includes('testnet')
    ? 'https://public-api-sandbox.zetrix.com'
    : 'https://public-api.zetrix.com'
}

export const HsmSigner = {
  async sign(
    blob:    string,
    address: string,
    password: string,
    baseUrl: string,
  ): Promise<HsmSignerEntity> {
    const response = await fetch(`${baseUrl}/api/hsm/sign-blob`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ blob, address, password }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`HsmSigner.sign: HTTP ${response.status} from HSM API — ${body}`)
    }

    const data = await response.json() as {
      success:   boolean
      object:    Array<{ signBlob: string; publicKey: string }>
      messages?: Array<{ type: string; errorCode: number; message: string }>
    }

    if (!data.success || !data.object?.length) {
      const errMsg = data.messages?.find(m => m.type === 'ERROR')?.message ?? 'unknown error'
      throw new Error(`HsmSigner.sign: HSM API returned failure — ${errMsg}`)
    }

    return { signBlob: data.object[0].signBlob, publicKey: data.object[0].publicKey }
  },
}
