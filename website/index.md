---
layout: home
hero:
  name: fordb
  text: A lean, keyboard-first database client
  tagline: Postgres, SQLite, and MongoDB — every engine free. Open source, MIT.
  image:
    src: /icon.png
    alt: fordb
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Download
      link: https://github.com/forinda/fordb/releases
    - theme: alt
      text: GitHub
      link: https://github.com/forinda/fordb
features:
  - title: Multi-engine, all free
    details: Postgres and SQLite today, MongoDB in v0.3 — no paid tier gates an engine.
  - title: Keyboard-first
    details: A command palette reaches every action; the SQL editor runs on Mod-Enter.
  - title: Secrets never reach the UI
    details: Passwords and tokens live in the OS keychain in the main process; the window only holds an opaque connection id.
  - title: Destructive = previewed + confirmed
    details: Row edits, DDL, and drops show the generated SQL and require an explicit confirm before applying.
---

## A query workbench that stays out of your way

Schema tree, SQL editor with autocomplete, and a fast result grid — with format, EXPLAIN, history, saved queries, and CSV/JSON export a keypress away.

![fordb query workbench](/screenshots/query.png)

## Design tables without hand-writing DDL

A tabbed designer for columns (type, nullable, primary key, unique, default) and foreign keys — with a live `CREATE TABLE` preview you confirm before it runs.

![fordb create-table designer](/screenshots/designer.png)
