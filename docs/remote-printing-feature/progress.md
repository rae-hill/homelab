# Remote Printing Feature — Progress Log

Handoff log for agents. Newest entries at the top. Read `README.md` + `plan.md` first.

---

## 2026-11-03 — Session 1 (planning + Phases 1–8 implemented; deployment pending)

### Commits this session (all on `main`, NOT pushed)

| Commit                                | What                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `0a30f89`                             | rename `homelab-shared` → `shared` (browser-safe: dropped unused node deps)             |
| `f1a298c`                             | extract print-config schemas + base64 codecs → `shared/src/print-config/` (+11 tests)   |
| `2cf271e`                             | `shared/oidc` subpath: oidc-client-ts wrapped in Effect (AuthService, checkReachable)   |
| `7b080e6`                             | POST /resume/print: API def + PdfPrintService (puppeteer-core) + handler + 5 unit tests |
| `6169dc`                              | resume: reachability + OIDC login + `importPrintSettings`/`theme` params + print-ready  |
| `ea839c8`                             | resume: download FAB (typed HttpApiClient → blob download)                              |
| `3539d54`                             | resume: Chakra toaster (FAB feedback + homelab error bridge)                            |
| `98d7e6a`                             | nix: kanidm resume.printing group/claim-map/callbacks, CHROME_EXECUTABLE, hash refresh  |
| `ddb9aee`                             | e2e: resume/print tests, Resume_Print on test API key, enum + hash refresh              |
| (uncommitted → commit at session end) | skill docs v4 refresh, plan/progress updates, `application/pdf` content-type            |

Plus: `repos/puppeteer` subtree added at tag `puppeteer-core-v25.16.0` (merge `415d44d`),
registered in AGENTS.md + effect-services skill tables.

### Validation state (all green at session end)

- `yarn lint` ✓, `yarn typecheck` ✓, `yarn test` ✓ (676 tests: shared 11, services-node
  600, server 55, + others)
- `nix build .#homelab-api` ✓ (fetchYarnBerryDeps hash:
  `sha256-frMthV2h9fUDKk2u9XRZrMX0oZooZ07FYFQSZajMk0w=` in BOTH
  `nix-config/modules/features/homelab-api/package.nix` and `homelab-ui/package.nix`)
- `nix eval` augustus + praeconinus toplevels ✓; shellcheck gate ✓
- `yarn workspace resume build` ✓ (vite bundles homelab-api + oidc-client-ts fine)
- e2e tests written but NOT run (user runs them in watch mode — see below)

### Key architecture facts discovered (authoritative — re-verify if stale)

