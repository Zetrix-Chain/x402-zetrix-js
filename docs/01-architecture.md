# Architecture

> Cross-references: §03 for sequence diagrams, §04–06 for API reference.

## Package dependency graph

```
x402-zetrix-mcp
    └── x402-zetrix-client  (workspace dependency)

x402-zetrix-server
    └── (no dependency on client — server calls Facilitator directly)
```

## Integration modes

See the x402-zetrix-development.md Agentic Integration section for full diagrams.

**Mode A — HTTP Interceptor (Library):** Agent code imports `x402-zetrix-client` and uses `x402Fetch`. All 402 handling is transparent.

**Mode B — MCP Tool Server:** `x402-zetrix-mcp` runs as a standalone process. AI agent (Claude, LLM) calls `fetch_with_payment` tool.
