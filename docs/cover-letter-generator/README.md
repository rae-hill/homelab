# Cover-Letter Generator — Planning Hub

Status: **planned (2026-11-18)** — no implementation yet. This directory is the plan of record for
the AI cover-letter feature: `POST /resume/cover-letter` generates a style-matched cover letter
from a job listing + the user's tailored resume content, renders it to PDF via Typst
(letterloom template), and returns the bytes for browser download. It deliberately copies the
architecture of the resume-tailoring feature ([`../resume-tailor-harness/`](../resume-tailor-harness/README.md))
and activates that feature's reserved cache seam (D9/E4) so the two flows share listing-cleanup work.

Prerequisite already landed: `repos/typst.ts` vendored at tag `v0.7.0` (commit `08a46ecfd`).

## Vision

The owner's workflow is: **tailor the resume, then generate a cover letter** — usually from the
same pasted listing, back to back. In the resume app's listing **details modal** (Summary | Changes
tabs), a new **Actions** tab gains a "Download cover letter" button. Clicking it:

1. `POST /resume/cover-letter` (homelab-server) receives the raw listing + the entry's tailored
   content patch. The server hygienizes/sanitizes the listing, then runs the **same stage-1 cleanup**
   as tailoring (extractive cleanup + `jobTitle`/`company` extraction) — but **cache-first**: the
   cleanup result from the immediately-preceding tailor call is expected to be a hit, so the second
   OpenRouter cleanup call is usually skipped (owner directive: lean on the existing content
   hashing as the cache key).
2. **Stage 2 (generation model)** receives the cleaned listing + a compact digest of the tailored
   resume content + the owner's own writing as a **style exemplar** (v1 seed: the SailPoint letter,
   `~/git/cover-letters/sailpoint/cover-letters-2026-sailpoint.typ`) and returns strict-JSON letter
   content: `{ subject, paragraphs[] }` in the owner's voice.
3. The server injects the generated text into a **Typst/letterloom template** (laid out like the
   SailPoint letter: sender block, recipient, date, salutation, bold subject line, signature image,
   "Made with Typst" footer) and compiles it to PDF with the vendored **typst.ts** node compiler
   (`@myriaddreamin/typst-ts-node-compiler`, all-in-one Node library).
4. The PDF bytes stream back (`application/pdf`, `%PDF` magic-checked success schema — the
   `/resume/print` precedent) and the frontend triggers a blob download, same as resume downloads.

