# Phase 2 — Migrate Docusaurus → TanStack (Vite SPA, CSR-only)

## Framework choice: TanStack **Router** on Vite (SPA), not full Start

You asked for **client-side rendering / SPA only** and want to stop fighting SSR. TanStack
**Start** is a _full-document SSR_ framework (SSR, streaming, server functions). Its routing
engine is **TanStack Router**, and the Chakra integration guide targets **TanStack Router on
Vite** — a pure client SPA. That is the correct target here:

- Pure CSR SPA → no server render, no Emotion SSR extraction, no hydration mismatch class
  of bugs. This deletes the custom `src/plugins/emotion.ts` problem entirely.
- Chakra v3 on CSR "just works" with `ChakraProvider` + next-themes; no critical-CSS plugin.
- Still gives file-based routing, type-safe routes, and a Vite dev/build pipeline.

> If we later want prerendered HTML for SEO, TanStack Start can be layered on with
> `prerender`/SPA-mode — but that is explicitly out of scope now. We build the SPA with
> TanStack Router + Vite. (Reference: vendored `repos/chakra-ui/sandbox/react-router`.)

## Target toolchain

- **Vite** + `@vitejs/plugin-react` + `@tanstack/router-plugin` (file-based route gen,
  `autoCodeSplitting`).
- `@tanstack/react-router` (+ `@tanstack/router-devtools` in dev).
- Output: static `dist/` (Vite default) → published to GitHub Pages. We keep CSR by
  serving `index.html` for all routes (SPA fallback).
- Remove: all `@docusaurus/*`, `@mdx-js/react`, `@emotion/server`, `@emotion/cache`,
  `prism-react-renderer`, `sidebars.ts`, `docusaurus.config.ts`, `src/plugins/`,
  `src/theme/{cache,server-root}.ts`.
- Keep: React 18, `@chakra-ui/react`, `@emotion/react`, `@reduxjs/toolkit`, `react-redux`,
  `next-themes`, `react-icons`, `ts-mixer`, `@fp-tx/core`, `type-fest`.

## Routes (file-based, `src/routes/`)

| Route       | Source                  | Behavior                               |
| ----------- | ----------------------- | -------------------------------------- |
| `/` (index) | `src/routes/index.tsx`  | The resume (current `pages/index.tsx`) |
| `/resume`   | `src/routes/resume.tsx` | Redirect to `/` (TanStack `redirect`)  |
| `__root`    | `src/routes/__root.tsx` | App shell: providers + header + FABs   |

`experience.mdx` is dropped (MDX/Docusaurus-only; not wired to a live route). Blog content
under `src/blog/` is already unused and stays dormant (not routed).

## App shell (`__root.tsx`) — replaces `src/theme/Root.tsx`

Provider order (CSR): `ColorModeProvider (next-themes)` → `ChakraProvider (our theme)` →
`PrintConfigProvider (Redux)` → `{ Header, <Outlet/>, EffectsFab, PrintConfigFab }`.

- Reuse the existing Chakra `theme` from `src/theme/theme.ts` (unchanged).
- Replace the Docusaurus `ColorModeProvider`/`useColorMode` coupling in `Root.tsx` with the
  Chakra/next-themes `color-mode` module (ported from the vendored sandbox): gives us
  `ColorModeProvider`, `useColorMode`, and a ready-made `ColorModeButton`.
- No more `@docusaurus/theme-common` bridge.

## Header bar (NEW — `src/components/header.tsx`)

Docusaurus provided the navbar; we now own it. It is intentionally minimal (the old one was
heavily overridden in `custom.css`):

- Right side only: **GitHub icon link** (`https://github.com/rae-hill`) + **light/dark mode
  toggle** (`ColorModeButton`).
- Fixed/sticky, `backdrop-filter: blur` (matches the old `.navbar` rule), hidden in print.
- No title/brand, no nav links (single-page site).
- The old `.header-github-link`, `.navbar*` CSS rules in `custom.css` get removed/replaced
  by Chakra styles on the new header.

## Config / scripts migration (from `docusaurus.config.ts`)

Everything the Docusaurus config injected must be reproduced, mostly in `index.html` (Vite's
HTML entry) or small runtime modules:

1. **`<head>` tags** → `index.html`: favicons (ico/svg/png/apple-touch), `site.webmanifest`,
   `theme-color` meta, Victor Mono Google Font `<link>`, cherry-blossom `preload`, and the
   **`robots: noai,noimageai`** meta (preserve AI opt-out).
