# 05 — Nix & Secrets (T9): OpenRouter Key, Env Plumbing, Kanidm Role, Feature Flag

> **STATUS (2026-11-08): T9 COMPLETE + DEPLOYED + FIELD-VERIFIED.** §1 sops secret added by
> owner (`7077d7b2b444`); §3 augustus wiring landed + eval-verified (`e30f55bb2`). §5 kanidm:
> owner went beyond Option A — dedicated groups `homelab.resume.printing` /
> `homelab.resume.tailoring` (`9727a4ceb1ff`); the `resume.printing` name below is historical.
> Owner deployed and confirmed live tailoring works. Remaining: redaction grep (Test Plan) —
> see progress.md §Open items.

## Purpose & Scope

Deployment wiring for the resume-tailor feature: the OpenRouter API key secret and its delivery into
`homelab-api` as an env var, the kanidm `Resume_Tailor` role claim, feature-flag posture per host,
the permissions-enum drift fix, local dev env, and ops acceptance checks. **No TypeScript is designed
here** — `env.ts` / `Config.String` consumption belongs to doc 02. Task **T9**: independent of T1–T8,
must land before deploy (T10 e2e depends on it).

## Verified Current State (2026-11)

### Secret chain example — inbound API key (`homelab_api_key_jacob`)

1. **ENC value** in `nix-config/secrets/augustus.yaml` (line 24); sops/age-encrypted,
   `sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt"` per `_private/augustus/sops.nix` line 10.
2. **Declared** at `_private/augustus/sops.nix` lines 126–129 (`{ owner = "homelab-api"; group = "homelab-api"; }`)
   → sops-nix renders `/run/secrets/homelab_api_key_jacob`, 0400, owner `homelab-api`.
3. **Referenced** at `_private/augustus/programs.nix` lines 73–85
   (`apiKeys.jacob.apiKeyFile = config.sops.secrets.homelab_api_key_jacob.path`), mirrored into the
   provisioner at line 91 (`apiKeys = config.services.homelab-api.apiKeys`), then **rendered** by
   the oneshot (`secret-provisioner.nix`, `provision_api_keys` 67–85) into
   `/var/lib/homelab-api/api-keys.json`.

This chain is for **inbound** API keys. The OpenRouter key is an **outbound** secret — it does NOT
go through the provisioner; mirror the nullable-option → env-template route below.

### Env delivery — `features/homelab-api/systemd-service.nix`

- `sops.templates."homelab-api-env"` (lines 182–225) is the unit's **single** `EnvironmentFile`
  (line 248). Conditional vars use `${if cfg.X != null then "VAR=${cfg.X}" else ""}` — lines 214–216
  (`SERIAL_NUMBERS_FILE`, `CHROME_EXECUTABLE`, `RESUME_SITE_URL`); nullable-option pattern to copy:
  `chromeExecutable` lines 134–142 (`nullOr str`, default `null`).
- `FEATURE_FLAGS` rendering lines 204–206: entries become `"<flag>.enabled"`, `*` passes through;
  option default `[ "*" ]` (line 83) → augustus (unset) ships `FEATURE_FLAGS=*`.
- **No `LoadCredential` anywhere** in `nix-config/` (grep-verified) — do not introduce it.
- Deploy gotcha, lines 21–23: `commitHash = inputs.self.rev or (throw "Cannot deploy homelab-api
  from a dirty tree…")` — **nix/secret changes must be committed before rebuild.**

### Permissions-enum drift

