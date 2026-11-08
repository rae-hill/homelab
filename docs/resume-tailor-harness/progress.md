# Resume Tailor — Progress & Session Handoffs

Living document. Update after every work session (and before context gets tight) so any agent can
pick up cold. Convention follows `docs/remote-printing-feature/progress.md`.

**Cold-start instructions for the next agent:** read [`README.md`](./README.md) (decisions D1–D9,
wire contract, task graph) → the section doc for your task → the sources it cites. House rules:
`AGENTS.md` + `.opencode/skills/` (`validation`, `adding-endpoints`, `effect-services`, `frontend`
does NOT apply to `packages/resume` — it's React/RTK/Chakra, not the SolidJS homelab-frontend).

## Status

| Task | Doc | Scope one-liner                                                                            | Status                                                                                                | Commit         |
| ---- | --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------- |
| T1   | 01  | Extract content schemas+defaults to `shared`; extend `ContentState` (blurb/aboutMe)        | **done** (barrel is `export * as Schema`, so schemas are `ResumeContent.Schema.X`; types flat)        | `62d248e97683` |
| T2   | 01  | `ContentPatchBase64` codec (decode-to-state) + wire schemas in homelab-services            | **done** (JSON-Schema emission snapshot deferred to T5)                                               | `0dab24d048fa` |
| T3   | 03  | `POST /resume/tailor` endpoint + handler + `Resume_Tailor` authz chain + unit tests        | **done** (Live layer is a PLACEHOLDER failing 500 until T4)                                           | `afd402ddc11c` |
| T4   | 02  | `TailorService`/`OpenRouterClientService`/`TailorQuotaService` tags + env + layer skeleton | **done** (quota refactored to layer-owned Ref + Clock per owner directive)                            | `db5134460c1d` |
| T5   | 02  | Cleanup stage + prompts + model-facing wire schemas                                        | **done** (slugs are TBD placeholders — owner picks, README OQ1)                                       | `db5134460c1d` |
| T6   | 02  | Validation pipeline + merge + quota + evals                                                | **done** (offline evals; live evals gated RUN_TAILOR_LIVE)                                            | `db5134460c1d` |
| T7   | 04  | NEW `homelab-services-browser` pkg + entry-store/preset services + thin tailor slice       | **done** (25 browser tests; usePresets refactored, API unchanged; save onCollision default=overwrite) | `5e45edd1782a` |
| T8   | 04  | Tailoring tab + details modal + auto-apply flow + blurb/aboutMe wiring                     | **done** (manual browser check still pending — no headless UI test in v1)                             | `1f1b8e76b862` |
| T9   | 05  | sops key + env template + kanidm claim + enum drift fix + local dev                        | **partial done** (§§2,4,5,7 committed; §1 owner sops edit + §3 augustus wiring deferred)              | `f5f02a6fd9b9` |
| T10  | 03  | e2e tests (vitest; live-AI gated)                                                          | **done** (resume 9✓+1 skip; FULL suite 15 files 112✓+1 skip exit 0; required undici-bundle fix)       | `7900cdab4a17` |
| T11+ | 06  | Stretch: postgres persistence, category bases, cache decorator (NOT v1, D9)                | deferred                                                                                              | —              |

Waves (README task graph): **A:** T1→T2→T3. **B (parallel after T2):** T7 and T4→T5→T6.
**C:** T8 (after T3+T7), T9 any time, T10 last. Every task ends with
`yarn lint && yarn typecheck && yarn test` green (+ `nix build .#checks.x86_64-linux.shellcheck`
if shell text changed; `git add` new `.nix` files BEFORE any `nix eval`/`nix build`).

## Human-only / owner decisions (blocking flags)

- **Sops encryption (T9.1):** agents must NOT run `sops` (denied). Owner runs
  `sops edit nix-config/secrets/augustus.yaml` and adds `homelab_api_openrouter_key` (doc 05 §1).
- **Model slugs (README OQ1, blocks T5 go-live not T5 code):** owner picks stage-1/stage-2 slugs;
  env-overridable, pin dated slugs.
- **Kanidm group (README OQ5):** doc 05 §5 recommends Option A (reuse `resume.printing` claim map).
- **Deploy:** `systemd-service.nix` throws on a dirty git tree — commit before deploying.

## Gotchas learned so far (carry forward)

- `yarn.lock` changes (T7 adds the `homelab-services-browser` workspace) ⇒ refresh
  `fetchYarnBerryDeps` hashes per the `nix-hashes` skill (`homelab-api` + `homelab-ui` package.nix).
- Permissions enums are duplicated in `secret-provisioner.nix`/`systemd-service.nix` and already
  drifted (`Resume_Print` missing in the former) — T9.2 fixes both + adds `Resume_Tailor`.
- `featureFlags` option REPLACES (augustus keeps `["*"]`); praeconinus stays dark (owner-confirmed).
- `JsonPatch.apply` throws; `toDifferJsonPatch.diff` takes TYPED values (encodes internally);
  `decodeTo` getters bridge `From.Type ↔ To.Encoded` (doc 01 §D has the verified chain).
- Chakra v3 Dialog: `placement` is center/top/bottom only; details view is a plain centered modal (D7).
- **shared barrel convention (verified T1):** `packages/shared/src/index.ts` exports namespaces
  (`export * as ResumeContent`), and each module's `index.ts` re-exports TYPES flat but SCHEMAS
  under `export * as Schema`. So from a consumer: types are `ResumeContent.ContentState`,
  schemas/values are `ResumeContent.Schema.ContentState` and `ResumeContent.INITIAL_CONTENT_STATE`
  (constants are values re-exported flat). Doc 01's sketches wrote flat `ResumeContent.ContentState`
  for the SCHEMA — that is the TYPE; use `.Schema.` for the schema object. Same for `Schemas.OptionalWithDefault`.
- **Owner directive (2026-11-07): service state must be layer-owned, not module-scoped.** Mutable
  state lives in Effect `Ref`s created inside the layer (house precedent: `puppeteer-service.ts`),
  updated atomically (`Ref.modify`); use `Mutex`/`Semaphore` from Effect when coordination is
  needed; time comes from `Clock.currentTimeMillis` (TestClock-testable), never `Date.now()`.
  Configurable internals = parameters of a `makeXService(...)` layer factory with defaults
  (see `tailor-quota-service.ts`). Applies to ALL services incl. browser ones.
- Formatters run automatically via the harness — never manually; commits use `--no-verify`.

## Open items (prioritized — the work queue for the next session)

1. **OWNER — sops secret:** `sops edit nix-config/secrets/augustus.yaml` → add
   `homelab_api_openrouter_key` (the `sk-or-v1-…` value). Agents are DENIED sops. Then the 2-line
   augustus wiring lands (exact lines in doc 05 §3): `sops.secrets.homelab_api_openrouter_key =
   { owner = "homelab-api"; group = "homelab-api"; };` in `_private/augustus/sops.nix` +
   `openRouterApiKeyFile = config.sops.secrets.homelab_api_openrouter_key.path;` in
   `_private/augustus/programs.nix`. Until then the feature is dark (absent key → clean
   TailorError; hosts boot fine).
2. **OWNER — model slugs (README OQ1):** code defaults are `"TBD/stage2-model"` /
   `"TBD/stage1-model"` (`packages/homelab-server/src/env.ts`) — live calls fail until real slugs
   are set via `OPENROUTER_MODEL` / `OPENROUTER_CLEANUP_MODEL`. Decide: env-template lines in
   `systemd-service.nix` (doc 05 §2 pattern) vs real code defaults. Pin dated slugs, never aliases.
3. **Live smoke (needs 1+2):** `RUN_TAILOR_LIVE=1` on the e2e tailor test, or paste a real listing
   in the UI. Review quality against doc 02 §I (injection + poor-fit are the regression-critical
   evals). Tune prompts if needed — bump `promptVersion` (layers/tailor/prompts.ts) when you do.
4. **Manual browser check of the Tailoring tab** (no headless UI test in v1): tab visible; submit
   gated when signed out; pending entry → success; auto-apply + "Pre-tailor: …" preset snapshot
   toast; details modal (verdict/tips/keywords/meta); Apply-from-modal + Delete; blurb/aboutMe
   editable in Heading tab and rendering on the resume; print output contains no tailor data.
5. **Deploy (needs 1–4):** everything committed → deploy augustus (dirty-tree guard requires it)
   → doc 05 Test Plan smoke steps 3–7, including the redaction grep
   (`journalctl -u homelab-api --since "-1 hour" | grep -c 'sk-or-'` must be 0).
6. **Backlog (unscheduled):** Cypress browser e2e (doc 03 backlog, owner-requested "at some
   point"); doc 06 stretch phase — postgres persistence + category-keyed bases + cache decorator
   (owner wants to do persistence together); "update entry from current content" nicety (README
   OQ4); frozen-base registry mechanics (doc 01 §B — only needed when defaults change);
   PersistedPrintConfig versioning (doc 01 OQ2 — defer until first breaking change); kanidm
   dedicated `resume.tailoring` group (doc 05 OQ1 — only if print/tailor ACLs must diverge).

## Session log

### 2026-11-07 — planning session (complete)

- Explored repo via subagents (resume app, api/server chain, shared/services, nix/sops); corrected
  the external agent's initial plan against reality (README §"Corrected repo facts").
- Owner decisions captured: D1 auto-apply+preset snapshot; D2 extend ContentState; D3 base64
  JSON-Patch-only wire with decode-to-state schema (owner's design); D4 no review step; D5 two-model
  pipeline; D6 local state now; D7 plain details modal; D8 small SOLID services +
  `homelab-services-browser` (tests there; resume gets no test infra); D9 NO cache in v1 (lands with
  persistence work). Cypress UI e2e = backlog (doc 03).
- Wrote docs 01–06 via cheaper-model subagents (qwen3.7-plus ×3, qwen3.8-flash ×3), reviewed
  end-to-end, fixed cross-doc inconsistencies (codec sketch, replace-only invariant → merge delta,
  TailorMeta nullable stages + listingHash, quota restored, edge-decode semantics).
- Committed planning docs: `7ea36e9d1ab7`.
- **Next:** Wave A — T1 (doc 01) via subagent, review, validate, commit; then T2; then T3.
  T9 nix-only parts run in parallel with T1 (augustus sops/programs wiring DEFERRED until the
  owner adds the `homelab_api_openrouter_key` ENC value — declaring it before would break eval).

### 2026-11-07 — implementation wave A

- **T1 done** (`62d248e97683`, qwen3.7-plus subagent, reviewed): `shared/src/resume-content/`
  (schemas + `INITIAL_CONTENT_STATE` + `CONTENT_DEFAULTS_VERSION="v1"` + blurb/aboutMe via
  `OptionalWithDefault` moved to `shared/src/schemas/`), compat re-exports in print-config,
  resume `content-defaults.ts` deleted, tests incl. old-blob compat + print purity. Full tree
  green (typecheck, 676 tests, lint 0 errors) — re-verified by the coordinating agent.
  Deviation: module barrel namespaces schemas (`ResumeContent.Schema.*`) per the print-config
  convention — see Gotchas. Components still render hard-coded constants until T8.
- **T9 partial** (`f5f02a6fd9b9`, qwen3.8-flash subagent, reviewed): nix option + env-template
  conditional, kanidm claim (Option A), permissions-enum drift fixed (both enums now
  Resume_Print + Resume_Tailor), `.env-local` + `stage-e2e-secrets.mjs` dummy key. Deferred:
  owner `sops edit` (§1) then the 2-line augustus wiring (§3, exact lines in the T9 report).
- **T2 done** (`0dab24d048fa`, qwen3.7-plus, reviewed): `ContentPatchBase64` codec in
  `shared/src/resume-content/patch.ts` (decode = apply-to-frozen-defaults inside
  `SchemaGetter.transformEffect`, apply-throw → `SchemaIssue.InvalidValue` decode failure; encode =
  `JsonPatch.get` vs `EncodedDefaults`; `ContentDiffer` exported for merge-delta assertions) +
  `Schemas.ResumeTailor` wire schemas (listing bounds 1..200k, FitReport closed taxonomy, TailorMeta
  with nullable stages + listingHash). 14+9 tests. Fixed: T1 tests sat in `src/` (shared vitest
  include = `test/**` only) → relocated; purity test likewise. Deferred: JSON-Schema emission
  snapshot (fold into T5, which needs emission for `response_format` anyway).
- **T3 done** (`afd402ddc11c`, qwen3.8-flash, reviewed): endpoint def + group wiring, resource URI,
  2 BadRequest reasons, TailorService tag (full doc-02 def incl. subject + TailorQuotaExceeded),
  handler (canCreate → baseVersion gate → service → Match mapping), FGA arm + authz-test defaults,
  PLACEHOLDER Live layer + Shell.Tailor (T4 replaces innards only), 9 handler tests, e2e file
  (live-AI gated `RUN_TAILOR_LIVE`), stage-e2e-secrets grants Resume_Tailor. Identity subject =
  `identity.identifier`. Also fixed e2e print fixture (Type-side blurb/aboutMe required since T1).
- **Wave B dispatched in parallel:** T4–T6 (doc 02, qwen3.7-plus) ∥ T7 (doc 04, qwen3.7-plus).
  Concurrency guardrails given (barrel files: edit-not-write, re-read before edit). After T7:
  nix-hashes refresh for the new workspace (yarn.lock change) before any nix build.
- NOTE: first parallel dispatch failed weirdly (one agent returned a greeting, one was cancelled)
  but both left substantial PARTIAL work on disk. Recovery pattern that worked: audit partial
  state, re-dispatch fresh agents in "audit + complete" mode sequentially, coordinator commits
  with barrel-line trim/restore when scopes share a file (services/index.ts).

### 2026-11-07 — waves B + C (complete through T8)

- **T4–T6 done** (`db5134460c1d`, qwen3.7-plus audit-and-complete): two-stage OpenRouter pipeline
  (hygiene → quota → cleanup → tailor → guards → merge → coverage → replace-only merge-delta
  assertion → degraded-never-500), OpenRouterClientService (strict json_schema, require_parameters,
  data_collection:deny, finish_reason branching, 60s timeouts), TailorQuotaService, logger+OTel
  redaction, env plumbing (OPENROUTER_API_KEY_FILE optional → hosts boot without it), 5 test suites
  (712 services-node tests). **Owner-directed refactor applied**: quota state moved from closure
  mutable Map to layer-owned `Ref` + atomic `Ref.modify`, `Clock.currentTimeMillis` (TestClock
  test proves injection + midnight reset), `makeTailorQuotaService(limits)` factory; latency
  timing in cleanup/tailor also moved off `Date.now()`. Model slugs are "TBD/…" placeholders —
  live calls fail until the owner sets OPENROUTER_MODEL / OPENROUTER_CLEANUP_MODEL (README OQ1).
- **T7 done** (`5e45edd1782a`, qwen3.7-plus audit-and-complete): `packages/homelab-services-browser`
  (25 tests), contracts + pure helpers in homelab-services, thin tailor slice + services.ts runtime
  - provider hydration/write-through, usePresets → PresetSnapshotService wrapper. Coordinator fix:
    `save(..., {onCollision})` — default "overwrite" (legacy manual-save behavior), "suffix" opt-in
    for pre-tailor snapshots (the interrupted agent had made suffix unconditional).
- **T8 done** (`1f1b8e76b862`, qwen3.7-plus): Tailoring tab, Job Listings, read-only details modal
  (D7 plain centered Dialog after the settings sheet), auto-apply flow (pre-save suffix snapshot →
  applyTailoredContent), requestTailor (typed client, Bearer id_token), blurb/aboutMe render from
  state + Heading-tab editors, RESUME_TAILOR_ROLE. Full gate green incl. resume vite build.
- **nix hashes refreshed** (`f54fdb6b7aeb`, qwen3.8-flash): fetchYarnBerryDeps sha256 updated in
  homelab-api, homelab-ui, AND resume-site package.nix (lockfile changed in T7);
  `nix build .#homelab-api` + `.#homelab-ui` + `.#resume-site` all green.
- **T10 done / e2e unblocked** (`7900cdab4a17`): first `e2e src/resume` hung forever in the
  health-check loop. Winning diagnosis: kill the tree, boot the bundled server MANUALLY
  (`export HOMELAB_COMMIT_HASH=$(git rev-parse HEAD)` — e2e.sh normally sets it — then
  `dotenvx run -f .env-serve-test -- node dist/bundle/main.js` from packages/homelab-server) →
  instant crash surfaced: `_.Agent is not a constructor`. Root cause: the T4–T6
  `OpenRouterClientServiceLive` piped `NodeHttpClient.layerUndici`; `undici` is NOT installed and
  rolldown evaluates the dispatcher module eagerly → bundled server died at boot. Unit tests
  missed it (they stub the client service). Fix: dropped the provision — `HttpClient.HttpClient`
  bubbles to main.ts's global FetchHttpClient (house pattern, restores filterStatusOk). Also:
  deleted stale `private/api-keys.json` (predated Resume_Tailor; stage script is idempotent —
  ALWAYS regenerate after role-contract changes). Results: `e2e src/resume` 9✓+1 skip (live-AI
  gated); FULL `e2e` suite 15 files, 112✓+1 skip, exit 0.
- **Remaining (owner + polish):** see "Open items" below and `next-agent-prompt.md`.
