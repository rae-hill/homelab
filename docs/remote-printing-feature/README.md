# Remote Printing Feature

Server-side PDF generation for the resume site (`resume.rae-hill.dev`) using headless Chrome
(puppeteer) on the homelab server, replacing Vivaldi's unreliable "print to PDF".

## Vision

Chrome produces the best PDFs, and standardizing on headless Chrome server-side makes
downloading trivial. The resume site gains:

1. **Network awareness** — homelab-server is tailscale-only (`*.plato-splunk.media`), so the
   public site first checks whether the server is reachable before showing any
   homelab-integrated UI.
2. **OIDC login** — when reachable, a login button authenticates the owner against kanidm
   (PKCE redirect flow).
3. **URL-driven print config** — an `importPrintSettings=[base64]` query param hydrates the
   redux print-config store, which is how puppeteer injects the config to print.
4. **Download FAB** — a floating action button (above the settings FAB, visible only when
   logged in) POSTs the current config to `POST /resume/print`, receives a PDF rendered by
   headless Chrome, and initiates a browser download.

## Architecture

```
 Browser (resume.rae-hill.dev, GitHub Pages)          Homelab (tailscale)
┌────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│ resume SPA (vite/react/redux/chakra)   │   │ augustus                                   │
│                                        │   │  ┌────────────────────────────────────┐   │
│  shared: print-config schemas,         │   │  │ homelab-server (Effect HttpApi)    │   │
│  base64 codec, OIDC services (Effect)  │   │  │  POST /resume/print                │   │
│                                        │   │  │   → PdfPrintService (puppeteer)    │   │
│  1. GET /status/health  (reachable?) ──┼───┼─▶│   → chrome --headless              │   │
│  2. kanidm OIDC PKCE login ────────────┼───┼─▶│      loads resume.rae-hill.dev     │   │
│  3. POST /resume/print {config} ───────┼───┼─▶│      ?importPrintSettings=<b64>    │   │
│     ◀── application/pdf bytes ─────────┼───┼──│      page.pdf() → Uint8Array       │   │
│  4. blob download                      │   │  └────────────────────────────────────┘   │
└────────────────────────────────────────┘   │  kanidm: OIDC client "homelab"             │
                                             │   + claim-map group → roles: Resume_Print  │
                                             └──────────────────────────────────────────┘
```

The print round-trip: puppeteer navigates to the public resume URL with the config embedded
in the query string, waits for the app to signal readiness, sets light/dark theme via query
param, and calls `page.pdf()`. The resume page must therefore be reachable **from augustus**
(public internet egress) and must apply `importPrintSettings` deterministically before the
readiness signal.

## Repos / packages touched

| Package / area                           | Change                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/homelab-shared` → **`shared`** | Renamed; gains print-config schemas + base64 codec (from resume) and reusable Effect OIDC services; node-only deps dropped so it is browser-safe          |
| `packages/resume`                        | Network-check + auth redux slices, OIDC login flow, `importPrintSettings` query param, download FAB; print-config schema/persistence re-point at `shared` |
| `packages/homelab-api`                   | New `resume` group: `POST /resume/print` (payload `{ config }`, urlParams `theme`, success `Uint8Array` PDF)                                              |
| `packages/homelab-server`                | Handler + `PdfPrintService` (puppeteer), CORS origin for resume, `CHROME_EXECUTABLE` env                                                                  |
| `packages/homelab-services{,-node}`      | Resource URI `Resume_Print`, fine-grained authz matcher, service defs/impls, env def                                                                      |
| `packages/homelab-e2e-tests`             | e2e tests for the new endpoint using shared schemas                                                                                                       |
| `nix-config`                             | kanidm OIDC client callback + claim-map group, systemd env/hardening relaxations for chrome, google-chrome package                                        |

## Confirmed decisions

1. **Shared package**: rename the existing `homelab-shared` package to `shared`
   (`packages/shared`, npm name `shared`) rather than creating a parallel package. Its
   unused node-only deps (`@effect/platform-node`, `bufferutil`, `utf-8-validate`) are
   dropped so `resume` (browser) can consume it.
2. **Authorization**: a dedicated kanidm group (e.g. `resume.printing`) is mapped through
   the existing `claimMaps.roles` in `nix-config/modules/features/homelab-api/oidc.nix` to
   the role value `Resume_Print`. The auth middleware picks the `roles` claim up into the
   `OIDCIdentity` permission set automatically; the handler checks
   `AuthorizationService.canCreate(identity, "Resume_Print", …)`. No code-level allowlists.
3. **OIDC library**: prefer a maintained browser OIDC/PKCE library (candidate:
   `oidc-client-ts`) wrapped in Effect services in `shared` — not a hand-rolled PKCE
   implementation. Not redux-specific; redux state is derived from the service.
4. **Chrome distribution**: `google-chrome` from nixpkgs (best PDF output); executable path
   passed to homelab-server via `CHROME_EXECUTABLE` env var (sops template) so the puppeteer
   launch config points into the nix store. Puppeteer npm dep is `puppeteer-core` (no
   bundled chrome download) — mirroring nixpkgs' own `puppeteer-cli` pattern
   (`PUPPETEER_EXECUTABLE_PATH=${chromium}/bin/chromium`).
5. **State**: redux (RTK) for resume frontend state; Effect for all effectful code (FE and
   BE); Effect `Schema` for parsing/transcoding (base64 ↔ config, query params, API
   payloads).
6. **Theme**: `theme=light|dark` urlParam on the print endpoint controls `colorMode` on the
   rendered page (puppeteer passes it through to the resume URL).

## Doc map

- [`plan.md`](./plan.md) — phased implementation plan with per-file task checklists.
- [`progress.md`](./progress.md) — running handoff log; **start here** when resuming work.

## Conventions for agents picking this up

- Follow `AGENTS.md` + skills (`adding-endpoints`, `effect-services`, `frontend`,
  `validation`, `nix-services`, `port-assignments`).
- Read vendored source in `repos/` (effect v4, etc.) instead of web docs; the monorepo was
  just upgraded to Effect 4 — skills/docs may lag; fix any stale guidance encountered.
- Build first, verify/fix after; don't run `homelab-e2e-tests` against a self-started
  server — the user runs them in watch mode.
- Commit with `git commit --no-verify` when appropriate; never push.
- Update `progress.md` at the end of every work session.
