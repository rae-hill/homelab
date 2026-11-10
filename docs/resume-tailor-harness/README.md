# Resume Tailor Harness — Planning Hub

Status: **v1 shipped & field-verified (2026-11-08)** · **v2 planned (2026-11-09)** —
[`07-v2-plan.md`](./07-v2-plan.md) is the plan of record for tasks **T12–T19** (service extraction,
validation policy, review flow, observability). This directory holds the corrected, section-split
plan for the AI resume-tailoring feature. It supersedes [`resume-tailor-harness-initial-plan.md`](./resume-tailor-harness-initial-plan.md)
on all **repo-factual** matters; the initial plan is kept because its **AI-craft guidance**
(prompt design, validation guards, injection threat model, ops hygiene) remains the reference —
each section doc below says which parts to carry over.

## Vision

> **v2 note (2026-11-09, D13):** steps 3–4's auto-apply + "Pre-tailor:" preset-snapshot behavior is
> RETIRED — submit stores the entry (now including a server-computed `changes` list) and opens the
> details modal for review (**Summary | Changes** tabs); applying is an explicit action in the
> Changes tab, with an overwrite confirmation only when current content differs from the defaults.
> See doc 07 §F.

A **Tailoring** tab in the resume app's existing print-config modal (`packages/resume`). The user
pastes a job listing and submits:

1. `POST /resume/tailor` (homelab-server) runs a two-stage OpenRouter pipeline:
   - **Stage 1 (cheap model):** extractive cleanup of the listing (strip EEO/benefits/boilerplate —
     deletion only, verbatim spans preserved) and extraction of `jobTitle` + `company`.
   - **Stage 2 (main model):** constrained, ID-addressed content edits + a fit report against the
     cleaned listing.
2. The server validates and merges the edits, then returns the tailored content as a
   **base64-encoded JSON Patch against the shared default content state**, plus the fit report,
   job title, and meta.
3. The client **auto-saves the current config as a preset snapshot** ("Pre-tailor: \<jobTitle\> —
   \<date\>") via the existing preset mechanism, then **auto-applies** the tailored content.
   No per-edit review step.
4. Every request creates an entry in the **Job Listings** list (redux + localStorage). Clicking an
   entry opens a **read-only details modal layered over the settings modal** (a regular
   over-screen dialog — no right-drawer positioning for now, per D7), titled with the AI-extracted
   job title, showing the analysis (verdict, summary, tips, keyword coverage, meta) and an
   **Apply to resume** action that re-applies that entry's content (again pre-saving the current
   config first).
5. The user reviews the result **on the rendered resume itself**, adjusts layout/formatting with
   the existing tools, and prints via the existing flows. The tailor slice never touches print
   output.

