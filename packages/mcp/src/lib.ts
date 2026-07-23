/**
 * Library entry point for x402-zetrix-mcp.
 * Exports createMcpTools and its types for programmatic use.
 * The CLI binary (MCP server) is at dist/index.js via the "bin" field.
 */

export { createMcpTools } from './mcp-tools'
export type { McpToolConfig, HsmSignerConfig, FetchInput, FetchResult, WalletInfo, CapabilityResult } from './mcp-tools'
