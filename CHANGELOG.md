# Changelog

## [0.8.0](https://github.com/forinda/fordb/compare/v0.7.0...v0.8.0) (2026-07-12)


### Features

* agent-initiated writes — gated run_write, off by default (MA8-C) ([#251](https://github.com/forinda/fordb/issues/251)) ([ba5ebe5](https://github.com/forinda/fordb/commit/ba5ebe53179826110b05ef46802e44a538516e94))
* AI token metering — tokens per turn + session (MA8-E) ([#254](https://github.com/forinda/fordb/issues/254)) ([4488323](https://github.com/forinda/fordb/commit/448832371300e470f1342f38d560be330323a970))
* bulk edit (Edit selected) + clone rows (Phase 1) ([#258](https://github.com/forinda/fordb/issues/258)) ([151b6c7](https://github.com/forinda/fordb/commit/151b6c7e954880d3de2ba5c46cf262330911279a))
* CHECK constraints — table designer + add on existing (Phase 2) ([#265](https://github.com/forinda/fordb/issues/265)) ([84da6fb](https://github.com/forinda/fordb/commit/84da6fbb4b12d04adb0d453c1da263113b2289b7))
* export MongoDB query results to JSON/NDJSON (mongo advanced 2/4) ([#276](https://github.com/forinda/fordb/issues/276)) ([470567b](https://github.com/forinda/fordb/commit/470567b0bff912ebd5c15d5fd030a14fb3dfe6e3))
* export the filtered browse table to CSV/JSON (Phase 1) ([#256](https://github.com/forinda/fordb/issues/256)) ([d734db8](https://github.com/forinda/fordb/commit/d734db8d4151d81e69c127f2f622fd5eb2a98d7c))
* function/trigger authoring (Postgres) — raw definition editor + drop (Phase 1) ([#262](https://github.com/forinda/fordb/issues/262)) ([442597d](https://github.com/forinda/fordb/commit/442597d4ee162be461eeb544a80df205bfe283d4))
* generated columns in table + column designer (Phase 2) ([#267](https://github.com/forinda/fordb/issues/267)) ([b456d57](https://github.com/forinda/fordb/commit/b456d574b4dbe0d8e72aa007afcf32adc4dfc22a))
* grant/revoke table privileges from the Roles panel (Phase 2) ([#271](https://github.com/forinda/fordb/issues/271)) ([fb9152f](https://github.com/forinda/fordb/commit/fb9152f07f768b64416ac2abc3d58a1fdfccfe2d))
* list + drop check constraints in Structure view (Phase 2) ([#269](https://github.com/forinda/fordb/issues/269)) ([6ba11af](https://github.com/forinda/fordb/commit/6ba11afeabaeddec3bde8a136b3a841dd04b17ff))
* MongoDB bulk writes — updateMany/deleteMany (mongo parity 3/3) ([#274](https://github.com/forinda/fordb/issues/274)) ([0f7c990](https://github.com/forinda/fordb/commit/0f7c9905565e753252d4c0342e8b90cbc5a578a5))
* MongoDB collection admin — create/drop/rename (mongo parity 2/3) ([#273](https://github.com/forinda/fordb/issues/273)) ([a1e270c](https://github.com/forinda/fordb/commit/a1e270c7ed4d3b3ba7758731e37b613871d7f31e))
* MongoDB explain plans (mongo advanced 1/4) ([#275](https://github.com/forinda/fordb/issues/275)) ([8eba3da](https://github.com/forinda/fordb/commit/8eba3dac03d641c8c1b2b278e234a8369271efc0))
* MongoDB index management (mongo parity 1/3) ([#272](https://github.com/forinda/fordb/issues/272)) ([4760269](https://github.com/forinda/fordb/commit/476026947e676e42c585a1adb45c2a0c119ec24d))
* MongoDB schema validation rules (mongo advanced 3/4) ([#277](https://github.com/forinda/fordb/issues/277)) ([a15ce01](https://github.com/forinda/fordb/commit/a15ce01f1444eb0a869bf46334ebdddf4d7c6350))
* MongoDB user administration (mongo advanced 4/4) ([#278](https://github.com/forinda/fordb/issues/278)) ([c16b9d7](https://github.com/forinda/fordb/commit/c16b9d770402cc26d49468770953922c08dc7209))
* partial + expression indexes (Phase 2) ([#266](https://github.com/forinda/fordb/issues/266)) ([26e9795](https://github.com/forinda/fordb/commit/26e97958969a7ed5aab3899942a8304ab16a6ab2))
* richer filter operators + composite FK navigation (Phase 1) ([#259](https://github.com/forinda/fordb/issues/259)) ([663cfbb](https://github.com/forinda/fordb/commit/663cfbb474a8c315881ff6640b10f401853ccdb0))
* saved AI conversations — auto-save, reopen, delete (MA8-D) ([#253](https://github.com/forinda/fordb/issues/253)) ([f6ff726](https://github.com/forinda/fordb/commit/f6ff72641bbe5b4132b413f5523d9e2da975c640))
* sequences + materialized views in the schema tree (Phase 2) ([#270](https://github.com/forinda/fordb/issues/270)) ([208b307](https://github.com/forinda/fordb/commit/208b307bddc580093530e75389ea422881c70877))
* table maintenance — VACUUM / ANALYZE / REINDEX (Phase 2) ([#264](https://github.com/forinda/fordb/issues/264)) ([91e584d](https://github.com/forinda/fordb/commit/91e584df2481e271a62c35579f17eda80012d5d1))
* TLS client cert/key/CA for Postgres connections (Phase 2) ([#268](https://github.com/forinda/fordb/issues/268)) ([f6ea9ad](https://github.com/forinda/fordb/commit/f6ea9ada55f23c18e8f623fb357300d92b4c7f6f))
* two-way sync the Postgres connection URL (like the Mongo URI) ([#261](https://github.com/forinda/fordb/issues/261)) ([8e954b5](https://github.com/forinda/fordb/commit/8e954b51af08d0d21e020d7377dfe8ac5094f7fd))
* user/role management (Postgres) — create/alter/drop + membership (Phase 1) ([#260](https://github.com/forinda/fordb/issues/260)) ([cab2a07](https://github.com/forinda/fordb/commit/cab2a07e32161f3247b30e01ba89c06d00f09f10))


### Bug Fixes

* cell editing broken (glide #portal) + themed review modal + pending tray ([#257](https://github.com/forinda/fordb/issues/257)) ([3370dcf](https://github.com/forinda/fordb/commit/3370dcf8626c4c184318f5848587b5c579378ace))
* enable secret-bearing connection e2e (test keychain) + repair PG specs ([#263](https://github.com/forinda/fordb/issues/263)) ([5ae267a](https://github.com/forinda/fordb/commit/5ae267a949738c7d19f6dc6d7804e95bae368362))

## [0.7.0](https://github.com/forinda/fordb/compare/v0.6.0...v0.7.0) (2026-07-12)


### Features

* in-app AI agent panel — NL→SQL, tool-using, read-only (MA8-B) ([#249](https://github.com/forinda/fordb/issues/249)) ([fc1af69](https://github.com/forinda/fordb/commit/fc1af69c4e3d2f2d7dbd68818259eb95a03acf17))

## [0.6.0](https://github.com/forinda/fordb/compare/v0.5.0...v0.6.0) (2026-07-12)


### Features

* MCP read-only gate + persistence (MA8-A foundation) ([#246](https://github.com/forinda/fordb/issues/246)) ([af97f80](https://github.com/forinda/fordb/commit/af97f80958f53deced8edb7dd007ca8d84172983))
* read-only MCP server + Preferences page (MA8-A) ([#248](https://github.com/forinda/fordb/issues/248)) ([3456b8f](https://github.com/forinda/fordb/commit/3456b8f76131d9e97c3595bf67a80bd6c1c06ebf))

## [0.5.0](https://github.com/forinda/fordb/compare/v0.4.1...v0.5.0) (2026-07-11)


### Features

* smarter SQL autocomplete (aliases, keywords, type detail) ([#244](https://github.com/forinda/fordb/issues/244)) ([ffca58a](https://github.com/forinda/fordb/commit/ffca58a24ebe61962f299554eab04760165cc59a))


### Bug Fixes

* UI visibility — scrollable toolbars, dashboard tabs, untagged connections ([#242](https://github.com/forinda/fordb/issues/242)) ([da41702](https://github.com/forinda/fordb/commit/da41702595da00b272f5d28e08e0c3286d23ae2b))

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
