# Resume Tailor — Progress & Session Handoffs

Living document. Update after every work session (and before context gets tight) so any agent can
pick up cold. Convention follows `docs/remote-printing-feature/progress.md`.

**Cold-start instructions for the next agent:** read [`README.md`](./README.md) (decisions D1–D9,
wire contract, task graph) → the section doc for your task → the sources it cites. House rules:
`AGENTS.md` + `.opencode/skills/` (`validation`, `adding-endpoints`, `effect-services`, `frontend`
does NOT apply to `packages/resume` — it's React/RTK/Chakra, not the SolidJS homelab-frontend).

## Status

| Task | Doc | Scope one-liner                                                                                                                                   | Status                                                                                                                                     | Commit         |
| ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| T1   | 01  | Extract content schemas+defaults to `shared`; extend `ContentState` (blurb/aboutMe)                                                               | **done** (barrel is `export * as Schema`, so schemas are `ResumeContent.Schema.X`; types flat)                                             | `62d248e97683` |
| T2   | 01  | `ContentPatchBase64` codec (decode-to-state) + wire schemas in homelab-services                                                                   | **done** (JSON-Schema emission snapshot deferred to T5)                                                                                    | `0dab24d048fa` |
| T3   | 03  | `POST /resume/tailor` endpoint + handler + `Resume_Tailor` authz chain + unit tests                                                               | **done** (Live layer is a PLACEHOLDER failing 500 until T4)                                                                                | `afd402ddc11c` |
| T4   | 02  | `TailorService`/`OpenRouterClientService`/`TailorQuotaService` tags + env + layer skeleton                                                        | **done** (quota refactored to layer-owned Ref + Clock per owner directive)                                                                 | `db5134460c1d` |
| T5   | 02  | Cleanup stage + prompts + model-facing wire schemas                                                                                               | **done** (slugs pinned in env.ts `cc692e5ea`: sonnet-5.5 + gpt-6-luna; README OQ1 resolved)                                                | `db5134460c1d` |
| T6   | 02  | Validation pipeline + merge + quota + evals                                                                                                       | **done** (offline evals; live evals gated RUN_TAILOR_LIVE)                                                                                 | `db5134460c1d` |
| T7   | 04  | NEW `homelab-services-browser` pkg + entry-store/preset services + thin tailor slice                                                              | **done** (25 browser tests; usePresets refactored, API unchanged; save onCollision default=overwrite)                                      | `5e45edd1782a` |
| T8   | 04  | Tailoring tab + details modal + auto-apply flow + blurb/aboutMe wiring                                                                            | **done** (manual browser check still pending — no headless UI test in v1)                                                                  | `1f1b8e76b862` |
| T9   | 05  | sops key + env template + kanidm claim + enum drift fix + local dev                                                                               | **done** (owner sops edit `7077d7b2b444`; agent wiring `e30f55bb2` eval-verified; owner split kanidm groups `9727a4ceb1ff`)                | `e30f55bb2`    |
| T10  | 03  | e2e tests (vitest; live-AI gated)                                                                                                                 | **done** (resume 9✓+1 skip; FULL suite 15 files 112✓+1 skip exit 0; required undici-bundle fix)                                            | `7900cdab4a17` |
| T11+ | 06  | Stretch: postgres persistence, category bases, cache decorator (NOT v1, D9)                                                                       | deferred                                                                                                                                   | —              |
| T12  | 07  | v2: errors.ts retirement → raw nested error JSON (logs + 500 `error` field) (M1)                                                                  | **done** (Schema.Defect serializer per owner directive; old-format tests skipped TODO(v2))                                                 | `fc3364dac`    |
| T13  | 07  | v2: 5 service extractions — validation(policy)/listing-extraction/prompt-config(version)/sanitization(arg consts)/merge-delta (E1–E4, M9, M12/C3) | **done** (interrupted-agent recovery + coordinator fixes: extraction env-model bug, test layer-capture pattern, policy/rationale fixtures) | `2714b1a77`    |
| T14  | 07  | v2: `Schemas.Tailoring` move + `Schema.fromJsonString` parsing + `HashingServiceSha256` (M2–M4)                                                   | **done** (native effect/crypto Digest; hash values unchanged — equivalence tests)                                                          | `ebf9b9037`    |
| T15  | 07  | v2: wire — request `policy` + response `changes` (JsonPatch-native) (M7, C2)                                                                      | **done** (policy = `Schema.optionalKey` BOTH sides — typed clients may omit; + shell-leak & self-import-cycle fixes)                       | `6d9def5f1`    |
| T16  | 07  | v2: prompt v2 — rewrite+add bullets, lang/framework/runtime fabrication bound, version bumps (M10)                                                | planned (doc 07 §E)                                                                                                                        | —              |
| T17  | 07  | v2: frontend review-then-apply — Summary\|Changes tabs, confirm modal (Equal.equals), policy UI (M8, M11, C1)                                     | planned (doc 07 §F)                                                                                                                        | —              |
| T18  | 07  | v2: Tempo→logs fix + trace-id in JSON logs + Redacted-at-source (M5, M6)                                                                          | planned (doc 07 §G)                                                                                                                        | —              |
| T19  | 07  | v2: model-facing edits → Effect JsonPatch ops + path-allowlist policy — **GATED** (M12)                                                           | planned (doc 07 §H; gate = evals + owner go)                                                                                               | —              |

Waves (README task graph): **A:** T1→T2→T3. **B (parallel after T2):** T7 and T4→T5→T6.
**C:** T8 (after T3+T7), T9 any time, T10 last. Every task ends with
`yarn lint && yarn typecheck && yarn test` green (+ `nix build .#checks.x86_64-linux.shellcheck`
if shell text changed; `git add` new `.nix` files BEFORE any `nix eval`/`nix build`).

## Human-only / owner decisions (blocking flags)

- **Sops encryption (T9.1):** **DONE (owner, 2026-11-08)** — `homelab_api_openrouter_key` added
  to `nix-config/secrets/augustus.yaml` (`7077d7b2b444`); agent landed the §3 wiring
  (`e30f55bb2`, eval-verified: secret path + env template + praeconinus null).
- **Model slugs (README OQ1):** **RESOLVED (owner, 2026-11-08)** — stage 2
  `anthropic/claude-sonnet-5.5`, stage 1 `openai/gpt-6-luna`, code defaults in
  `packages/homelab-server/src/env.ts` (`cc692e5ea`), env-overridable.
- **Kanidm group (README OQ5):** **RESOLVED (owner, 2026-11-08, `9727a4ceb1ff`)** — dedicated
  groups `homelab.resume.printing` (→ Resume_Print) + `homelab.resume.tailoring` (→ Resume_Tailor);
  old `resume.printing` renamed/retired. NOTE: membership is rae-only now; jacob's group list was
  slimmed (flagged to owner — intentional per "TODO: Remove deadname" context).
- **Degraded semantics (doc 02 / README D5):** **OVERRIDDEN (owner, 2026-11-08)** — pipeline
  failures are 500s with cause chains, never degraded 200s (`cdc7b6db8`). `meta.degraded` stays
  in the wire schema (always false); frontend degraded UI paths are now unreachable-but-harmless.
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
- **`Logger.layer([...])` REPLACES the default logger set** — which includes
  `Logger.tracerLogger`, the bridge turning `Effect.log*` into OTel span events. Omit it and
  Tempo spans show zero logs (this was the "span logs don't show up" bug). Always list
  `Logger.tracerLogger` alongside console loggers (`homelab-server/src/logger.ts`).
- **`HttpClient.filterStatusOk` (global client in main.ts) fails non-2xx AT `execute`** with
  `HttpClientError` (`reason._tag === "StatusCodeError"`, body on `reason.response.text`) —
  in-gen status checks never see non-2xx. Recover the body from the error or lose the upstream
  message (this was the opaque stage-1 failure). Pinned by `test/openrouter-client.test.ts`.
- **vitest runs tests CONCURRENTLY within a file** (`vitest.shared.ts` →
  `sequence.concurrent: true`). No mutable module state shared across tests (fake-server
  "current responder" variables race); dispatch fake responses on request CONTENT.
- **`@effect/vitest` `it.effect` runs under TestClock** — real-IO/clock-dependent tests
  (HTTP timeouts) must use `it.live` (house pattern: the e2e suite).
- **`.env-serve-test` regeneration hazard:** the stage-script template points
  `TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH` at `jwk-secret`, but THIS machine's `jwk.json`
  (Apr 19) pairs with `private-key-secret`; `jwk-secret` (Nov 5) is an orphan → regenerating
  the file breaks boot with `JWKPrivateKeyDecryptionError`. Fixed by pointing the env var back
  at `private-key-secret` + merging the hand-added vars (PORT/LOG_STYLE/CA_URL/ACME_*/
  HOMELAB_ORIGIN_URL) that standalone `serve:test` needs (e2e.sh exports its own PORT/ORIGIN).
- **OTel span naming quirk (empirically verified):** a `SpanNameGenerator` provided inside
  `serve`'s middleware option lands on HttpApi's route-level span (`POST /resume/tailor` +
  `http.route`), NOT the outermost middleware span (method-only `POST` root). Both end properly
  — the "root span never resolves" bug was the ABSENCE of `HttpMiddleware.tracer`, not naming.
- **`new URL("/path", base)` DROPS the base path** (absolute-path resolution against origin):
  `new URL("/chat/completions", "https://openrouter.ai/api/v1")` = `…/chat/completions` → 404.
  This was the production 404 (fixed `e7137e69d` by joining onto `basePath`). Fake-server tests
  must reject unknown paths or they silently pass with URL-join bugs.
- **CI hang class (e2e "started server" then nothing):** tailnet-only hosts
  (idm/jellyfin/ca.plato-splunk.media) are AAAA-only `fd7a:` ULAs — blackholed from GitHub
  runners (dropped SYNs, minutes of kernel retries). ANY unbounded fetch to them (health
  handler, boot OIDC well-known) plus an unbounded probe `curl` (no `--max-time`) stalls the
  health loop past the 20-min job timeout. Fixed `b372d0713`: 5s per-check timeouts
  (TimeoutError → "Unreachable"), 10s boot-fetch timeout, probe `--max-time 10` + progress
  echoes. Rule: outbound calls to tailnet hosts ALWAYS carry `Effect.timeout`
  (precedent: `shared/src/oidc/reachability.ts`).
- **v2 exploration facts (2026-11-09, all verified against source):** `promptVersion` lives in
  `wire-schema.ts` (NOT prompts.ts). `ApiErrors.InternalServerError` already carries
  `error: OptionalUnknown` — raw nested error JSON needs no schema change. `BulletPoint` is an
  object `{id, text, visible}`; v1 "hide" = `visible:false` = a REPLACE op (why the replace-only
  guard passed); added bullets (T16) produce ADD ops → guard must relax (T13). shared's
  `resume-content/patch.ts` already hand-writes `JsonPatchOperationSchema`/`ContentPatchOps`
  (effect's `JsonPatch` = types + get/apply only). `homelab-services-node` index has NO `Schemas`
  namespace yet (Config/Layers/Shell only).
- **Effect 4.1.2 API facts (vendored repos/effect):** `effect/crypto` `Digest.digestHex(Digest.sha256,
  bytes)` + `Digest.layerWebCrypto` (bundle-hazard watch — the undici lesson); `Schema.fromJsonString(
  schema)` is the JSON-string→typed helper (there is NO `Schema.parseJson` in v4); `Equal.equals`
  does DEEP structural equality on plain objects; `Redacted.toString/toJSON` → `<redacted[:label]>`
  (no `Secret` module in this version); `@effect/opentelemetry` spans expose a public `traceId`
  (OtelTracer.ts:417/458) — the hook for trace-id-in-logs (T18).
- **Grafana tracesToLogsV2 (nix-config/modules/features/grafana/service.nix:93–99) has NO `tags`
  mapping** → Grafana derives a `service_name`-style matcher that can never match Alloy's journald
  labels (`unit`, `hostname`, `syslevel`, `container`, `transport` — services/alloy.nix:24–67); the
  homelab-api unit label is `homelab-api.service`. Fix = `customQuery` +
  `{unit="homelab-api.service"} |= "$__traceID"` AND trace_id in the JSON log lines (today's
  jsonConsoleLogger emits no trace context).
- **Fresh worktrees lack the gitignored `packages/*/private/` test fixtures** — `yarn test`
  cascade-fails (627 errors: `private/hmac-secret` ENOENT). Fix: run **`yarn seed:test-secrets`**
  FIRST (root package.json entry consolidating `scripts/stage-test-secrets.mjs` +
  `scripts/stage-e2e-secrets.mjs`; idempotent, never overwrites). CI runs the unit seeder itself
  (ci.yml:58); `e2e.sh` runs the e2e seeder. Owner directive: private test values are ALWAYS
  seeded by reusable scripts, never hand-placed.
- **`Schema.Defect()` (Effect 4.1.2) is the built-in unknown⇄Json codec for failure values**
  (`SchemaTransformation.defectFromJson`): encode = `Error` → recursive `{name, message, cause?}`
  (cycles → `"[Circular]"`; stack only with `{includeStack:true}`; non-Errors via the
  Inspectable-aware JSON formatter); decode = JSON with string `message` rebuilds as `Error`.
  `Data.TaggedError` sets `prototype.name = tag` (internal/core.ts:711) so tags survive encoding,
  but own-fields beyond name/message/cause are DROPPED. Recursive schemas elsewhere:
  `Schema.suspend(() => ...)`. There is NO `Cause.toJSON` in v4.
- **NEVER import the package's own barrel from inside the package** (e.g.
  `import { Schemas } from "homelab-services-node"` inside `homelab-services-node/src/layers/*`):
  runtime TDZ landmine (module-level `.pipe(...)` on a mid-cycle `undefined` Live crashes suites
  at COLLECTION time) + type degradation (it surfaced as a phantom `OpenRouterClientService` leak
  in main.ts). Use relative imports (`../schemas/Tailoring.js`). **`yarn circular` does NOT catch
  package self-imports.**
- **Flat `Layer.provide` chains do NOT satisfy sibling providers' own requirements:**
  `A.pipe(Layer.provide(B), Layer.provide(C))` leaves C's requirements in the aggregate's RIn even
  though B provides them — verified with a type probe (`Layer<TailorService, never, Env |
  OpenRouterClientService | FileSystem | HttpClient>`). Nest instead:
  `Layer.provide(C.pipe(Layer.provide(B)))` (shell/tailor.ts now does this for the extraction
  stage; Effect memoizes the repeated layer identity so it builds once).
- **Subagents must NEVER run `git stash`** (owner caught one attempting it — it can scramble the
  coordinator's uncommitted tree). House rule added to next-agent-prompt: no stash/checkout/
  restore/reset; STOP and report instead. Recovery from a cancelled agent: audit `git status` +
  targeted greps, keep coherent partial work, fix forward (worked twice this session).
- **Schema-validated LLM-output stubs catch stage-dispatch bugs:** the T15 strict-policy stub
  returned stage-2-shaped JSON for ALL calls; `Schema.fromJsonString(CleanupResponse)` (T14)
  rejected it at stage 1 — the cast it replaced would have silently passed garbage.

## Open items (prioritized — the work queue for the next session)

**v1 is SHIPPED and field-verified (owner, 2026-11-08 evening):** live tailoring works
end-to-end on augustus against real OpenRouter; Tempo traces confirmed good (root spans
resolve, log events visible); the degraded→500 cause chain proved itself in production the
same day (it surfaced the URL-join 404 that the old code hid as a degraded 200). Sops secret +
wiring deployed (`7077d7b2b444`, `e30f55bb2`), slugs pinned (`cc692e5ea`), 404 fixed
(`e7137e69d`), CI-hang bounds landed (`b372d0713`), kanidm groups split by owner
(`9727a4ceb1ff`).

1. **v2 work queue = doc 07 (T12–T19):** the owner's tailoring-quality suggestions were ELICITED
   (2026-11-09) and grew into the full v2 directive set (M1–M12 + clarifications C1–C3) — plan of
   record: `docs/resume-tailor-harness/07-v2-plan.md`. Waves: **V2-A** T12→T13→T14 (serial) →
   **V2-B** T15→T16→T19 (T19 GATED: §H evals + owner go) ∥ T18 → **V2-C** T17; **full `e2e` suite
   LAST** (owner directive). Quality levers the owner endorsed: permissive rewrite + added bullets
   with a language/framework/runtime fabrication bound (T16), policy-driven validation defaulting
   OFF (T13/T15), Changes-tab review before apply (T17). Small live spend remains owner-authorized
   (`RUN_TAILOR_LIVE=1 e2e src/resume` + the real key in gitignored
   `packages/homelab-server/private/openrouter-api-key`); bump `promptVersion` on any prompt change
   (v2: it becomes the prompt-config service's `version` property).
2. **Confirm CI green:** `b372d0713` bounded the e2e hang (5s per health check, 10s boot OIDC
   fetch, probe `--max-time 10` + progress echoes). Next push should show the E2E job pass — or
   fail loudly with the log dump instead of stalling silently after "starting bundled server".
3. **Manual browser checklist (partially confirmed by the owner's live run):** still
   unconfirmed — "Pre-tailor: …" preset snapshot toast; details modal
   (verdict/tips/keywords/meta); Apply-from-modal + Delete; blurb/aboutMe editable in Heading
   tab and rendering on the resume; print output contains no tailor data.
4. **Redaction grep unconfirmed** (doc 05 Test Plan): on augustus,
   `journalctl -u homelab-api --since "-1 hour" | grep -c 'sk-or-'` must be 0.
5. **Backlog (unscheduled):** Cypress browser e2e (doc 03 backlog, owner-requested "at some
   point"); doc 06 stretch phase — postgres persistence + category-keyed bases + cache decorator
   (owner wants to do persistence together); "update entry from current content" nicety (README
   OQ4); frozen-base registry mechanics (doc 01 §B — only needed when defaults change);
   PersistedPrintConfig versioning (doc 01 OQ2 — defer until first breaking change). (Kanidm
   dedicated tailor group — DONE by owner `9727a4ceb1ff`: `homelab.resume.printing` +
   `homelab.resume.tailoring`.)

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

### 2026-11-08 — model slugs pinned (Open item 2 resolved)

- Owner present; asked the four blocking questions (sops readiness, slug choice, slug placement,
  live/deploy authorization). Decisions: **slugs = `openai/gpt-6-luna` (stage-1 cleanup) +
  `anthropic/claude-sonnet-5.5` (stage-2 main)**, placed as **real code defaults in env.ts**
  (not nix env-template) — committed `cc692e5ea`, full gate green (typecheck, 851 unit tests,
  lint 0 errors; tests use their own `test-model` defaults so no ripple). Slug research: current
  Nov-2026 OpenRouter market — gpt-6-luna $0.10/$0.50 top JSON-extraction reliability,
  sonnet-5.5 $2/$10 strong rewriting voice; both support strict json_schema +
  `require_parameters:true` routing; version-pinned names, no `:latest`/`~` aliases.
- Owner deferred: sops secret (**not yet** — item 1 still blocks go-live), live smoke + deploy
  (**neither yet** — items 3, 5). Item 4 (manual browser check) remains owner's.
- **Feature still DARK:** slugs are real but no key is provisioned; live calls fail cleanly until
  owner runs `sops edit nix-config/secrets/augustus.yaml` (exact steps: doc 05 §1; then the 2-line
  wiring: doc 05 §3, verified anchor points `_private/augustus/sops.nix` line ~126 +
  `_private/augustus/programs.nix` beside `serialNumbersFile` line ~68).

### 2026-11-08 (afternoon) — owner field-test feedback: 500s, error chains, observability, wiring

- Owner provisioned the OpenRouter key (sops `7077d7b2b444`) + field-tested; hit
  "[tailor] stage 1 failed, returning degraded result" with zero detail. Asks: (1) degraded → 500
  (D5 OVERRIDE — "makes me think something is working, but that's not the case"), (2) useful logs
  - bubble upstream errors into the 500 message, (3) Tempo root span never resolves + span logs
    missing, (4) `yarn circular` regression, (5) — discovered mid-session — owner also split kanidm
    groups (`9727a4ceb1ff`: `homelab.resume.printing` + NEW `homelab.resume.tailoring`; OQ5
    resolved as dedicated groups; rae-only membership — jacob's list slimmed, flagged).
- **Circular fix** (`bea3a79aa`): `schema→constants→types→schema` broken by extracting
  BLURB/ABOUT_ME defaults to leaf `defaults.ts`; constants.ts re-exports (barrel surface
  unchanged). All 7 workspaces green.
- **Degraded→500 + error chains** (`cdc7b6db8`, qwen3.7-plus subagent + coordinator review):
  cleanup.ts stopped swallowing errors (fallbackCleanup deleted); all degrade paths now fail
  TailorError with `describeErrorChain` (new `tailor/errors.ts`, walks `.error`/`.cause`, caps
  500/level, 2000 total); catchDefect wraps unexpected defects; handler mapping unchanged (500 +
  message = the chain). **Coordinator review caught a real bug** in the subagent's client
  hardening: an unscoped `Effect.catch` after the body-read flatMap intercepted the deliberate
  OpenRouterError, so the recovered body was ALWAYS replaced by "(body unreadable)" — rescoped
  the catch to the read only. Client also: no double-wrap, StatusCodeError body recovery
  (filterStatusOk was eating non-2xx bodies at `execute` — the real reason stage-1 failures were
  opaque), dedicated timeout message, request/response logging (never content/headers/key).
  New tests: errors.test.ts (13), openrouter-client.test.ts (6 — REAL local HTTP server through
  production-shaped filterStatusOk client; concurrency-safe via request-body scenario routing
  after the shared-mutable-responder race bit us; timeout test uses it.live for the real clock).
- **Observability** (`c9f54b838`): root cause 1 — no per-request server span existed (no
  `HttpMiddleware.tracer` installed); root cause 2 — `Logger.layer([jsonConsoleLogger])` REPLACED
  the default logger set, dropping `Logger.tracerLogger` (the Effect.log*→span-events bridge;
  only Tempo-visible log channel — stack has no OTLP logs receiver, Loki is journald-only).
  Fixes: tracer middleware in serve options + SpanNameGenerator override (lands on the HttpApi
  route span: `POST /resume/tailor` + http.route; outer root stays method-named — quirk
  documented in main.ts), tracerLogger re-added to both LOG_STYLE branches, RedactingSpanProcessor
  extended to span-EVENT attributes. **Empirically verified** via manual boot + ConsoleSpanExporter:
  root `parentSpanContext: undefined`, finite durations, events with `effect.cause` present.
- **Sops wiring landed** (`e30f55bb2`, unblocked by owner's secret): doc 05 §3 two-liner;
  eval-verified end-to-end (secret path → openRouterApiKeyFile → env template renders
  OPENROUTER_API_KEY_FILE → praeconinus null). Feature no longer dark once deployed.
- **Diagnosis of the owner's degraded result:** with wiring unlanded at test time the server had
  no OPENROUTER_API_KEY_FILE → "OpenRouter not configured on this host" → swallowed by the old
  degrade path. Post-fix this is a 500 naming the cause; post-deploy the key is present.
- Fixture hazards hit + fixed (see Gotchas): `.env-serve-test` regeneration orphaned the
  jwk.json/private-key-secret pair (template points at the orphan `jwk-secret`); vitest
  `sequence.concurrent: true` races mutable test state; `it.effect` = TestClock.
- Gates: typecheck ✓, 871 unit tests ✓ (+20 new), lint 0 errors, FULL e2e 15 files 112✓+1 skip ✓
  (middleware change is global — full suite, not just resume).
- Delegation: explore(flash) for the vendored-effect/OTel research (nailed both root causes with
  file:line refs); qwen3.7-plus for the pipeline rework (one real bug caught in review —
  the review step pays for itself).

### 2026-11-08 (evening) — owner deploy + field test: OpenRouter 404 fix, CI e2e hang fix

- Owner DEPLOYED (wiring + kanidm groups) and field-tested with a real $10 OpenRouter account.
  The new 500-with-cause-chain immediately earned its keep: it surfaced
  "OpenRouter API returned status 404" — the old code would have hidden this as a degraded 200.
- **Root cause of the 404** (`e7137e69d`): `new URL("/chat/completions", "https://openrouter.ai/api/v1")`
  resolves the absolute path against the ORIGIN, silently dropping `/api/v1` → every call hit
  `https://openrouter.ai/chat/completions`. Fixed by joining onto the base pathname
  (trailing-slash safe). Verified against the real API with a dummy key: old path → 404, new
  path → 401 "User not found" (endpoint reached, ZERO spend). Regression test hardened: the
  fake server now 404s anything but `/api/v1/chat/completions` (every scenario doubles as a
  URL-join test) + explicit path assertion (7 tests).
- **CI e2e hang** (`b372d0713`): owner reported CI stuck after "starting bundled server".
  Diagnosis (no `gh` available — reasoned from source + DNS): idm/jellyfin/ca.plato-splunk.media
  are AAAA-only tailnet ULA (`fd7a:`) hosts, blackholed from GitHub runners (dropped SYNs →
  kernel TCP retries for minutes). `/status/health` awaited all three with NO timeout; e2e.sh's
  probe `curl` had no `--max-time`; boot-time OIDC well-known fetch likewise unbounded. 60 probes
  × minutes ≫ the 20-min job timeout = silent stall. Fix: 5s `Effect.timeout` per health check
  (TimeoutError → "Unreachable" match arm), 10s timeout on the boot fetch before its
  option-degrade, probe `--max-time 10` + progress echo every 10 attempts (worst case ~10.5 min,
  ends LOUDLY with the log dump). House precedent: `shared/src/oidc/reachability.ts`.
- Gates: typecheck ✓, 872 unit tests ✓ (+1), lint 0 errors ✓, shellcheck ✓ (e2e.sh touched),
  CI-mode e2e (`DISABLE_NETWORK_TESTS=true`) 15 files 111✓+2 skip ✓.
- **Pending:** owner redeploys augustus (`e7137e69d` + `b372d0713`), re-runs CI (should pass or
  fail loudly now), then live smoke (item 3) + redaction grep + Tempo check (root spans resolve,
  span events visible). Local live-run option: owner drops the real key into gitignored
  `packages/homelab-server/private/openrouter-api-key` → `RUN_TAILOR_LIVE=1 e2e src/resume`.

### 2026-11-08 (evening, second) — OWNER FIELD VERIFICATION: v1 works live 🎉

- Owner redeployed with the URL fix and confirmed: **tailoring succeeded end-to-end against
  real OpenRouter**, and **Tempo traces are working great** (root spans resolve; span-event logs
  visible) — the observability fix is field-confirmed, not just ConsoleSpanExporter-verified.
- Feedback: the first live result was SPARSE ("it didn't have much"); the owner has concrete
  improvement suggestions to hand off — they are NOT written down anywhere yet. **Open item 1
  for the next session: elicit them first**, then tune prompts/models against doc 02 §I evals
  (bump `promptVersion` on any prompt change).
- Handoff docs swept for staleness: override banners added to docs 03 + 04 (degraded-flow text
  is historical; frontend degraded paths unreachable-but-kept), doc 02 merge-delta guard text
  corrected to failure semantics, README + next-agent-prompt state brought current, backlog
  trimmed (kanidm dedicated groups were done by the owner in `9727a4ceb1ff`).

### 2026-11-09 — v2 planning session (owner directives → doc 07)

- Owner handed off the v2 work order (15 items: 4 service extractions E1–E4, misc M1–M11) in a
  PARALLEL WORKTREE (`nimble-otter` — the owner now runs multiple agents in separate worktrees;
  next-agent-prompt's "work in the primary worktree" line updated accordingly). This resolves the
  old open item 1: the quality suggestions ARE the v2 directives (permissive validation + prompt
  liberty + visible-changes review flow).
- Clarifications captured: **C1** confirm-modal ONLY on "Apply changes to resume" in the new
  Changes tab ⇒ submit stops auto-applying/snapshotting (D1/D4 overridden → D13). **C2** the
  change list is SERVER-provided (`response.changes`). Follow-up owner message delegated the
  merge-delta design (**M12**) ⇒ **C3**: dedicated `ResumeContentMergeService` (validation =
  SEMANTIC policy; merge = MECHANICAL + STRUCTURAL policy over the Effect JsonPatch delta);
  `changes` are JsonPatch-native (reuse shared's `JsonPatchOperationSchema` + `previous`
  enrichment); the owner's "Effect JsonPatches for everything" is planned as GATED **T19**
  (feasibility verified: flattened strict-mode op schema — no unions; path-annotated prompt v3;
  path-allowlist policy `allowedEditPaths`; gate = offline evals + injection pass + owner review).
- Four explore subagents (qwen3.8-flash) mapped: tailor backend surface (all 6 modules + pipeline
  internals + test inventory), observability (logger/otel redaction, Grafana/Alloy/Loki chain,
  no trace-id in log lines), frontend (hooks snapshot sites L130–142/L202–214, entry shape, modal
  structure), Effect 4.1.2 APIs (Redacted/Digest/fromJsonString/Equal — see Gotchas). Findings
  written into doc 07 §Verified current state.
- Docs updated: **07-v2-plan.md NEW (authoritative for T12–T19)**; override banners on docs
  01–05; README (status, vision note, D1/D4 overrides, new D10–D15, wire-v2 note, doc map, v2
  task graph, OQ6–10); next-agent-prompt.md re-pointed at doc 07.
- **Next:** execute doc 07 waves — V2-A (T12→T13→T14), V2-B (T15→T16→T19-gated) ∥ T18, V2-C
  (T17); per-task gate + commit `--no-verify`; FULL e2e last; keep this file current.

### 2026-11-09 (second) — v2 implementation begins: T12 landed + worktree-seeding gotcha

- **T12 done** (`fc3364dac`, cancelled-agent recovery + coordinator rework): the owner cancelled
  the first subagent mid-run with a design directive — error serialization must go through Effect
  Schema decode/encode ("validating the object… serialization that's built into effect"), not a
  hand-rolled mapper. Audit of the partial tree showed the agent's call-site work was complete and
  coherent (all 12 `describeErrorChain` sites converted to short-context `message` +
  `error: Utils.errorToJson(raw)`; errors.test.ts skipped; handler passing `error: err.error`), so
  it was KEPT; only the serializer internals were replaced with the native **`Schema.Defect()`**
  codec (`Utils.errorToJson` = `Schema.encodeSync`, `parseErrorJson` = `Schema.decodeUnknownSync` —
  behavior + trade-offs in Gotchas). 6 co-located tests added
  (`homelab-services/src/utils/error-json.test.ts`); handler test upgraded from TODO to a real
  structured-passthrough assertion; `errors.ts` deleted. Gate green: typecheck ✓, tests ✓
  (services-node 720+1todo, homelab-server 64, homelab-services 15), lint 0 errors.
- **Seeding discovery (owner directive "re-usable scripts to seed the private testing values"):**
  the first gate run failed with 627 cascading errors — fresh worktrees lack the gitignored
  `packages/*/private/` fixtures. The reusable seeders ALREADY existed
  (`scripts/stage-test-secrets.mjs` — unit tests, used by CI; `scripts/stage-e2e-secrets.mjs` —
  e2e, used by e2e.sh); what was missing is a discoverable entry point + workflow wiring. Added
  root **`yarn seed:test-secrets`** (runs both, idempotent) and documented it in doc 07 §Execution
  protocol + next-agent-prompt house rules. Ran it: both packages seeded, gate green.
- **Next:** T13 (five service extractions — the big one) via subagent dispatch.

### 2026-11-09 (third) — V2-A complete + T15: service extractions, schemas/hashing, wire v2

- **T13 done** (`2714b1a77`, qwen3.7-plus subagent — CANCELLED near the end but left coherent
  work; coordinator audit-and-completed): five services extracted per doc 07 §B — validation
  (semantic policy: fabrication/evidence/tag-vocabulary checks gated by `TailorValidationPolicy`,
  default enabled=false), merge (mechanical + structural JsonPatch-delta guard: default allows
  replace+add, rejects remove; enabled=true → v1 replace-only; returns {merged, delta, changes}
  with previous-value enrichment), listing-extraction, prompt-config (public `version`/
  `schemaVersion` properties — constants moved out of wire-schema; factory = version-keyed impls),
  sanitization (truncation constants as method args). `TailorEdits` structural interface lives in
  the homelab-services def (dependency direction); impl assignment is the conformance gate. Old
  tailor/{validation,cleanup,prompts,hygiene}.ts deleted. Coordinator fixes: extraction impl had
  hardcoded model slug (→ Config.Env), test layer-capture pattern (service closures capture their
  client at LAYER BUILD — providing a different layer to a METHOD call is a no-op), policy
  fixtures needed full Type-side values, tag-vocabulary fixture used a tag that WAS in the
  vocabulary. Gate green (729 tests).
- **T14 done** (`ebf9b9037`, qwen3.7-plus subagent, clean completion): wire-schema →
  `src/schemas/Tailoring.ts` + `Schemas` namespace on the node package index; stage-1/stage-2
  parsing via `Schema.fromJsonString` + `decodeUnknownEffect` (messages unchanged);
  `HashingServiceSha256` (def + node impl on native `effect/crypto` `Digest.digestHex(Digest.
  sha256, …)` + `layerWebCrypto`, self-contained Live; own TaggedError) replaces createHash —
  hash VALUES unchanged (known-vector + createHash-reference equivalence tests). NOTE: this agent
  introduced the package self-import cycle (see Gotchas) — surfaced in T15.
- **T15 done** (`6d9def5f1`, subagent CANCELLED by owner mid-run — it attempted `git stash`, now
  a hard house rule; coordinator completed): request `policy` — coordinator switched
  OptionalWithDefault → **`Schema.optionalKey`** after the agent's version forced every typed
  client to pass a policy (it had hardcoded one into packages/resume — reverted; T17 owns the
  frontend). Response `changes` (required, JsonPatch-native). Handler forwards `payload.policy`;
  orchestrator threads it to validation+merge and returns `mergeResult.changes`. TWO structural
  fixes en route (both now Gotchas): the self-import cycle (runtime suite-collection crash +
  phantom type leak) → relative imports; and the flat `Layer.provide` chain leaking
  `OpenRouterClientService` into the Shell.Tailor Aggregate RIn (main.ts `Layer.launch` red) →
  nested extraction deps, verified with a temporary type probe. Debug path worth repeating:
  bisect by restoring `git show <commit>:<path>` over single files (copies in /tmp first), probe
  layer RIn via `const p: Layer.Layer<unknown, never, never> = Aggregate`. Schema tests now cover
  wire-side policy defaulting (decodeUnknown from raw JSON — the server edge) + roundtrips;
  strict-policy pipeline eval proves fabrication-drop end-to-end (real INITIAL_CONTENT_STATE ids
  `nutrien`/`nutrien__b0` — bullet ids are `${entryId}__b${i}`).
- Gates after each task: typecheck ✓ / tests ✓ (730 + 1 todo) / lint 0 errors / circular ✓.
- **Next:** T16 (prompt v2 permissiveness + addedBullets + version bumps + evals), then T17
  (frontend), T18 (observability), T19 gated (owner go needed), FULL e2e last.
