# Changelog

## [0.4.1](https://github.com/forinda/fordb/compare/v0.4.0...v0.4.1) (2026-07-11)


### Bug Fixes

* default-import electron-updater (CJS) so the packaged app launches ([#240](https://github.com/forinda/fordb/issues/240)) ([c402c0a](https://github.com/forinda/fordb/commit/c402c0a1e94185b30c31831b1e21ee4d0fa9d0d8))

## [0.4.0](https://github.com/forinda/fordb/compare/v0.3.0...v0.4.0) (2026-07-11)


### Features

* in-app auto-update via electron-updater ([#239](https://github.com/forinda/fordb/issues/239)) ([fc58259](https://github.com/forinda/fordb/commit/fc58259c2495a268e90ced42e98cd101c97dca3f))
* multi-column FKs + Indexes tab in the Create Table designer ([#238](https://github.com/forinda/fordb/issues/238)) ([d52ac39](https://github.com/forinda/fordb/commit/d52ac39266cf6e588df85085a58982137ee8b64e))


### Bug Fixes

* wrap query/data toolbars and scroll tabs when narrow ([#236](https://github.com/forinda/fordb/issues/236)) ([e8bc141](https://github.com/forinda/fordb/commit/e8bc14109daf74f8c616bcd0892fc2b7e6b21775))

## [0.3.0](https://github.com/forinda/fordb/compare/v0.2.0...v0.3.0) (2026-07-11)


### Features

* Create Database dialog with full metadata (Postgres) ([#228](https://github.com/forinda/fordb/issues/228)) ([7a250c4](https://github.com/forinda/fordb/commit/7a250c4858d9cc4216de512769ab9db0e6a3dbeb))
* DDL builder — unique columns, inline FKs, CREATE DATABASE options ([#225](https://github.com/forinda/fordb/issues/225)) ([39e9bde](https://github.com/forinda/fordb/commit/39e9bde24f09ab9571145fee740ad0eea1e9cf40))
* fetchRoles helper + designer spec/plan (Task 2) ([#226](https://github.com/forinda/fordb/issues/226)) ([811adea](https://github.com/forinda/fordb/commit/811adea5394f356cc37e577c221d4d102b00ca39))
* Modal primitive + Create Table designer (Tasks 3-4) ([#227](https://github.com/forinda/fordb/issues/227)) ([0af4a26](https://github.com/forinda/fordb/commit/0af4a26a85a3c624d78ff2b839aa5cbce4846aa9))
* VitePress landing + docs site → GitHub Pages ([#232](https://github.com/forinda/fordb/issues/232)) ([10b9ce5](https://github.com/forinda/fordb/commit/10b9ce522abf55999bf7d4be9449fc16a9faaf59))


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
