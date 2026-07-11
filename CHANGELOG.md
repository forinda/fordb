# Changelog

## [0.3.0](https://github.com/forinda/fordb/compare/v0.2.0...v0.3.0) (2026-07-11)


### Features

* Create Database dialog with full metadata (Postgres) ([#228](https://github.com/forinda/fordb/issues/228)) ([7a250c4](https://github.com/forinda/fordb/commit/7a250c4858d9cc4216de512769ab9db0e6a3dbeb))
* DDL builder — unique columns, inline FKs, CREATE DATABASE options ([#225](https://github.com/forinda/fordb/issues/225)) ([39e9bde](https://github.com/forinda/fordb/commit/39e9bde24f09ab9571145fee740ad0eea1e9cf40))
* fetchRoles helper + designer spec/plan (Task 2) ([#226](https://github.com/forinda/fordb/issues/226)) ([811adea](https://github.com/forinda/fordb/commit/811adea5394f356cc37e577c221d4d102b00ca39))
* Modal primitive + Create Table designer (Tasks 3-4) ([#227](https://github.com/forinda/fordb/issues/227)) ([0af4a26](https://github.com/forinda/fordb/commit/0af4a26a85a3c624d78ff2b839aa5cbce4846aa9))


### Bug Fixes

* focus trap in Modal + duplicate-column guard in table designer ([#229](https://github.com/forinda/fordb/issues/229)) ([45a8f64](https://github.com/forinda/fordb/commit/45a8f646306b397983df44761ea4608e12bd0229))
* push rpm to concrete Cloudsmith distros (fedora/el any-version) ([#223](https://github.com/forinda/fordb/issues/223)) ([ef4db89](https://github.com/forinda/fordb/commit/ef4db89729b12169fc4d119da14c06dcaaacdd5d))

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
