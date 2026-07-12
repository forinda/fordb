# Introduction

**fordb** is a lean, keyboard-first, open-source (MIT) desktop database client. Postgres, SQLite, and MongoDB are all shipped and all deep — every engine is free in core. Built with Electron + TypeScript.

It sits between the two extremes: lighter than DataGrip/DBeaver, but multi-engine unlike the single-database clients. Fast to open, driven from the keyboard, and honest about your data — every destructive change is previewed as SQL and confirmed before it runs.

## Architecture in one breath

Three Electron processes, so a compromised renderer can never touch a driver or a secret directly:

- **renderer** — React UI, no Node access; holds only an opaque `connectionId`.
- **main** — windows, the OS keychain, profile/secret stores.
- **db-host** — a utility process that runs every database driver.

Secrets never reach the renderer. The `DbAdapter` interface is the core contract, enforced by a shared contract-test suite, so every engine behaves consistently.

Next: [Install](/guide/install) or [Getting Started](/guide/getting-started).
