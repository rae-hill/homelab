# Remote Printing Feature — Progress Log

Handoff log for agents. Newest entries at the top. Read `README.md` + `plan.md` first.

---

## 2026-11-03 — Session 1 (planning + research)

### Done

- Created this docs directory: `README.md` (vision/architecture/decisions), `plan.md`
  (8 phases with file-level checklists), `progress.md`.
- Researched the codebase (details baked into plan.md):
  - resume print-config domain: `packages/resume/src/state/print-config/` — Effect v4
    schemas (`schema.ts`), base64 codec (`persistence.ts`: `StringFromBase64 ∘
    fromJsonString ∘ PersistedPrintConfig`), redux slice/store/provider/hooks,
    import/export UI (`config-io.tsx`), settings FAB (`print-config-fab.tsx`, gated by
    Konami `editingEnabled`).
  - resume deploy: GitHub Pages (`public/CNAME` = `resume.rae-hill.dev`), workflows
    `.github/workflows/resume-deploy{,-manual}.yml`, vite 8 + TanStack Router +
    Chakra v3 + next-themes (color mode via `data-theme`/`class` attr).
  - auth model: kanidm OIDC client `homelab` (PKCE public client,
    `nix-config/modules/features/homelab-api/oidc.nix`) with `claimMaps.roles`
    group→role values; `roles` claim (`Constants.JWT_ROLES_KEY`) → `OIDCIdentity`
    permission HashSet; `AuthorizationService` checks `hasPermission(resource) ||
    hasPermission(resource.operation)`; fine-grained matcher per resource in
    `homelab-services-node/src/layers/fine-grained-authorization-service.ts`.
  - Effect v4 endpoint style: `HttpApiEndpoint.post(name, path, { payload, query,
    success, error, headers }).middleware(…)` from `effect/http-api` — the
    `adding-endpoints` skill is stale (v3 chains + `@effect/platform` imports);
    update it in Phase 4.
  - env plumbing: `EnvDef` (homelab-services) + `EnvLive` (homelab-server/src/env.ts) +
    sops template `homelab-api-env` (systemd-service.nix). Feature flags default `*`
    on augustus; praeconinus restricted.
  - systemd hardening on homelab-api unit will fight headless chrome
    (`RestrictAddressFamilies=[]`, `RestrictNamespaces`, `PrivateDevices`,
    `ProtectProc=invisible`) — plan Phase 7 lists relaxations + chrome args.
  - nixpkgs pattern for puppeteer: `puppeteer-cli` uses
    `PUPPETEER_EXECUTABLE_PATH=${chromium}/bin/chromium`; we'll use `google-chrome` +
    `CHROME_EXECUTABLE` env + `puppeteer-core` npm dep.
  - `homelab-shared` deps `@effect/platform-node`, `bufferutil`, `utf-8-validate` are
    **unused in src** — safe to drop during the rename → browser-safe `shared`.

### User decisions (authoritative)

1. Rename existing `packages/homelab-shared` → `packages/shared` (npm name `shared`);
   do NOT create a parallel package.
2. Authorization: new kanidm group dedicated to resume-printing, mapped via
   `claimMaps.roles` (features/homelab-api/oidc.nix) → `roles` claim → permissions.
3. OIDC: prefer a library (`oidc-client-ts` candidate) wrapped in Effect services in
   `shared`; reusable for a future homelab-frontend rewrite.
4. Delegate to subagents where sensible; use lighter models
   (e.g. `qwencloud-token-plan-personal/qwen3.8-flash#low`, free `opencode/*` models)
   for exploration/simple tasks; user runs e2e watch mode themselves; commit with
   `--no-verify`, never push.

### In flight

- Background explore subagent (sessionID `ses_e5d7dd9f8ffevi9Hz1AH7ic5lC`) mapping:
  homelab-frontend OIDC flow (token exchange w/ homelab-server, DPoP in browser?),
  homelab-server `/oauth/token` + `/oauth/claim-check` semantics, CORS config
  location, `/status/health` guest accessibility, auth-middleware header expectations,
  kanidm client nix wiring. **When it lands:** fold findings into plan.md Phase 1c/2
  (resolve the "Open questions" callout) and record a summary here.

### Next steps (ordered)

1. Incorporate explore report → finalize Phase 1c/2 design (OIDC/DPoP/token exchange).
2. Phase 1a: rename homelab-shared → shared (+ nix-hashes after yarn.lock change).
3. Phase 1b: extract print-config schemas/codecs → shared; re-point resume; tests.
4. Phase 1c: OIDC Effect services in shared (oidc-client-ts + DPoP via Web Crypto).
5. Then Phases 2–8 per plan.md.

### Gotchas

- `git add` new `.nix` files before `nix eval`/`nix build` (flake reads git tree).
- yarn.lock changes ⇒ update `fetchYarnBerryDeps` hashes (`nix-hashes` skill) in
  `nix-config/modules/features/homelab-api/package.nix` + `homelab-ui/package.nix`.
- resume tsconfig is standalone (Bundler resolution, not the NodeNext base) — importing
  workspace `shared` source (exports map → `./src/index.ts`) works via vite; verify
  typecheck.
- Do not run e2e tests against a self-started server.
- Vivaldi printing is the motivating pain point; chrome PDFs are the goal.
