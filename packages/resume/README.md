# resume

Rae Hill's resume / personal home page ([resume.rae-hill.dev](https://resume.rae-hill.dev)),
ported from the standalone `portfolio` repo into the monorepo.

## Stack

- [Vite](https://vite.dev) 8 (rolldown) CSR/SPA build with vendor chunk splitting
  (react / chakra / state / router groups — see `vite.config.ts`)
- [TanStack Router](https://tanstack.com/router) file-based routes in `src/routes/`
  (type-safe route tree generated into `src/routeTree.gen.ts` — never edit by hand; it is
  excluded from dprint and eslint)
- React 18 + [Redux Toolkit](https://redux-toolkit.js.org) (`src/state/print-config/` — the
  print/layout configuration slice, with `effect` Schema-based persistence validation)
- [Chakra UI](https://chakra-ui.com) 3 theming (`src/theme/`) + Emotion + next-themes color mode

## Scripts

```sh
yarn workspace resume dev        # vite dev server
yarn workspace resume build      # production build → dist/
yarn workspace resume preview    # serve the production build locally
yarn workspace resume lint       # eslint (run via root `yarn lint` in CI)
yarn workspace resume typecheck  # tsc --noEmit
```

## Deployment

GitHub Actions (`.github/workflows/resume-deploy.yml`) builds on pushes to `main` that touch
this package (or the lockfile), then publishes `dist/` via the official Pages actions
(`configure-pages` → `upload-pages-artifact` → `deploy-pages`), copying `index.html` →
`404.html` for SPA deep-link fallback. The custom domain `resume.rae-hill.dev` is carried by
`public/CNAME`. `resume-deploy-manual.yml` provides a `workflow_dispatch` redeploy.

## Docs

`docs/` contains the design/planning history carried over from the portfolio repo
(TanStack migration plan, print-config feature spec, effects & presets plan, dynamic
content plan).
