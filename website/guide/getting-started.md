# Getting Started

Already installed? Launch fordb and add a connection — pick an engine, fill host/port/database (or a connection URL), and your credentials go straight to the OS keychain.

## Run from source

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev                 # launch in dev mode
pnpm dev:sandboxless     # Linux, if you hit a chrome-sandbox error
```

Common tasks: `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`.

Next: [Connections](/guide/connections) · [Query Workbench](/guide/query-workbench).
