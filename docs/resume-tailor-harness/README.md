# Resume Tailor Harness — Planning Hub

Status: **planning** (2026-11). This directory holds the corrected, section-split plan for the
AI resume-tailoring feature. It supersedes [`resume-tailor-harness-initial-plan.md`](./resume-tailor-harness-initial-plan.md)
on all **repo-factual** matters; the initial plan is kept because its **AI-craft guidance**
(prompt design, validation guards, injection threat model, ops hygiene) remains the reference —
each section doc below says which parts to carry over.

## Vision

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

| #  | Decision                                                                                                                                                                                                                                                                                                                                                                |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | **Auto-apply + preset snapshot.** On a successful response: save current config through the existing preset mechanism, then replace content immediately. Restore = recall the preset.                                                                                                                                                                                   |
| D2 | **Extend `ContentState` now.** The heading blurb and AboutMe paragraph (currently hard-coded component constants) move into `ContentState` with today's strings as defaults, so the AI can tailor a real "summary". Old persisted blobs must keep decoding (new fields materialize with defaults).                                                                      |
| D3 | **Base64 JSON Patch is the only content representation on the wire** — in both directions. Default content state + schemas are extracted to `packages/shared` so both sides derive state from patches. A shared Effect Schema decodes `base64 → patch ops → ContentState` (apply-to-base baked into the decode) and is used **directly in the API definitions**.        |
| D4 | **No review step.** Server-side merge + validation is authoritative; the rendered resume is the review surface. (Supersedes initial-plan §9's per-edit accept/reject UI and client-side patch filtering.)                                                                                                                                                               |
| D5 | **Two-model pipeline.** Cheap model for cleanup + title extraction; main model for tailoring + fit report. Both slugs pinned and configurable. Cleanup is **extractive-only** so fit-report evidence remains substring-verifiable against the cleaned listing.                                                                                                          |
| D6 | **State is local for now**: redux slice synced to its own versioned localStorage key. Postgres persistence (keyed by job category) and redis response caching are stretch goals (doc 06) — v1 must preserve the seams (stable entry ids, `listingHash`, `baseVersion`, meta) so the stretch needs no rework.                                                            |
| D7 | **Details view is a plain over-screen modal** (regular Chakra Dialog layered over the settings modal) — no right-side drawer positioning work for now. Owner-confirmed 2026-11-07.                                                                                                                                                                                      |
| D8 | **Small, single-responsibility services composed in layers (SOLID).** Runtime-agnostic contracts live in `homelab-services`; browser implementations + their tests live in a NEW `packages/homelab-services-browser` workspace (frontend logic gets tested outside the resume app, which has no test infra). Cypress-based UI e2e is a later addition (doc 03 backlog). |
| D9 | **No cache in v1** — not even in-process. `cacheHit` stays in `TailorMeta` as a reserved seam (always `false`). Caching arrives with the data-persistence work (doc 06), inserted as a decorator layer over doc 02's service composition — zero pipeline rework. Owner-confirmed 2026-11-07.                                                                            |

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

| Doc                                                                    | Scope                                                                                                                                                                                      | Primary packages                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [01-shared-state-and-contracts.md](./01-shared-state-and-contracts.md) | Extract content schemas + defaults to `shared`; extend `ContentState` (D2); patch codec & decode-to-state schema (D3); wire contract shapes; versioning policy                             | `shared`, `resume` (imports)                             |
| [02-ai-pipeline.md](./02-ai-pipeline.md)                               | `TailorService` tag + node layer; OpenRouter client; cleanup & tailor prompts; model-facing wire schema; validation pipeline; degraded fallback; quota; evals (cache deferred per D9)      | `homelab-services`, `homelab-services-node`              |
| [03-api-endpoint.md](./03-api-endpoint.md)                             | `POST /resume/tailor` endpoint def, handler, `Resume_Tailor` authz chain, feature flag, handler + e2e tests                                                                                | `homelab-api`, `homelab-server`                          |
| [04-frontend-ui.md](./04-frontend-ui.md)                               | Tailoring tab, Job Listings, details modal (D7), `tailor` redux slice, NEW `homelab-services-browser` package (entry-store + preset services & tests, D8), auto-apply/preset-snapshot flow | `resume`, `homelab-services`, `homelab-services-browser` |
| [05-nix-and-secrets.md](./05-nix-and-secrets.md)                       | sops key, env template wiring, kanidm role claim, permissions-enum drift fix, local dev env, redaction, praeconinus-dark                                                                   | `nix-config`, `homelab-server` env                       |
| [06-stretch-db-and-cache.md](./06-stretch-db-and-cache.md)             | Postgres persistence keyed by job category; redis response cache; migration path off localStorage; seams v1 must preserve                                                                  | future                                                   |

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
5. **`Resume_Tailor` kanidm group** — reuse the `resume.printing` group's claim map or create a
   dedicated group (doc 05).