Two independent `lib.types.enum` permission lists: `systemd-service.nix` lines 107–118 **has**
`Resume_Print` (line 117); `secret-provisioner.nix` lines 120–132 **lacks** it. Since `programs.nix`
line 91 feeds the same attrset into both options, any key granted `Resume_Print`/`Resume_Tailor`
fails evaluation on the provisioner side. Latent today (jacob's key, lines 77–83, lists neither);
fix in T9. The nix enums must track the TS `ResourceURIsSchema` + FGA matcher (paths in the TS-side
list under File-by-File Changes) — doc 03's job.

### Kanidm — `features/homelab-api/oidc.nix`

- `scopeMaps."resume.printing"` lines 46–50 (`openid profile email`);
  `claimMaps.roles.valuesByGroup."resume.printing" = [ "Resume_Print" ]` lines 71–73.
- Group declared in `features/kanidm/service.nix` lines 81–82; memberships: `jacob` (line 149),
  `rae` (line 184).

### Host split

| Fact         | Augustus                                                                                              | Praeconinus                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modules      | `hosts/augustus.nix` line 46 `nixos.homelab-api` (= provisioner+service+catalog+oidc, `complete.nix`) | `hosts/praeconinus.nix` lines 22–23: service + provisioner **only**; no catalog/OIDC, `requiresKanidm = false` (`_private/praeconinus/programs.nix` line 21) |
| apiKeys      | jacob (programs.nix 73–85)                                                                            | `{ }` (lines 22, 37)                                                                                                                                         |
| featureFlags | default `[ "*" ]`                                                                                     | explicit wifi/certs/dns/cert/status list (lines 23–31) — **no `Resume_*`**                                                                                   |
| sops         | many, incl. `homelab_api_*` (`_private/augustus/sops.nix`)                                            | only `homelab_api_jwk_password` (`_private/praeconinus/sops.nix` 6–9)                                                                                        |
| Caddy        | catalog vhost (`features/homelab-api/catalog.nix` line 23 `backend.reverseProxy.port = svc.port`)     | hand-written vhost (programs.nix 40–60), plain `reverse_proxy 127.0.0.1:35427` (line 51)                                                                     |

Port 35427: `service-registry.nix` line 282 (`constants.services.homelab.port`).

### Local dev

- `packages/homelab-server/.env-local` (tracked): `FEATURE_FLAGS=*` (line 6), key material as
  `./private/*` paths (`private/` gitignored — `.gitignore` line 13). Optional vars are simply
  absent from `.env-local`/`.env-serve-test`.
- `scripts/stage-e2e-secrets.mjs` regenerates e2e fixtures: `private/api-keys.json` (contract
  lines 67–95; `test-api-key-1` already carries `Resume_Print`, line 81), jwk/hmac material, and
  `.env-serve-test` from its inline template (lines 157–171). **Idempotent — never overwrites
  existing files.** Invoked by `scripts/e2e.sh`.

### Ports / Caddy — no changes (verified)

`POST /resume/tailor` rides the existing service: same listener (`PORT=35427`, systemd-service.nix
line 186), same augustus catalog vhost and praeconinus `reverse_proxy`, neither with an in-flight
timeout — the 10–40s LLM latency is fine (README: the 60s worry is moot). **`docs/port-assignments.md`
untouched** (port-assignments skill: only port/firewall/container-mapping changes trigger updates).

## Design

### 1. Sops secret — `homelab_api_openrouter_key` (augustus only)

Naming follows `<service>_<purpose>` (`homelab_api_jwk_password`, `homelab_api_key_jacob`). Sops
decrypts to file content **with a trailing newline** — the doc-02 reader must trim (as the
provisioner does with `rtrimstr("\n")`, secret-provisioner.nix line 74). Encryption is a **human
action — agents must not run `sops`** (denied by AGENTS.md policy). For the owner (age key
`~/.config/sops/age/keys.txt` must already be a recipient): `sops edit
nix-config/secrets/augustus.yaml`, add a top-level `homelab_api_openrouter_key: |` entry with the
single-line `sk-or-v1-…` value, then `git add nix-config/secrets/augustus.yaml`.

### 2. New nix option + env template line (shared module)

In `systemd-service.nix`, mirroring `chromeExecutable` (134–142): `openRouterApiKeyFile =
lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "Path to a
file holding the OpenRouter API key; exported as OPENROUTER_API_KEY_FILE. Null where the tailor is
dark (praeconinus)."; }`

And in the `homelab-api-env` template, beside lines 214–216:
`${if cfg.openRouterApiKeyFile != null then "OPENROUTER_API_KEY_FILE=${cfg.openRouterApiKeyFile}" else ""}`

**TS consumption is doc 02**: `Config.option(Config.String("OPENROUTER_API_KEY_FILE"))` in
`packages/homelab-server/src/env.ts` + redacted file read; fail-fast when absent is specified there.

### 3. Wiring — `_private/augustus` (augustus-only)

- `sops.nix` (after lines 126–129): `sops.secrets.homelab_api_openrouter_key = { owner = "homelab-api"; group = "homelab-api"; };`
- `programs.nix` (in the `services.homelab-api` block, 64–86, beside `serialNumbersFile` line 68):
  `openRouterApiKeyFile = config.sops.secrets.homelab_api_openrouter_key.path;`

- Nothing under `_private/praeconinus/`: default `null` → no env var → doc-02 fail-fast — the whole
  praeconinus-dark story on the secret side.

### 4. Permissions enums — `Resume_Tailor` + drift fix

- `systemd-service.nix` enum (107–118): append `"Resume_Tailor"`.
- `secret-provisioner.nix` enum (120–132): append `"Resume_Print"` **(drift fix)** and
  `"Resume_Tailor"` — the two enums then match each other and the TS `ResourceURIsSchema` (doc 03).
- Optional (recommended): grant jacob's local key both resume permissions in programs.nix 77–83 —
  parity with the e2e `test-api-key-1` contract is the drift fix's point, and proves the enums.

### 5. Kanidm role claim — README open question #5

**Option A (recommended, v1): reuse the `resume.printing` group.** One edit: claim map 71–73 →
`"resume.printing" = [ "Resume_Print" "Resume_Tailor" ];`. scopeMap (46–50), group (service.nix
81–82) and memberships (149, 184) already exist — zero new provisioning; jacob + rae get tailor
immediately. _Tradeoff:_ print and tailoring can never be revoked independently and the group name
under-describes its contents (fixable with a comment).

**Option B: dedicated `resume.tailoring` group.** New group in kanidm `service.nix`, new scopeMap +
claimMap entries in `oidc.nix`, new memberships. Clean per-capability ACLs; costs four touched spots
plus a group to keep provisioned. v1 is family-only on augustus → **A**; revisit if non-family
print users appear.

### 6. Feature flag — no nix change needed

Flag name = resource URI `Resume_Tailor`; `AuthorizationService` checks `FeatureFlagService.enabled`
first (doc 03; `feature-flag-service.ts` lines 20–33: matches `*`, else `<resource>.enabled` /
`<resource>.<op>.enabled`).

- **Augustus**: keeps default `[ "*" ]` → `FEATURE_FLAGS=*` → tailor enabled. **Do NOT set
  `featureFlags = [ "Resume_Tailor" ]`** — the option _replaces_, not appends, switching off every
  other flag on augustus.
- **Praeconinus**: explicit list (programs.nix 23–31) already omits `Resume_*` → dark by flag too
  (belt to §3's suspenders). **Dev/test**: both env files already ship `FEATURE_FLAGS=*`.

### 7. Local dev + e2e

- `.env-local`: append `OPENROUTER_API_KEY_FILE=./private/openrouter-api-key`. The dev creates the
  real file themselves (`umask 077; printf '%s' 'sk-or-v1-…' >
  packages/homelab-server/private/openrouter-api-key`) — **never inline a key in a tracked file**
  (`private/` is gitignored).
- `scripts/stage-e2e-secrets.mjs`: stage a dummy so `e2e` boots on any fresh clone without a real
  key — add `await stage(path.join(privateDir, "openrouter-api-key"), async () => "sk-or-e2e-dummy-not-a-real-key")`
  and the matching `OPENROUTER_API_KEY_FILE=./private/openrouter-api-key` line to the inline
  `envServeTest` template (157–171). Devs with an existing `.env-serve-test` must delete it to
  regenerate (idempotent-by-design). E2e must not hit OpenRouter: the dummy key makes any live
  provider call fail auth; real tailor-path coverage is doc 03's mocked-`TailorService` handler
  tests / doc 02's stubbed-`HttpClient` pipeline tests + evals.

### 8. Egress & unit hardening — verify, don't change

The unit already makes outbound HTTPS (kanidm OIDC discovery + step-ca; `env.ts` lines 13–14) under
its current hardening (systemd-service.nix 244–277; `RestrictAddressFamilies = [ ]` at line 272
imposes no restriction; `ProtectSystem`/`ProtectHome` don't block `/run/secrets`). OpenRouter egress
should need **zero** unit changes — confirm at deploy time (Test Plan step 6).

### 9. Log-redaction ops acceptance check (initial plan §10)

> **V2 note (2026-11-09, [`07-v2-plan.md`](./07-v2-plan.md) §G/T18):** the IMPLEMENTATION of
> redaction changes — manual key-pattern redaction (`SENSITIVE_KEY_PATTERN` in logger.ts,
> `RedactingSpanProcessor` in otel.ts) is removed in favor of `Redacted`-at-the-source for every
> sensitive value (`Redacted.toString/toJSON` auto-redacts). This acceptance grep REMAINS the
> deploy-time check and must still return 0.

Code-side redaction (`Authorization` header + provider dumps out of logs/OTel — augustus runs Tempo,
so `OTEL_GRPC_ENDPOINT_URL` is rendered, template lines 217–222) is doc 02's job; the **operational
gate** lives here — Test Plan step 7.

## File-by-File Changes

| File                                                                     | Change                                                                                                                      | Scope                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `nix-config/secrets/augustus.yaml`                                       | + `homelab_api_openrouter_key` ENC entry (`sops edit`, human-only)                                                          | **augustus-only**                       |
| `nix-config/modules/_private/augustus/sops.nix`                          | + `sops.secrets.homelab_api_openrouter_key` (owner/group `homelab-api`)                                                     | **augustus-only**                       |
| `nix-config/modules/_private/augustus/programs.nix`                      | + `openRouterApiKeyFile = …path`; optionally + `Resume_Print`/`Resume_Tailor` on jacob's key                                | **augustus-only**                       |
| `nix-config/modules/features/homelab-api/systemd-service.nix`            | + `openRouterApiKeyFile` option (null default) + conditional `OPENROUTER_API_KEY_FILE` template line + enum `Resume_Tailor` | shared module (praeconinus unaffected)  |
| `nix-config/modules/features/homelab-api/secret-provisioner.nix`         | + `Resume_Print` (drift fix) and `Resume_Tailor` to its enum                                                                | shared module (no-op for `{ }` apiKeys) |
| `nix-config/modules/features/homelab-api/oidc.nix`                       | claimMap `"resume.printing"` → `[ "Resume_Print" "Resume_Tailor" ]` (Option A)                                              | augustus (only host importing oidc)     |
| `nix-config/modules/features/kanidm/service.nix`                         | only if Option B: `resume.tailoring` group + memberships                                                                    | augustus                                |
| `packages/homelab-server/.env-local`                                     | + `OPENROUTER_API_KEY_FILE=./private/openrouter-api-key`                                                                    | dev-local (tracked env file)            |
| `scripts/stage-e2e-secrets.mjs`                                          | + dummy `private/openrouter-api-key` staging + `envServeTest` line                                                          | dev/e2e                                 |
| `nix-config/modules/_private/praeconinus/**`                             | **nothing**                                                                                                                 | —                                       |
| `docs/port-assignments.md`, `catalog.nix`, `service-registry.nix`, caddy | **nothing** — route rides the existing vhost/port; no timeouts configured                                                   | —                                       |

TS-side files docs 02/03 will touch (listed, not designed): `packages/homelab-server/src/env.ts`,
`packages/homelab-services/src/config/`, `packages/homelab-services/src/schemas/resource-uris.ts`,
`packages/homelab-services-node/src/layers/fine-grained-authorization-service.ts`,
`packages/homelab-e2e-tests/test-utils/testing-layer.ts`.

## Task Breakdown — T9

1. **T9.1 Secret + option plumbing** (§1–§3). Done when: owner has run `sops edit`; option, template
   line and augustus wiring landed; `nix eval
   '.#nixosConfigurations.augustus.config.sops.templates."homelab-api-env".content' --raw | grep OPENROUTER_API_KEY_FILE`
   matches and the same eval for praeconinus prints nothing. _If any **new** `.nix` file is created
   (none expected), `git add` it before `nix eval`/`nix build` — flakes evaluate the git tree
   (validation skill)._
2. **T9.2 Enum drift fix** (§4). Done when: both enums identical and jacob's key with `Resume_Print`
   evaluates clean.
3. **T9.3 Kanidm claim** (§5, Option A unless the owner decides B). Done when: `nix eval
   '.#nixosConfigurations.augustus.config.homelab.catalog.homelab-api.oidc.claimMaps.roles' --json`
   shows `Resume_Tailor`.
4. **T9.4 Local dev + e2e stub** (§7). Done when: fresh worktree → `node scripts/stage-e2e-secrets.mjs`
   then `e2e` boots, and `yarn lint && yarn typecheck && yarn test` is green. The shellcheck gate
   (`nix build .#checks.x86_64-linux.shellcheck`) only re-runs if shell text changes — none here.
5. **T9.5 Deploy + ops verification** (Test Plan). Done when everything is **committed** (dirty tree
   trips the `commitHash` throw, systemd-service.nix 21–23) and all smoke steps pass.

## Test Plan (deploy-time smoke, augustus)

1. **Commit first** — a dirty tree fails rebuild at the `commitHash` throw.
2. **Build gates:** `nix build '.#nixosConfigurations.augustus.config.system.build.toplevel'` and
   the praeconinus equivalent (guards shared-module edits against the restricted host).
3. **Env file:** `systemctl cat homelab-api | grep EnvironmentFile` shows the rendered
   `homelab-api-env` path; as root it contains `OPENROUTER_API_KEY_FILE=/run/secrets/homelab_api_openrouter_key`
   and that secret file is 0400 `homelab-api`.
4. **Auth gates:** unauthenticated `POST https://homelab-api.plato-splunk.media/resume/tailor` → 401;
   token without `Resume_Tailor` → 403; jacob's OIDC token → 200 (or provider 5xx — either way the
   request reached the pipeline).
5. **Praeconinus dark:** `POST https://praeconinus.neko-bicolor.ts.net:8443/api/resume/tailor` →
   cleanly refused (flag-off 403 or doc-02 fail-fast — never a stack-trace 500); its env file has no
   `OPENROUTER` line.
6. **Egress under hardening:** `journalctl -u homelab-api -b | grep -iE 'ENOTFOUND|ECONNREFUSED|EACCES|EPERM'`
   empty and step 4's authorized call got a provider answer → `api.openrouter.com` egress works with
   no unit changes (§8).
7. **Redaction grep:** after a real smoke request, `journalctl -u homelab-api --since "-1 hour" |
   grep -c 'sk-or-'` → **0**, and the request's Tempo trace shows no `Authorization` value or
   provider body dump. Non-zero ⇒ block rollout until doc 02's redaction lands.

## Open Questions

1. **Kanidm group choice** (README #5): Option A reuse vs Option B dedicated (§5). Draft stance: A.
2. **Key rotation policy** — cadence/expiry. Mechanically cheap (`sops edit` → commit → deploy;
   sops re-encrypts in place). Rotate-on-suspicion vs scheduled (e.g. annually with the
   restic-passphrase refreshes). Confirm one account key covers both stage-1/stage-2 models — assumed yes.
3. **jacob local-key permissions** — grant `Resume_Print`/`Resume_Tailor` now (§4), or keep resume
   endpoints OIDC-only?

## Cross-References

- **Doc [02-ai-pipeline.md](./02-ai-pipeline.md)** — `OPENROUTER_API_KEY_FILE` consumption: `env.ts`
  `Config.option(Config.String(...))`, redacted file reader, fail-fast when absent (what makes
  praeconinus-dark _safe_), log/OTel redaction implementation.
- **Doc [03-api-endpoint.md](./03-api-endpoint.md)** — `Resume_Tailor` in `ResourceURIsSchema` + FGA
  matcher arm, `AuthorizationService`/feature-flag ordering, e2e auth tests (Test Plan steps 4–5 are
  its deploy-side acceptance), testing-layer key contract.
- **[README.md](./README.md)** — corrected repo facts (the nix rows this doc builds on), open
  question #5, task graph (T9 → T10).
- Skills: `nix-services` (failure-notifs — `homelab-api` already attached; no new units),
  `port-assignments` (no port changes → no doc update), `validation` (git-add-before-eval; shellcheck
  gate scoping).