## Confirmed decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Auto-apply + preset snapshot.** On a successful response: save current config through the existing preset mechanism, then replace content immediately. Restore = recall the preset. **OVERRIDDEN (owner, 2026-11-09 → D13/doc 07):** no auto-apply, no snapshot — review-then-apply from the Changes tab.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2  | **Extend `ContentState` now.** The heading blurb and AboutMe paragraph (currently hard-coded component constants) move into `ContentState` with today's strings as defaults, so the AI can tailor a real "summary". Old persisted blobs must keep decoding (new fields materialize with defaults).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | **Base64 JSON Patch is the only content representation on the wire** — in both directions. Default content state + schemas are extracted to `packages/shared` so both sides derive state from patches. A shared Effect Schema decodes `base64 → patch ops → ContentState` (apply-to-base baked into the decode) and is used **directly in the API definitions**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D4  | **No review step.** Server-side merge + validation is authoritative; the rendered resume is the review surface. (Supersedes initial-plan §9's per-edit accept/reject UI and client-side patch filtering.) **OVERRIDDEN in part (owner, 2026-11-09 → D13):** server merge stays authoritative, but the modal's Changes tab is now the pre-apply review surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D5  | **Two-model pipeline.** Cheap model for cleanup + title extraction; main model for tailoring + fit report. Both slugs pinned and configurable. Cleanup is **extractive-only** so fit-report evidence remains substring-verifiable against the cleaned listing. **Failure semantics OVERRIDDEN (owner, 2026-11-08):** pipeline failures are 500s with the nested cause chain rendered into the error message — NOT degraded 200s (`meta.degraded` remains in the wire schema, always false).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D6  | **State is local for now**: redux slice synced to its own versioned localStorage key. Postgres persistence (keyed by job category) and redis response caching are stretch goals (doc 06) — v1 must preserve the seams (stable entry ids, `listingHash`, `baseVersion`, meta) so the stretch needs no rework.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D7  | **Details view is a plain over-screen modal** (regular Chakra Dialog layered over the settings modal) — no right-side drawer positioning work for now. Owner-confirmed 2026-11-07.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D8  | **Small, single-responsibility services composed in layers (SOLID).** Runtime-agnostic contracts live in `homelab-services`; browser implementations + their tests live in a NEW `packages/homelab-services-browser` workspace (frontend logic gets tested outside the resume app, which has no test infra). Cypress-based UI e2e is a later addition (doc 03 backlog).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D9  | **No cache in v1** — not even in-process. `cacheHit` stays in `TailorMeta` as a reserved seam (always `false`). Caching arrives with the data-persistence work (doc 06), inserted as a decorator layer over doc 02's service composition — zero pipeline rework. Owner-confirmed 2026-11-07.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D10 | **v2: pipeline logic behind opaque services (owner, 2026-11-09, doc 07).** `validation.ts`/`cleanup.ts`/`prompts.ts`/`hygiene.ts` become four Effect services (defs in `homelab-services`, impls in `homelab-services-node`): `ResumeTailorValidationService`, `ResumeListingExtractionService`, `ResumePromptConfigService` (public `version` property — version-keyed impls, selection later), `PromptSanitizationService` (truncation constants = method args) — plus a fifth, agent-named under the owner's M12 delegation: **`ResumeContentMergeService`**, owning merge + the Effect-JsonPatch delta + the structural guard (relationship: validation = semantic policy, merge = mechanical + structural; composed sequentially by the orchestrator). Consumers depend on tags/effects only. Plus `HashingServiceSha256` (native Effect `Digest` preferred) replacing manual `createHash`; model-facing wire schemas move to `homelab-services-node/src/schemas/Tailoring.ts` (`Schemas.Tailoring.*`); manual `JSON.parse … as X` casts → `Schema.fromJsonString` decoding. |
| D11 | **v2: validation is policy-driven and permissive by default (owner, 2026-11-09, doc 07).** New `TailorValidationPolicy` schema (in `Schemas.ResumeTailor`) rides on the wire (`request.policy`, optional; absent = default policy = validation DISABLED). The tag rule becomes the policy item `requireTagsGloballyAvailable` (vocabulary = base content's tag union; OQ6). The replace-only merge-delta guard relaxes to allow `add` ops (needed for added bullets) — `remove` stays rejected. Policy is extensible: new rules = new defaulted fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D12 | **v2: raw nested error JSON (owner, 2026-11-09, doc 07).** `errors.ts`/`describeErrorChain` retired; `TailorError{message: <short stage context>, error: <raw nested cause>}` → handler maps to `InternalServerError({message, error})` via the pre-existing `error: OptionalUnknown` field. Tests asserting the old string format are skipped with `TODO(v2)` for now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D13 | **v2: review-then-apply (owner, 2026-11-09, doc 07 — overrides D1, part of D4).** No auto-apply, no "Pre-tailor:" snapshots. Submit → entry (now storing server-provided `changes`) → details modal opens with tabs **Summary \| Changes**; "Apply changes to resume" lives in the Changes tab and is the ONLY place the overwrite-confirmation modal pops — and only when current content differs from `INITIAL_CONTENT_STATE` (Effect `Equal.equals` deep structural comparison). Response gains `changes: Array(TailorChange)` from the server's merge delta (single source of truth; seam for a future refinement round — NOT planned yet). `changes` entries are Effect JsonPatch ops (reusing shared's existing `JsonPatchOperationSchema`) wrapped with `previous` values — JsonPatch-native vocabulary end-to-end; doc 07 §H plans the GATED switch of model-facing edits to JsonPatch ops too (T19).                                                                                                                                                                     |
| D14 | **v2: permissive prompts with a fabrication bound (owner, 2026-11-09, doc 07).** Stage-2 prompt v2 rewrites bullets/descriptions toward the listing's language and MAY add bullets (`addedBullets` in the model-facing schema) matching listing requirements — hard bound: never fabricate experience claiming a specific language/framework/runtime absent from the content, no invented metrics. `promptVersion` → `v2-2026-11`, `schemaVersion` → `v2`. Owner reviews every result in the Changes tab before submitting applications.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D15 | **v2: observability hygiene (owner, 2026-11-09, doc 07).** Tempo "View logs for this span" fixed via a Grafana `tracesToLogsV2` custom query on `{unit="homelab-api.service"} \|= "$__traceID"` + trace_id/span_id added to the JSON console log lines. Manual key-pattern redaction (logger.ts + RedactingSpanProcessor) removed in favor of `Redacted` at every sensitive-value source (`toString/toJSON` auto-redact); doc 05 §9's acceptance grep stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Wire contract (sketch — normative shapes live in docs 01/03)

```
POST /resume/tailor            (Bearer auth; resource URI Resume_Tailor)
request:  { listing: string,                    // raw pasted text; server does hygiene + cleanup
            content: ContentPatchBase64,        // user's current content = patch vs shared defaults
            baseVersion: string }               // CONTENT_DEFAULTS_VERSION; mismatch => 4xx
response: { jobTitle: string, company: string | null,
            content: ContentPatchBase64,        // tailored content = patch vs the SAME shared defaults
            baseVersion: string,
            fit: FitReport,                     // verdict / summary / tips[] / keywordCoverage
            meta: TailorMeta }                  // per-stage tokens/latency/models (nullable), degraded,
                                                // cacheHit (always false in v1, D9), contentHash,
                                                // listingHash, promptVersion, schemaVersion
```

Patches are always relative to the **versioned, frozen** `INITIAL_CONTENT_STATE` in `shared`
(neither relative to the request content nor to a mutable "latest"). This is what makes the
decode-to-`ContentState` schema static enough to drop into `HttpApiEndpoint` definitions, per D3.
Consequence: **changing the default content is a versioned contract change** (see doc 01 §
versioning), because persisted patches in localStorage/presets/entries decode against it.

**v2 additions (2026-11-09, doc 07 §D/T15):** `request.policy?: TailorValidationPolicy` (omitted =
permissive default, validation disabled) and `response.changes: Array(TailorChange)` (the
server-computed merge delta — `{op, path, value, previous}` — rendered in the Changes tab).

Verified against `repos/effect` @ 4.1.2 (source, not docs):

- `JsonPatch` exports **types + `get(old, new)` + `apply(patch, doc)` only — no Schema**; ops are
  `add`/`remove`/`replace` (no move/copy/test); `apply` **throws** plain `Error`s and does not
  mutate; `get` is deterministic (sorted keys), index-based on arrays, removals high→low.
- `Schema.toDifferJsonPatch(codec)` is public and yields `Differ<T, JsonPatch>` — the server builds
  response patches with it (diff runs over the codec's **encoded** JSON form).
- `Schema.StringFromBase64` + `Schema.decodeTo(to, { decode, encode })` compose the
  `base64 → ops → apply(defaults) → ContentState` chain; the apply step must catch throws.

## Corrected repo facts (initial plan / AGENTS.md drift)

| Claim                                                                 | Reality (verified 2026-11)                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resume app stack unstated                                             | **React 18 + Redux Toolkit + Chakra UI v3 + TanStack Router + Vite 8** (`packages/resume`) — not the SolidJS/nanostores stack of `homelab-frontend`                                                         |
| shared has `resume-content/`                                          | No — content schemas live **inside** `packages/shared/src/print-config/schema.ts`; defaults live in `packages/resume/src/state/print-config/content-defaults.ts` (both move, doc 01)                        |
| `PersistedConfig` composes printConfig + content                      | One **flat** struct `{ toggles, featuredMode, sections, heading, content }`; codec is base64↔JSON↔schema with **no version field** (decode failure silently resets to defaults)                             |
| AI can rewrite `summary`                                              | Blurb + AboutMe are **hard-coded** in `components/resume/sections/{heading,about-me}.tsx`; `content.skills` is a placeholder; tag cloud reads static `resume-data.ts` (D2 fixes the first two)              |
| `homelab-services/src/config/api-key-config.ts` is the secret pattern | That's **inbound** API-key auth. Outbound-secret pattern: sops → `homelab-api-env` EnvironmentFile template → `Config.String(...)` in `packages/homelab-server/src/env.ts` → node-side read with `Redacted` |
| `features/homelab-api/{caddy,kanidm}.nix` (AGENTS.md table)           | Stale — it's `catalog.nix` (caddy vhost via `features/homelab-service`) + `oidc.nix` (kanidm claims)                                                                                                        |
| worry about 60s reverse-proxy timeout                                 | Moot — the vhost is a plain `reverse_proxy 127.0.0.1:35427`, no in-flight timeout configured                                                                                                                |
| some AI integration exists                                            | **Greenfield** — zero provider code anywhere; only a deferred "AI Tailor tab" note in `packages/resume/docs/effect-and-presets-plan.md`                                                                     |
| redis available                                                       | `redis` npm dep declared (homelab-server/services-node/e2e) but **unused, no server deployed**; postgres 17 IS live on augustus (tailscale-only, mTLS)                                                      |

Backend chain facts the section docs rely on (all verified): endpoint defs in
`packages/homelab-api/src/homelab/resume/` (Effect v4 `HttpApiEndpoint`, options-object style);
handlers in `packages/homelab-server/src/handlers/resume/`; request/response schemas in
`packages/homelab-services/src/schemas/resume.ts`; service **tag+def** in `homelab-services`,
**Live layer** in `homelab-services-node/src/layers/` + `shell/` aggregate + `main.ts`;
authn = `Middleware.AuthMiddleware`, authz = explicit `AuthorizationService.canCreate(identity,
"Resume_Tailor", args)` in the handler + resource-URI literal + FGA matcher arm + kanidm claim map;
outbound HTTP = `effect/http` `HttpClient` (FetchHttpClient provided globally in `main.ts`).
Canonical checklist: `.opencode/skills/adding-endpoints/SKILL.md`.

## Architecture

```
 packages/resume (React+RTK)                homelab-server                     homelab-services-node
┌────────────────────────────┐   POST    ┌──────────────────────┐  TailorSvc ┌───────────────────────────────┐
│ Tailoring tab              │ /resume/  │ handlers/resume/     │───────────▶│ layers/tailor-service.ts      │
│  ├ paste listing → submit  │ tailor    │   tailor.ts          │            │  1. input hygiene/truncate    │
│  ├ Job Listings (entries)  │◀──────────│  auth: AuthMiddleware│            │  2. cleanup+title (cheap LLM) │
│  ├ details modal (layered  │  patch+   │  + canCreate(        │            │  3. quota check (per-subject) │
│  │   over settings)        │  fit+meta │    "Resume_Tailor")  │            │  4. tailor+fit  (main LLM)    │
│  └ auto: preset snapshot   │           └──────────────────────┘            │  5. validation pipeline       │
│      + apply content patch │                                               │  6. merge → ContentState      │
└────────────┬───────────────┘                                               │     (edge codec → b64 patch)  │
             │ redux: printConfig | homelab | tailor(new)                    └──────────────┬────────────────┘
             │ localStorage: print-config | presets | tailor-listings(new)                  │ HttpClient (effect/http)
             ▼                                                                              ▼
        shared: resume-content schemas + INITIAL_CONTENT_STATE(v1) + ContentPatchBase64   OpenRouter
        (decode-to-ContentState schema used by BOTH the API defs and the client)         (strict json_schema,
                                                                                          require_parameters,
                                                                                          data_collection:deny)
```

## Document map

| Doc                                                                    | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Primary packages                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [01-shared-state-and-contracts.md](./01-shared-state-and-contracts.md) | Extract content schemas + defaults to `shared`; extend `ContentState` (D2); patch codec & decode-to-state schema (D3); wire contract shapes; versioning policy                                                                                                                                                                                                                                                                                                        | `shared`, `resume` (imports)                                                                                              |
| [02-ai-pipeline.md](./02-ai-pipeline.md)                               | `TailorService` tag + node layer; OpenRouter client; cleanup & tailor prompts; model-facing wire schema; validation pipeline; degraded fallback; quota; evals (cache deferred per D9)                                                                                                                                                                                                                                                                                 | `homelab-services`, `homelab-services-node`                                                                               |
| [03-api-endpoint.md](./03-api-endpoint.md)                             | `POST /resume/tailor` endpoint def, handler, `Resume_Tailor` authz chain, feature flag, handler + e2e tests                                                                                                                                                                                                                                                                                                                                                           | `homelab-api`, `homelab-server`                                                                                           |
| [04-frontend-ui.md](./04-frontend-ui.md)                               | Tailoring tab, Job Listings, details modal (D7), `tailor` redux slice, NEW `homelab-services-browser` package (entry-store + preset services & tests, D8), auto-apply/preset-snapshot flow                                                                                                                                                                                                                                                                            | `resume`, `homelab-services`, `homelab-services-browser`                                                                  |
| [05-nix-and-secrets.md](./05-nix-and-secrets.md)                       | sops key, env template wiring, kanidm role claim, permissions-enum drift fix, local dev env, redaction, praeconinus-dark                                                                                                                                                                                                                                                                                                                                              | `nix-config`, `homelab-server` env                                                                                        |
| [06-stretch-db-and-cache.md](./06-stretch-db-and-cache.md)             | Postgres persistence keyed by job category; redis response cache; migration path off localStorage; seams v1 must preserve                                                                                                                                                                                                                                                                                                                                             | future                                                                                                                    |
| [07-v2-plan.md](./07-v2-plan.md)                                       | **v2 (T12–T19), plan of record 2026-11-09:** service extractions (validation-policy / listing-extraction / prompt-config / sanitization / merge-delta + hashing), errors.ts retirement, `Schemas.Tailoring`, schema-based parsing, wire v2 (`policy`/`changes`), permissive prompts, frontend review flow (Summary\|Changes tabs + confirm modal), Tempo→logs + trace-id logging + `Redacted` at source; T19 = gated switch of model-facing edits to Effect JsonPatch | all backend/frontend packages + `nix-config`                                                                              |
| [08-docx-output-plan.md](./08-docx-output-plan.md)                     | **v3 (T20–T24), plan of record 2026-11-10:** DOCX output for `POST /resume/print` (`outputFormat=pdf\|docx`) — `ResumePrintingService` rename + format param, `DocumentRenderingServiceDocx` wrapping `@turbodocx/html-to-docx`, puppeteer computed-style HTML capture, dual content-type success schemas, Chakra split menus (FAB + settings Print button); T19 JsonPatch backburnered                                                                               | `homelab-services`, `homelab-services-node`, `homelab-api`, `homelab-server`, `resume`, `homelab-e2e-tests`, `nix-config` |

## Task graph

```
T1 extract+extend content in shared ──▶ T2 patch codec/differ ──▶ T3 endpoint+schemas+skeleton handler
                                                                      │
T7 services-browser pkg + tailor slice + stores ◀─(needs T2)            ▼
        │                                              T4 TailorService tag + OpenRouter client
        ▼                                                             ▼
T8 Tailoring tab + details modal + auto-apply ◀──(needs T3 client)  T5 cleanup stage + prompts
                                                                      ▼
                                                          T6 validation + merge + evals
T9 nix/sops/kanidm (any time; before deploy) ────────────▶ T10 e2e tests (needs T3+T6+T9)
T11+ stretch: postgres persistence, redis cache (doc 06)
```

Suggested waves: **A:** T1→T2→T3. **B (parallel once T2 lands):** T7, and T4→T5→T6.
**C:** T8 (after T3+T7), T9 any time, T10 last. Each task must leave the tree green
(`yarn lint && yarn typecheck && yarn test`; see the `validation` skill).

```
v2 (doc 07, 2026-11-09):
V2-A (serial, shared files):  T12 errors retirement → T13 service extractions (incl. merge service) → T14 schemas/hashing
V2-B:                         T15 wire v2 (policy/changes) → T16 prompts v2 → T19 JsonPatch-everywhere (GATED: evals + owner go)
                              ∥ T18 observability (after T12)
V2-C:                         T17 frontend review flow (after T15, ∥ T16/T19)
Full `e2e` suite runs LAST, after every task lands (owner directive).
```

## Open questions

1. **Model slugs** — **RESOLVED (owner, 2026-11-08):** stage 2 = `anthropic/claude-sonnet-5.5`,
   stage 1 (cleanup) = `openai/gpt-6-luna`. Pinned as code defaults in
   `packages/homelab-server/src/env.ts`, env-overridable via `OPENROUTER_MODEL` /
   `OPENROUTER_CLEANUP_MODEL`. Version-pinned names, never mutable aliases.
2. **Defaults versioning cadence** — how often will the real resume content drift from
   `INITIAL_CONTENT_STATE` v1? Doc 01 proposes a frozen-base registry; confirm appetite vs.
   simply re-tailoring after content edits.
3. **Praeconinus** — **RESOLVED (owner, 2026-11-07):** praeconinus stays locked down (public
   server; explicit flag list omits `Resume_*`, secret null). Augustus keeps `FEATURE_FLAGS=*` —
   it's on the tailnet and may run everything.
4. **Entry vs. post-review tweaks** — entries store the AI output as returned. Optional nicety:
   "update entry from current content" after the user polishes layout/wording (doc 04 § stretch).
5. **`Resume_Tailor` kanidm group** — **RESOLVED (owner, 2026-11-08, `9727a4ceb1ff`):** dedicated
   groups — `homelab.resume.printing` (→ Resume_Print) and `homelab.resume.tailoring`
   (→ Resume_Tailor); the old `resume.printing` group was renamed/retired. Docs referencing
   `resume.printing` (doc 05 §5, remote-printing docs) are historical.
6. **v2 — global tag vocabulary source** (doc 07 OQ6): "globally available" = base content's tag
   union for now; promote the static resume tag cloud to `shared` for a true global list?
7. **v2 — prompt version selection** (doc 07 OQ7): the prompt-config factory enables version-keyed
   impls; the selection mechanism (env/request/policy) is deferred until two versions must coexist.
8. **v2 — policy UI persistence** (doc 07 OQ8): component state for v2; persist per-user only if
   the owner keeps re-toggling.
9. **v2 — Changes rendering polish** (doc 07 OQ9): raw JSON-pointer paths in v2; humanized labels
   land with the future refinement-round work.
