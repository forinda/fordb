# fordb website

Public VitePress site → https://forinda.github.io/fordb

## Local

```bash
pnpm website:dev     # dev server
pnpm website:build   # build to website/.vitepress/dist
```

## Deploy

`.github/workflows/docs.yml` builds and deploys to GitHub Pages on every push to
`main` that touches `website/**`.

**One-time setup:** repo **Settings → Pages → Source: GitHub Actions**. Until
that is enabled, the `deploy` job fails while the `build` job still proves the
site compiles.

Content here is public and curated — it is **not** the private `docs/` design
docs (those are git-ignored).
