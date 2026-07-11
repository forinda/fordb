# Changelog

## [0.3.0](https://github.com/forinda/fordb/compare/v0.2.0...v0.3.0) (2026-07-11)


### Features

* Create Database dialog with full metadata (Postgres) ([#228](https://github.com/forinda/fordb/issues/228)) ([aba4664](https://github.com/forinda/fordb/commit/aba46643ab9127335d518a643df3821bd49dfef2))
* DDL builder — unique columns, inline FKs, CREATE DATABASE options ([#225](https://github.com/forinda/fordb/issues/225)) ([01c525f](https://github.com/forinda/fordb/commit/01c525fcd4c91304c090803980adfac6ca79c6dd))
* fetchRoles helper + designer spec/plan (Task 2) ([#226](https://github.com/forinda/fordb/issues/226)) ([06a2e99](https://github.com/forinda/fordb/commit/06a2e990664fe4f8727effba7358965614a724eb))
* Modal primitive + Create Table designer (Tasks 3-4) ([#227](https://github.com/forinda/fordb/issues/227)) ([5f7a748](https://github.com/forinda/fordb/commit/5f7a7485c91ee56684bcaae565248d118085cb66))


### Bug Fixes

* focus trap in Modal + duplicate-column guard in table designer ([#229](https://github.com/forinda/fordb/issues/229)) ([78acd3c](https://github.com/forinda/fordb/commit/78acd3cda7df561fceeede6684ce0039f9259c9f))
* push rpm to concrete Cloudsmith distros (fedora/el any-version) ([#223](https://github.com/forinda/fordb/issues/223)) ([3a99679](https://github.com/forinda/fordb/commit/3a99679a62ae6e5aace3cfef01904b1ce00ca416))

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