2. **Title / description / canonical** → `index.html` (+ optional per-route `head` via
   TanStack Router's `head`/meta API).
3. **Commit hash** (`COMMIT_HASH`) → was `process.env` inlined into a `<script>` as
   `printFooterRevision`. Replace with a Vite env var: `import.meta.env.VITE_COMMIT_HASH`
   (set `VITE_COMMIT_HASH=$GITHUB_SHA` in CI). `theme.ts`'s `getPrintFooterRevision()` reads
   `globalThis.printFooterRevision` today → point it at the Vite env (define a tiny
   `src/env.ts` shim; also feeds the `@page` print footer).
4. **`todaysDate`** → was a config `<script>` global. Replace with a build-time/`new Date()`
   value exposed the same way (`theme.ts` `getTodaysDate()` reads `window.todaysDate`); set
   it from a small module instead of an injected script.
5. **Confetti third-party script** (`run.confettipage.com`, prod-only, with the encoded
   `data-confetticode`) → inject via a small client effect or a conditional `<script>` in
   `index.html` gated on prod. `EffectsFab`/`useCorrectConfettiZIndex` already assume the
   global `ConfettiPage`/`.confetties-iframe`; keep that contract.
6. **No-console-in-prod** snippet → a one-liner in the entry module guarded by
   `import.meta.env.PROD`.
7. **Footer** ("Lovingly crafted in Fort Collins, CO") → render in the app (small footer
   component or in `__root`), replacing the Docusaurus footer config. Preserve the
   human-crafted sentiment.
8. **`onBrokenLinks: throw`** has no Vite equivalent; links are now in-app. We keep links
   valid manually (only `/` and `/resume` exist).

## CSS migration (`src/css/custom.css`)

- Keep: `@page` print rules, the `:root`/`[data-theme]` custom properties still referenced
  (`--rh-resume-tag-colors-*`, `--ifm-*` that components use), `.home-page-content__bg`,
  scrollbar-gutter, print `@media` rules.
- Audit `--ifm-*` usage: Docusaurus defined Infima vars; anything our components read
  (e.g. `--ifm-background-color`, `--ifm-color-primary`) must be defined in `custom.css`
  now that Infima is gone. Define the handful we actually use as plain CSS vars.
- Remove: `.navbar*`, `.footer*`, `.table-of-contents`, `.header-github-link` (replaced by
  the new header), Docusaurus-sidebar rules.
- Import `custom.css` once from the entry/root.

## Redux + hooks

No changes — the Phase 1 RTK store is framework-agnostic. `PrintConfigProvider` mounts in
`__root`. The only edit: `print-config-fab.tsx` uses `@docusaurus/router`
`useHistory`/`useLocation` for the `?print-options-open` query param → swap to TanStack
Router's `useNavigate` + `useSearch` (or `useRouterState`), or simplify to local state since
it's just modal open/tab. Simplest: keep it in the URL via TanStack `useNavigate`.

## Dev mode & deployment

- **Dev:** `vite` (replaces `docusaurus start`). The old `yarn start` used local HTTPS certs
  for `docusaurus`; Vite dev is plain HTTP by default (add `server.https` only if you want
  certs). New scripts: `dev` = `vite`, `build` = `vite build`, `serve`/`preview` =
  `vite preview`, `typecheck` = `tsc`.
- **GitHub Pages / CI:** keep `peaceiris/actions-gh-pages` publishing to **`docs-latest`**
  with CNAME `rae-hill.dev`. Changes to `.github/workflows/build.yml`:
  - `publish_dir: ./dist` (was `./build`).
  - Inject `VITE_COMMIT_HASH: ${{ github.sha }}` (was `COMMIT_HASH`).
  - Add a **SPA fallback**: copy `dist/index.html` → `dist/404.html` so GitHub Pages serves
    the SPA for `/resume` deep-links (GH Pages has no server rewrite). Add a build step or a
    Vite plugin to emit `404.html`.
  - Keep `.node-version` + Corepack/Yarn Berry.
  - `deploy-manual.yml` mirrors the same (no commit hash), update `publish_dir`.
- `base` in `vite.config.ts` = `/` (custom domain at apex, so root base is correct).

## Verification strategy

- `yarn typecheck` (tsc) — keep strict; aim to clear the old baseline too (the Docusaurus
  tsconfig extends go away; we use a plain strict tsconfig, so emotion.ts/open-source.tsx
  baseline errors disappear with those files or get fixed).
- `yarn build` (vite build) — must succeed and emit `dist/` + `404.html`.
- `yarn preview` + manual smoke: `/` renders resume, `/resume` redirects, header toggle
  flips light/dark, FABs work, Konami unlock, print preview intact, parallax + glass slab,
  confetti in prod build.
- Render parity against the current site (same content, same controls).

## Risk / human-in-the-loop notes

- This replaces the entire build/dev/deploy toolchain and touches CI. I will implement and
  verify `build`/`typecheck`/`preview` locally, but **deployment correctness (GH Pages
  serving, custom domain, 404 fallback) can only be fully confirmed on a real push** — I'll
  flag this and not deploy from here.
- Yarn Berry (PnP) + Vite + the TanStack router plugin must cooperate; if PnP fights the
  plugin, falling back to `nodeLinker: node-modules` may be needed (will flag before doing).
- Local HTTPS certs from the old `start` script are dropped; say the word if you want Vite
  https in dev.

## Execution order (incremental, each step verified)

1. Add Vite + TanStack Router + plugin deps; remove Docusaurus deps (after wiring).
2. `vite.config.ts`, `index.html`, entry (`src/main.tsx`), `tsconfig` (plain strict).
3. `src/routes/__root.tsx` (providers + header + FABs), `color-mode.tsx`, `header.tsx`.
4. `src/routes/index.tsx` (resume) + `src/routes/resume.tsx` (redirect).
5. Decouple `print-config-fab` from `@docusaurus/router`; env shim for commit hash/date.
6. CSS cleanup (`custom.css`), static assets, confetti/no-console/footer.
7. Rewrite CI workflows (`dist`, `VITE_COMMIT_HASH`, `404.html`).
8. Remove Docusaurus files/deps; typecheck + build + preview smoke.

```
```