- **Auth for resume → homelab-server**: kanidm id_token as `Authorization: Bearer`.
  `AuthenticationService` skips DPoP for remote (kanidm) issuers; server `jwtVerify`
  requires `aud: "homelab"` + `email` + `roles` claims — those live on the **id_token**
  (that's why homelab-frontend also sends id_token). DPoP is only for the API-key
  `/oauth/token` automation path (e2e tests use it).
- **Roles → permissions**: kanidm `claimMaps.roles.valuesByGroup` (per OIDC client) →
  `roles` claim → `OIDCIdentity` permission HashSet → `AuthorizationService` checks
  `hasPermission(resource) || hasPermission(resource.operation)`.
- **CORS**: `HttpRouter.cors()` (api.ts) with no options = `access-control-allow-origin: *`
  with reflected request headers. resume.rae-hill.dev calls already work — no change was
  needed. (Tightening = env-driven allowedOrigins; deliberately skipped to not break
  unknown consumers.)
- **Systemd hardening**: `RestrictAddressFamilies = [ ]` serializes empty → systemd resets
  to allow-all (that's why the server can bind sockets today). Chrome runs with
  `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu` under the
  existing unit hardening; no unit relaxation was needed. Watch
  `ProtectProc=invisible`/`ProcSubset=pid` if the zygote misbehaves in practice.
- **Effect v4 gotchas** (bit me; skills now updated): `HttpApiEndpoint.post(name, path,
  { payload, query, success, error, headers })` from `effect/http-api`; `Context.Service<Self,
  Def>()(id)`; `Effect.gen({ self: this }, …)`; `Effect.catch` (NOT `catchAll`);
  `Option.fromNullishOr` (NOT `fromNullable`); `Duration.Input` for durations;
  `Schema.check(Schema.makeFilter(...))` for refinements; `asUint8Array({ contentType })`
  supported; query params land in `args.query`; client calls:
  `client.resume.print({ payload, query, headers })`; DPoP `htu` excludes query strings
  (matches wifi-download e2e precedent).
- **Immer + RTK**: drafts need mutable arrays — homelab slice keeps `roles: string[]`
  internally (castDraft for payload assignment); interface stays ReadonlyArray for
  consumers.
- resume is **CSR-only vite SPA on GitHub Pages** (`public/CNAME` = resume.rae-hill.dev;
  workflows copy dist/index.html → 404.html). Route tree is generated — after adding route
  files run `yarn workspace resume build` (or dev) once and commit `routeTree.gen.ts`.
- TanStack root search params must be whitelisted in `__root.tsx validateSearch` or the
  router strips them.
- Provider effect order: PrintConfigProvider (localStorage hydrate → importPrintSettings
  apply → fonts.ready → `html[data-print-ready]`) runs BEFORE RootComponent's parent
  effect that strips `importPrintSettings` via router navigate. Don't reorder.

### Env/config surface added

- Server: `CHROME_EXECUTABLE` (optional; nix option `services.homelab-api.chromeExecutable`,
  set on augustus to `${pkgs.google-chrome}/bin/google-chrome-stable`), `RESUME_SITE_URL`
  (optional, default `https://resume.rae-hill.dev` — point at `http://localhost:5173` for
  local e2e). Both also in BOTH test-utils testing layers.
- resume (vite, build-time, public): `VITE_HOMELAB_API_URL`,
  `VITE_OIDC_AUTHORITY` (kanidm client-scoped discovery base:
  `https://idm.plato-splunk.media/oauth2/openid/homelab`), `VITE_OIDC_CLIENT_ID` —
  committed `.env.production` + `.env.development`. `homelabEnv.enabled` gates everything;
  unset env = integration stays dark (no crash).
- kanidm (oidc.nix): callbacks `https://resume.rae-hill.dev/oauth-callback` +
  `http://localhost:5173/oauth-callback`; scopeMap + claimMap for group `resume.printing`
  → role `Resume_Print`; group provisioned in features/kanidm/service.nix with jacob + rae
  as members.
- e2e: `Resume_Print` added to `test-api-key-1` in `packages/homelab-server/private/api-keys.json`
  and to the nix apiKeys permissions enum.

### What remains (ordered)

1. **Commit the working tree** (skill/doc updates + `application/pdf` contentType tweak —
   re-run `yarn lint`/`yarn typecheck` first; the contentType change is in
   `packages/homelab-api/src/homelab/resume/print.ts`).
2. **User-driven deploy**: resume GH Pages rollout ✅ DONE 2026-11-04 (live at
   https://resume.rae-hill.dev with print-ready signal + import param). Still pending:
   `nixos-rebuild switch` augustus (kanidm provisioning applies resume.printing group +
   claim map + callbacks; homelab-api gets CHROME_EXECUTABLE), which needs a push first
   (user's yubikey; agents never push).
3. **e2e run (USER runs watch mode — agents must not start the server)**: dev server needs
   in `.env-local`: `CHROME_EXECUTABLE=$(which google-chrome || which chromium)` and
   `RESUME_SITE_URL=http://localhost:5173` (+ `yarn workspace resume dev` running, or use
   the deployed site once live). Success test needs chrome on the machine; asserts `%PDF`.
   **VERIFIED 2026-11-04:** full suite green (14 files / 108 tests) against a throwaway
   backend on :3100 (env-prefixed `yarn exec tsx --env-file=.env-local src/main.ts`, NO
   `--watch` so it's one killable PID) with
   `CHROME_EXECUTABLE=/nix/store/bnpw53y1w97ap7yvvr6livnkswgijif0-chromium-156.0.8078.79/bin/chromium`
   (`nix build nixpkgs#chromium`; the machine has no chrome on PATH) and
   `RESUME_SITE_URL=https://resume.rae-hill.dev` (LIVE site — user deployed it; bundle
   confirmed to contain `data-print-ready` + `importPrintSettings`). The success test
   rendered a real `%PDF` through the live site in ~4.6s. `E2E_BASE_URL` env override on
   `BASE_URL` (test-utils/api-client.ts) enables running against an alternate port
   without disturbing the :3000 dev server. NOTE: `yarn workspace <ws> exec` runs from
   the repo ROOT — cd into `packages/homelab-server` first or `--env-file=.env-local`
   won't resolve.
4. **Manual verification checklist** (user, on tailnet):
   - resume.rae-hill.dev shows Sign in (header) after the reachability probe
   - login → kanidm → /oauth-callback → back home signed in (email shown)
   - purple download FAB appears above the settings FAB for `resume.printing` members
   - click → spinner → PDF downloads; dark mode prints dark when the site is in dark mode
   - off-tailnet: no login button, no FAB, no console noise beyond the failed probe
5. **Optional polish** (not blocking): silent token renew (oidc-client-ts
   `automaticSilentRenew` is off; sessions expire with the id_token), IdP-side logout
   (`signoutRedirect` — needs post-logout URI registered), browser pooling in
   PdfPrintService if print volume ever warrants, `RESUME_SITE_URL` per-deployment in nix
   (currently the code default), praeconinus sanity (resume group dark there: feature
   flags omit Resume_Print → 404/403 via FeatureFlagService — verify gracefully).

### Gotchas for the next agent

- Run node/yarn ONLY via `nix develop . --command yarn …` (no node/yarn on PATH).
  `yarn workspaces foreach -At run lint` per-workspace fails (eslint not in PATH);
  use root `yarn lint` (`-Apt`).
- `git add` new files before ANY `nix eval`/`nix build` (flake reads the git tree;
  homelab-api derivation even requires a CLEAN tree — commit before eval).
- yarn.lock changes ⇒ redo the `nix-hashes` dance for BOTH package.nix files (fakeHash →
  `nix build .#homelab-api` → paste `got:` hash). Happens on ANY dependency add.
- The harness auto-formats files after write/edit — if an edit tool call fails to match,
  re-read the file first.
- `Effect.runPromise` boundaries in resume live in `state/homelab/{runtime,print}.ts` and
  hooks — keep effectful code as Effects; dispatch at the boundary only.
- Test scoping trap: `@effect/vitest` `it.effect(name, () => Effect…)` — variables used in
  the `.pipe(Effect.provide(...))` section must be declared OUTSIDE the generator.
- Commits: `git commit --no-verify`; NEVER push (user's yubikey).
- Subagents: use lighter models (e.g. `qwencloud-token-plan-personal/qwen3.8-flash` —
  NO variant suffix, it errors) for exploration; they work well.
- The FIRST exploration subagent (`ses_e5d7dd9f8ffevi9Hz1AH7ic5lC`) never reported; a
  duplicate on the flash model (`ses_e5bff9f59ffeX3IVhXEs9qtdPt`) delivered the findings
  summarized in plan.md Phase 1c/2d. Neither is needed anymore.