## Confirmed decisions (owner, 2026-11-18)

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-D1  | **Response = raw PDF bytes only** — mirror `/resume/print`: success schema `Schema.Uint8Array` + `%PDF` magic filter + `HttpApiSchema.asUint8Array({ contentType: "application/pdf" })`. No JSON envelope, no text preview on the wire in v1. Per-stage meta (tokens/latency/models/cacheHit) is logged + traced server-side only.                                                                                                                                                                                                                                                                                                                                                 |
| CL-D2  | **Request = `{ listing, content: ContentPatchBase64, baseVersion }`** — mirrors `ResumeTailorRequest`; `content` is the ENTRY's tailored content patch (letter matches the tailored resume for that listing). Decoded to `ContentState` at the HttpApi edge by the existing shared codec; `baseVersion` stale-check in the handler (400 `resume-cover-letter-base-version-mismatch`).                                                                                                                                                                                                                                                                                              |
| CL-D3  | **Style seed = the SailPoint letter only, server-side, extensible.** The exemplar lives in a dedicated module as a `CoverLetterExemplar[]` array (`{ name, text }`) composed into the generation prompt by `CoverLetterPromptConfigService`; adding future letters (accu-weather, kaufman, pattern-data, …) = append an entry + bump `promptVersion`. No client-supplied exemplars.                                                                                                                                                                                                                                                                                                |
| CL-D4  | **Dedicated authorization**: resource URI `Resume_CoverLetter`, FGA matcher arm, feature flag `Resume_CoverLetter.enabled`, kanidm group `homelab.resume.coverletter` → claim mapping, shared constant `RESUME_COVER_LETTER_ROLE`. Follows the doc-05 dedicated-groups precedent.                                                                                                                                                                                                                                                                                                                                                                                                  |
| CL-D5  | **Everything in the repo**: the letterloom-based `.typ` template, the sender-contact defaults, and the signature PNG (`~/git/cover-letters/images/signature.PNG`, 96 KB) are committed under `packages/homelab-services-node/assets/typst/`. The vendored **letterloom 3.0.0** universe package is committed there too (offline, deterministic compiles — no runtime `packages.typst.org` fetch).                                                                                                                                                                                                                                                                                  |
| CL-D6  | **Cleanup cache = in-process, exact-hash-only, shared** between the tailor and cover-letter pipelines. Implemented as the decorator layer doc 02 §B / doc 06 §C+E4 reserved: `ListingCleanupCacheService` (Ref-backed LRU+TTL) wrapping `ResumeListingExtractionService`. Key = `listingHash + promptVersion + schemaVersion + cleanupModelSlug` (all already computed). Activates `TailorMeta.cacheHit` (finally non-false on stage-1 hits). NO redis/postgres (doc 06 staging stands: LRU first, telemetry decides).                                                                                                                                                             |
| CL-D7  | **Quota = one shared AI-spend budget.** `TailorQuotaServiceLive` is hoisted so the Tailor and CoverLetter shell aggregates share ONE instance (same per-subject 10/day + global 100/day buckets; a tailor+letter pair consumes 2). Cache hits still consume quota (doc 02 §H rule). Alternative (separate per-feature budgets) rejected: doubles worst-case daily spend.                                                                                                                                                                                                                                                                                                           |
| CL-D8  | **Generation model**: new env `OPENROUTER_COVER_LETTER_MODEL`, code default `"anthropic/claude-sonnet-5.5"` (same as the tailor main model initially; version-pinned slug, env-overridable). Stage 1 keeps `OPENROUTER_CLEANUP_MODEL` (`"openai/gpt-6-luna"`).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CL-D9  | **Typst assets deployed via env path**: `TYPST_ASSETS_DIR` (Option; `None` ⇒ rendering fails fast with a typed error, feature effectively dark). Layout under it: `templates/letter.typ`, `images/signature.PNG`, `vendor/letterloom-3.0.0/`. **REVISED during CL-T8/T9:** the template imports letterloom **BY PATH** (`../vendor/letterloom-3.0.0/src/lib.typ`; letterloom verified self-contained), so the originally planned `XDG_DATA_HOME`→`HttpRegistry` offline-resolution mechanism is GONE entirely — no XDG env anywhere (devshell/systemd/e2e/tests), no package-registry semantics, identical behavior in every environment, and `typst watch` works with zero setup. |
| CL-D10 | **Generated text never parses as Typst markup.** The letter body travels as a JSON data file (shadow-mapped at `<assets>/templates/letter.json`; shadow keys must be ABSOLUTE workspace-joined paths — empirically verified) that the template reads with `json()` and joins as strings — Typst string→content joining is literal text, so `#`, `*`, `$`, `@` etc. from the model are inert (verified twice by rendered-PDF inspection). This is the output-side sibling of the input-side `PromptSanitizationService` hygiene.                                                                                                                                                    |
| CL-D11 | **Frontend = Actions tab in `ListingDetailModal`**, component-local busy state (no new redux slice), request/download Effects in `state/homelab/cover-letter.ts` following the `print.ts` pattern (`HttpApiClient` + `authLayer()` + blob→anchor download). Gated on `useCanCoverLetter()` role + entry status `success`/`degraded`.                                                                                                                                                                                                                                                                                                                                               |
| CL-D12 | **PDF only.** No DOCX cover letter in v1 (typst `html()` export is experimental; revisit later if wanted). No text-preview/edit UI (CL-D1) — the owner reviews the downloaded PDF.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Wire contract

