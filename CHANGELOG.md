# Changelog

## [0.2.0](https://github.com/forinda/fordb/compare/v0.1.0...v0.2.0) (2026-07-11)


### Features

* apt/dnf install via Cloudsmith (deb + rpm) ([#220](https://github.com/forinda/fordb/issues/220)) ([9d907f6](https://github.com/forinda/fordb/commit/9d907f682cc5d9ae770fff6c2327186e79b41d6a))

## 0.1.0 (2026-07-11)

First release. Lean, keyboard-first desktop database client — PostgreSQL,
SQLite, and MongoDB, all engines free (MIT).

### Features

- Three database engines behind one adapter contract (Postgres, SQLite, MongoDB).
- Query workbench: CodeMirror 6 editor with shared-cache schema completion,
  virtualized result grid, multi-tab.
- Lazy, refreshable schema tree; MongoDB collection + document browser.
- Keyboard-first: command palette, keychain-backed connection profiles.
- Secrets never reach the renderer; drivers isolated in a db-host process.

### Packaging

- Linux (AppImage + deb) and Windows (NSIS) installers.
- Tag-driven GitHub release pipeline with `SHA256SUMS`.
- CI perf gate (~776 ms cold start, ~197 MB idle).
