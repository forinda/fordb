# fordb — Research & Planning Docs

**fordb**: lean, keyboard-first, open-source (MIT) desktop database client in TypeScript.
Engines: PostgreSQL first, then SQLite, then MongoDB — all free in core.
Platforms: Debian (.deb), Arch (AUR), Windows (NSIS), AppImage; macOS at v1.0.

All findings below were produced by a multi-agent deep-research run (2026-07-08) with
adversarial fact-checking (3 independent verifiers per claim; refuted claims discarded).

## Index

| Doc                                                          | Category                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| [01-framework-choice.md](01-framework-choice.md)             | Desktop shell: Electron vs Tauri vs others                          |
| [02-packaging-distribution.md](02-packaging-distribution.md) | Multi-platform builds, installers, CI/CD, code signing              |
| [03-database-connectivity.md](03-database-connectivity.md)   | Drivers (Postgres/SQLite/MongoDB), pluggable adapter layer, SSH/SSL |
| [04-ui-stack.md](04-ui-stack.md)                             | Result grid, SQL editor, schema tree, UI framework                  |
| [05-competitive-landscape.md](05-competitive-landscape.md)   | Existing multi-DB clients, gaps to fill                             |
| [06-prd.md](06-prd.md)                                       | Product requirements (approved 2026-07-08)                          |
| [07-work-plan.md](07-work-plan.md)                           | Milestones M0–M8                                                    |

Next step: break M0 + M1 into implementation stories.