```
POST /resume/cover-letter      (Bearer auth; resource URI Resume_CoverLetter;
                                feature flag Resume_CoverLetter.enabled)
request:  { listing: string,                 // raw pasted text (1–200,000 chars), server hygienizes
            content: ContentPatchBase64,     // the entry's TAILORED content = patch vs shared defaults
            baseVersion: string }            // CONTENT_DEFAULTS_VERSION; mismatch ⇒ 400
response: application/pdf bytes              // Schema.Uint8Array + %PDF magic filter (print precedent)
errors:   400 resume-cover-letter-base-version-mismatch | resume-cover-letter-quota-exceeded
          401/403 authn/authz · 500 CoverLetterError{message, error: raw nested cause}
```

## Architecture

```
 packages/resume (React+RTK)              homelab-server                  homelab-services-node
┌─────────────────────────────┐  POST   ┌──────────────────────┐  CoverLetterSvc ┌────────────────────────────────────┐
│ ListingDetailModal          │ /resume/│ handlers/resume/     │────────────────▶│ layers/cover-letter-service.ts     │
│  └ Actions tab (NEW)        │ cover-  │   cover-letter.ts    │                 │  1. sanitize/truncate + hash       │
│     └ "Download cover       │ letter  │  auth: AuthMiddleware│                 │  2. quota (SHARED with tailor)     │
│        letter" → blob dl    │◀────────│  + canCreate(        │                 │  3. cleanup (CACHE decorator —     │
│                             │  %PDF   │    "Resume_Cover     │                 │     hit expected after tailor)     │
│ entry: {listing,            │  bytes  │     Letter")         │                 │  4. generation prompt (exemplar +  │
│   contentPatch, baseVersion}│         └──────────────────────┘                 │     content digest) → OpenRouter   │
└─────────────────────────────┘                                                 │  5. decode + light validation      │
        main.ts shared wiring (memoized, ONE instance each):                    │  6. template → typ source + JSON   │
        TailorQuotaServiceLive · ListingCleanupCacheServiceLive                 │  7. typst.ts NodeCompiler → PDF    │
              ▲                                                                 └──────────────┬─────────────────────┘
              │ also consumed by Shell.Tailor.Aggregate                                        │ native napi (sync)
                                                                                               ▼
                                                                                    assets/typst/ (repo-committed):
                                                                                    letter.typ · signature.PNG ·
                                                                                    typst/packages/preview/letterloom/3.0.0
```

The cleanup-cache decorator wraps the SAME `ResumeListingExtractionService` tag the tailor
pipeline already consumes — zero pipeline rework (doc 02 §B seam, doc 06 §E4). Because both shell
aggregates must see ONE cache instance and ONE quota instance, `main.ts` provides those two layers
to the merged `Tailor + CoverLetter` aggregate composition (Effect memoizes per-build).

## Document map

| Doc                                                          | Scope                                                                                                                                                                                               | Primary packages                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [01-services-and-pipeline.md](./01-services-and-pipeline.md) | Service defs+impls: `CoverLetterService` orchestrator, `CoverLetterPromptConfigService` (+exemplar seam), cleanup-cache decorator, shared-infra wiring, quota reuse, validation, tests              | `homelab-services`, `homelab-services-node`                              |
| [02-typst-rendering.md](./02-typst-rendering.md)             | Vendored typst.ts facts (v0.7.0), `DocumentRenderingServiceTypst`, `CoverLetterTemplateService`, letterloom template design, assets layout, offline universe packages, fonts, blocking-sync caveats | `homelab-services-node` (+ `repos/typst.ts` reference)                   |
| [03-api-endpoint.md](./03-api-endpoint.md)                   | `POST /resume/cover-letter` schema+endpoint def, handler, `Resume_CoverLetter` authz chain, env additions, unit + e2e tests                                                                         | `homelab-services`, `homelab-api`, `homelab-server`, `homelab-e2e-tests` |
| [04-frontend-ui.md](./04-frontend-ui.md)                     | Actions tab in the details modal, request/download Effects, role gating, styling, toasts, filename convention                                                                                       | `resume`, `shared`                                                       |
| [05-nix-and-deployment.md](./05-nix-and-deployment.md)       | Native-dep closure in `package.nix` (sharp precedent), rolldown externals, systemd env (`TYPST_ASSETS_DIR`), kanidm group+claim, devshell/e2e env, yarn hashes                                      | `nix-config`, `homelab-server` build                                     |

