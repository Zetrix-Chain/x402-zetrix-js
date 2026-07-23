# Package Structure

## Workspace layout

```
x402-zetrix-js/
├── docs/                     ← this folder
├── packages/
│   ├── client/               ← x402-zetrix-client
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/               ← x402-zetrix-server
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mcp/                  ← x402-zetrix-mcp
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── package.json              ← root (private, workspace config)
├── pnpm-workspace.yaml
└── README.md
```

## Build

```bash
pnpm install      # install all workspace deps
pnpm build        # build all packages
pnpm test         # run all tests (Vitest)
```