## Task graph

```
CL-T1 assets+deps (template, signature, vendored letterloom, yarn add typst compiler)
   ▼
CL-T2 shared infra: ListingCleanupCacheService + extraction decorator + main.ts/shared wiring
   │        (touches shell/tailor.ts — GOTCHA T15 nesting rules; activates TailorMeta.cacheHit)
   ▼
CL-T3 prompt-config + generation wire schema + validation   ∥  CL-T4 typst rendering + template svc
   └────────────────────────────┬────────────────────────────────────────┘
                                ▼
                    CL-T5 CoverLetterService orchestrator + shell/cover-letter.ts
                                ▼
                    CL-T6 schemas + endpoint + handler + authz chain + unit tests
                                ▼
                    CL-T7 frontend Actions tab + download flow
                                ▼
                    CL-T8 nix (package/systemd/kanidm/devshell/e2e env) + e2e tests
                                ▼
                    CL-T9 live verification (RUN_COVER_LETTER_LIVE) + full e2e suite LAST
```

Suggested waves: **A:** CL-T1 → CL-T2 (serial; CL-T2 changes shared wiring). **B (parallel):**
CL-T3, CL-T4. **C:** CL-T5 → CL-T6 → CL-T7. **D:** CL-T8, then CL-T9. Each task leaves the tree
green (`yarn lint && yarn typecheck && yarn test`; `validation` skill), and CL-T1's `yarn.lock`
change triggers the `nix-hashes` skill before any `nix build` (CL-T8).

## Open questions

1. **letterloom license/attribution** before committing the vendored copy (universe packages are
   typically MIT — verify `typst.toml`/LICENSE in the 3.0.0 tarball; add a NOTICE line).
2. **Fonts**: typst.ts embeds New Computer Modern / Libertinus / DejaVu Sans Mono. Does letterloom
   3.0.0 render acceptably with those, or does the owner want resume-matching fonts via the
   `fontArgs: [{fontPaths}]` seam (would add a fonts dir to assets)? Decide at CL-T4 smoke render.
3. **Fabrication guards on letter prose**: v1 = schema decode + length/count bounds only. Numbers/
   proper-noun cross-check against content+listing (tailor's fabrication-guard analog) is a stretch —
   the owner reviews every downloaded PDF anyway.
4. **Degraded entries**: Actions tab enables for `status === "success" || "degraded"` (same rule as
   Apply). Confirm degraded (pre-v2/no-changes) entries should still produce letters — they carry a
   valid `contentPatch`, so yes by default.
5. ~~**`XDG_DATA_HOME` process-wide** on homelab-api~~ — **RESOLVED (CL-T8/T9): mechanism
   removed.** The by-path letterloom import eliminated the package registry entirely, so no XDG
   env is set anywhere. The hazard proved real during testing: a writable `XDG_DATA_HOME`
   collected `vitest/` + `mimeapps.list` junk inside the git-tracked assets dir.
6. **Cover-letter history**: v1 stores nothing client-side (entry already holds inputs; the PDF is
   ephemeral). If the owner regenerates often, a `coverLetterMeta` field on `TailorEntry` (models,
   cacheHit, timestamp) is a cheap later add — schema version bump on the entry envelope.
7. **Multiple exemplars prompt budget**: each added letter is ~500 tokens of prompt; with prompt
   caching (static system prefix first) the marginal cost is low, but keep the exemplar array
   capped (≤4) unless eval output quality says otherwise.
