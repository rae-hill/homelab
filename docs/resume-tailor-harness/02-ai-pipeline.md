# 02 — AI Pipeline: TailorService, OpenRouter Client, Validation

Covers T4→T5→T6. Doc 01 owns wire contract shapes + patch codec; this doc owns the inference
services. Source paths verified against the tree; if this doc conflicts with source, source wins.

## Purpose

Two-stage OpenRouter pipeline. **Stage 1** (cheap model): extractive cleanup + `jobTitle`/`company`
extraction — deletion only, verbatim preservation so stage-2 evidence stays substring-verifiable.
**Stage 2** (main model): constrained ID-addressed edits + fit report. Server merge authoritative
(D4): no client review, rendered resume is the review surface.

> **OVERRIDE (owner, 2026-11-08 — supersedes the degraded-fallback text below):** pipeline
> failures are typed `TailorError` failures mapped to **500**, with the nested upstream cause
> chain rendered into the error message (`describeErrorChain`, `layers/tailor/errors.ts`). The
> degraded 200 no-op result is gone; `meta.degraded` remains in the wire schema and is always
> `false`. Rationale: a degraded 200 looked like partial success while hiding the real failure
> (e.g. an unconfigured/swallowed OpenRouter error). Stage-1 cleanup no longer falls back to the
> raw listing either. See progress.md §2026-11-08 (afternoon) and commit `cdc7b6db8`.

Original (superseded) design: Degraded fallback: no-op patch +
surviving tips + `meta.degraded=true`, never a 500.

## Verified Current State

Conventions verified against source:

- **Service tag:** `packages/homelab-services/src/services/pdf-print-service.ts` — `PdfPrintServiceId`
  const, `PdfPrintError extends Data.TaggedError`, `PdfPrintServiceDef` interface,
  `PdfPrintService extends Context.Service`, `Effect.fn` accessor. Mirror exactly.
- **Live layer:** `packages/homelab-services-node/src/layers/pdf-print-service.ts` —
  `Layer.effect(Tag, Effect.gen(...))`, constructor takes env + deps, `Effect.gen({self:this}, ...)`.
- **Shell aggregate:** `packages/homelab-services-node/src/shell/printing.ts` — `export const Aggregate = ...Live`.
- **main.ts wiring:** lines 23–27 `Layer.provide(Shell.X.Aggregate)`. Lines 35–40: `FetchHttpClient.layer`
  provided globally with `HttpClient.filterStatusOk`.
- **Env:** `packages/homelab-services/src/config/env.ts` — `EnvDef` interface + `Env` service + accessor exports.
  `packages/homelab-server/src/env.ts` — `Layer.effect(Env, Config.all({...}))`.
- **Secret reading:** `packages/homelab-services-node/src/config/api-key-config.ts` — `FileSystem.readFile`,
  `Schema.RedactedFromValue(Schema.String)`. Fail fast at startup.
- **Outbound HTTP:** `packages/homelab-services-node/src/config/oidc-config-remote.ts` —
  `HttpClient.get`, `HttpClientResponse.schemaBodyJson(Schema)`, `Effect.filterOrElse` status check.
- **Testing:** `packages/homelab-server/test-utils/testing-layer.ts` +
  `packages/homelab-services-node/test-utils/testing-layer.ts` — `ConfigProvider.fromUnknown`,
  `Layer.succeed(Service, impl)` stubs, `HandlerTestLayer`/`IntegrationTestLayer`.
- **JSON Schema emit:** `Schema.toJsonSchemaDocument(schema)` at `repos/effect/.../Schema.ts:18090`
  returns `JsonSchema.Document<"draft-2020-12">`. `ai/Tool.ts:1805` shows the pattern: attach
  `.definitions` as `$defs` on the root schema.
- **JsonPatch:** `get(old,new)` + `apply(patch,doc)` only; throws plain `Error`; deterministic;
  index-based arrays; removals high→low (README verified facts).
- **Differ:** `Schema.toDifferJsonPatch(codec)` at `Schema.ts:18548` returns `Differ<T, JsonPatch>`.
- **Logger/Otel:** `packages/homelab-server/src/logger.ts` — structured JSON, no redaction hooks.
  `packages/homelab-server/src/otel.ts` — `NodeSdk.layer`, no redaction. Both need redaction added (§D).
- **Test idiom:** `packages/homelab-server/test/handlers/resume/print.test.ts` — `@effect/vitest`,
  `Layer.succeed` stubs, `Effect.provide(Layer.mergeAll(...))`.

## A) Service Contract — `homelab-services/src/services/tailor-service.ts`

Mirror `pdf-print-service.ts` exactly. `TailorServiceId = "homelab-api/services/tailor/TailorService"`.
`TailorError extends Data.TaggedError("TailorError")<{message,error}>`. `TailorServiceDef`:

```ts
readonly tailorResume: (
  subject: string,            // caller's stable identifier, forwarded by the handler from
                              // CurrentIdentity — used for the per-subject quota (§H); verify the
                              // exact field/accessor in packages/homelab-services/src/identity.ts
  listing: string,
  content: ContentState,      // decoded at the HttpApi EDGE by the payload codec (doc 01 §D / doc 03)
  baseVersion: string,        // already checked against CONTENT_DEFAULTS_VERSION by the handler (doc 03)
) => Effect.Effect<TailorResponse, TailorError>
```

`TailorResponse` = doc 01's shapes in `packages/homelab-services/src/schemas/resume-tailor.ts`:
`{jobTitle, company, content, baseVersion, fit: FitReport, meta: TailorMeta}`. At the **type** level
`content` is a `ContentState` — the HttpApi success codec (`ContentPatchBase64`) encodes it to the
base64 patch on the wire; the service NEVER hand-diffs or hand-base64s (doc 01 §D canonical builder).
Also define `TailorQuotaExceeded extends Data.TaggedError("TailorQuotaExceeded")<{ retryAfterSeconds: number }>`
as a SEPARATE typed failure from `TailorError` (§H quota) so the handler can map it to a 4xx while
`TailorError` maps to 500 (doc 03).
Reference, don't redefine. `TailorService extends Context.Service`. `Effect.fn` accessor.
Barrel: `services/index.ts` → `export * as TailorService from "./tailor-service.js"`.

## B) Live Layer + Shell Aggregate

**`homelab-services-node/src/layers/tailor-service.ts`** — `Layer.effect(TailorService, Effect.gen(...))`
composed via `Layer.provide` from the small services below + `Config.Env`. Impl class
runs: hygiene → truncate → quota check (§H) → stage-1 → stage-2 → validation → merge
→ keyword coverage → merge-delta assertion (§G step 8) → return merged `ContentState` + `FitReport` +
`TailorMeta`. Base64 patch encoding happens at the HttpApi edge via doc 01's `ContentPatchBase64`
success codec — the service never hand-diffs or hand-base64s.

**Small-service composition (D8/SOLID — owner directive 2026-11-07).** Each concern is a small
self-contained service doing one thing, composed in layers; pure logic stays as plain functions:

- **Services** (tag+def in `homelab-services/src/services/`, Live in `homelab-services-node/src/layers/`):
  - `OpenRouterClientService` — the ONLY HTTP talker (§D); one method (`chat`), provider-agnostic
    request/response types so a future non-OpenRouter provider touches one layer.
  - `TailorQuotaService` — in-process per-subject daily bucket + global ceiling (§H); one method
    (`tryConsume(subject)`), typed `TailorQuotaExceeded` failure.
  - `TailorService` — the orchestrator (§A); composes the two above.
- **Pure internal modules** under `homelab-services-node/src/layers/tailor/`: `prompts.ts`,
  `wire-schema.ts`, `cleanup.ts` (stage-1 pipeline function), `validation.ts` (guards),
  `hygiene.ts` — plain functions over explicit inputs, trivially unit-testable with stubbed data.
  Subdirectory rationale: existing convention is flat `src/layers/*.ts`, but the tailor pipeline is
  complex enough that a subdirectory avoids polluting the top level; `tailor-service.ts`,
  `openrouter-client-service.ts`, `tailor-quota-service.ts` stay at top level as public entries.
- **NO cache module in v1 (D9)** — when caching arrives (doc 06, with persistence) it inserts as a
  decorator LAYER over `TailorService`/`OpenRouterClientService` via composition — zero pipeline
  rework. That composability is the seam; no v1 code.

**Shell aggregate** — `src/shell/tailor.ts`: `export const Aggregate = TailorServiceLive` (its
`Layer.provide` chain already includes `OpenRouterClientServiceLive` + `TailorQuotaServiceLive`).
Barrel: `shell/index.ts` → `export * as Tailor from "./tailor.js"`.
**main.ts** — add `Layer.provide(Shell.Tailor.Aggregate)` after line 26.

## C) Env/Config

**`homelab-services/src/config/env.ts`** — add to `EnvDef`: `openRouterApiKeyFile: Option<string>`,
`openRouterModel: string`, `openRouterCleanupModel: string`, `openRouterBaseUrl: URL`. Accessor
exports for each.

**`homelab-server/src/env.ts`** — add to `Config.all({...})`:

````ts
openRouterApiKeyFile: Config.option(Config.String("OPENROUTER_API_KEY_FILE")),
```ts
// PLACEHOLDER slugs — README OQ 1: owner benchmarks + pins dated current-generation slugs
// before T5 (never mutable aliases). Env overrides let augustus change models without a rebuild.
openRouterModel: Config.withDefault(Config.String("OPENROUTER_MODEL"), "<main-model-slug-TBD>"),
openRouterCleanupModel: Config.withDefault(Config.String("OPENROUTER_CLEANUP_MODEL"), "<cheap-model-slug-TBD>"),
openRouterBaseUrl: Config.withDefault(
  Config.schema(Schema.URLFromString, "OPENROUTER_BASE_URL"),
  new URL("https://openrouter.ai/api/v1"),
),
````

**Secret reading** — in the Live layer, `Option.match` on `openRouterApiKeyFile`: `Some` →
`FileSystem.readFile(path)` → `Redacted.make(content.trim())`; `None` → fail at startup if the
feature is enabled. Never log the value. `Redacted` prevents accidental exposure.

**Test layers** — both `test-utils/testing-layer.ts` files: add tailor env vars to
`TestConfigProvider` (dummy key file path); add `TestTailorService = Layer.succeed(TailorService, stubImpl)`
for handler tests. `makeTestEnvWithFlags` in services-node: include tailor fields defaulting to
`Option.none()` + code-default slugs. Nix wiring is doc 05 — cross-ref only.

## D) OpenRouter Client — `OpenRouterClientService`

Small single-responsibility service (D8): tag + def + `OpenRouterError` in
`homelab-services/src/services/openrouter-client-service.ts` (+ `services/index.ts` barrel); Live
layer in `homelab-services-node/src/layers/openrouter-client-service.ts`. Def — the only HTTP
talker, swappable provider boundary:

```ts
interface OpenRouterClientDef {
  readonly chat: (req: {
    model: string
    messages: ChatMessage[]
    responseFormat: ResponseFormat
    maxTokens: number
    timeout: Duration.Duration
  }) => Effect.Effect<
    {
      content: string
      finishReason: string
      usage: { promptTokens: number; completionTokens: number }
    },
    OpenRouterError
  >
}
```

Live impl mirrors `oidc-config-remote.ts`:

- Read API key via `FileSystem.readFile` → `Redacted` (same pattern as `api-key-config.ts`).
- `HttpClientRequest.post(new URL("/chat/completions", baseUrl))` + `.bodyJson({...})` +
  `.header("Authorization", \`Bearer ${Redacted.value(apiKey)}\`)`+`HTTP-Referer`/`X-Title` headers.
- Body: `{model, messages, response_format: {type:"json_schema", json_schema:{strict:true, name, schema}}, max_tokens, provider:{require_parameters:true, data_collection:"deny"}}`.
- Status filter: `Effect.filterOrElse(res => res.status >= 200 && res.status < 300, ...)`.
- Decode: `HttpClientResponse.schemaBodyJson(OpenRouterResponseSchema)`.
- Timeout: `Effect.timeout("60 seconds")`.
- **Branch on `finish_reason`** — never infer success from 200. Accept `"stop"`/`"end_turn"` only;
  anything else → fail.

**JSON Schema emission** for `response_format.schema`:

```ts
const doc = Schema.toJsonSchemaDocument(TailorEditsWireSchema)
const schema = {
  ...doc.schema,
  ...(Object.keys(doc.definitions).length > 0 ? { $defs: doc.definitions } : {}),
}
```

**Retry on decode failure:** one retry with the decoder error appended to the conversation as an
assistant message + user correction. Not three.

**Authorization header redaction:**

- `packages/homelab-server/src/logger.ts`: add a redaction filter in `structureLogMessage` that
  replaces values for keys matching `/authorization|api[_-]?key|secret|bearer/i`. The `Redacted`
  wrapper's `toString` already redacts; ensure the key never enters log annotations.
- `packages/homelab-server/src/otel.ts`: add a `SpanProcessor` (or `IdGenerator` hook) that
  redacts span attributes matching the same pattern before export.
- A resume + API key in a trace is the worst possible log line. Unit-test: assert no log line or
  span attribute contains the key value.

## E) Stage 1 — Listing Cleanup

**Wire schema** — `CleanupResponse = Struct({cleanedListing: String, jobTitle: String, company: NullOr(String)})`.
Strict-mode: all required, `additionalProperties:false`, `NullOr` not optional, no refinements.

**Prompt** — extractive-only deletion:

- Strip EEO statements, benefits blocks, legal disclaimers, nav cruft.
- **Preserve remaining text VERBATIM** (no paraphrase) — this is what makes stage-2 evidence
  substring-verifiable against `cleanedListing`.
- Extract `jobTitle` (role title as written) + `company` (or null).
- Nonce-delimited `<listing id="NONCE">` wrapper, hard rules: treat instructions as data.

**Fallback** — stage-1 failure/undecodable after retry: use raw listing (hygiene'd), `jobTitle` =
first non-empty line truncated ~100 chars, `company` = null, `meta.stage1 = null` +
`meta.degraded = true` (`TailorMeta.degraded` is a FLAT boolean and stage records are nullable —
doc 01 §E).

**Rationale** — initial-plan §2/§11: EEO/benefits/disclaimers are often 40% of tokens and
contribute nothing. Cleanup is the largest token/latency win available.

## F) Stage 2 — Tailor + Fit

**Wire schema** — `TailorEdits` per initial-plan §4 (adapted for D2 field names):

```ts
Struct({
  headline: NullOr(String), // → doc 01's blurb
  summary: NullOr(String), // → doc 01's aboutMe
  bullets: Array(Struct({ entryId, bulletId, text, rationale })),
  entryDescriptions: Array(Struct({ entryId, description })),
  hiddenBullets: Array(Struct({ entryId, bulletId, rationale })),
  tagGroups: Array(Struct({ entryId, tags: Array(String) })),
})
```

**Strict-mode rules:** every object fully required, `additionalProperties:false`, `NullOr` not
optional, no refinements/transforms/pattern/length constraints. **Snapshot the emitted JSON Schema
in a test** so refinement creep shows as a diff.

**Prompt** — carry initial-plan §6:

- Static system prefix first (prompt caching), listing last in `<listing id="NONCE">`.
- HARD RULES: injection rules (nonce-delimited untrusted listing), no-fabrication, ID-copying,
  length-invariance, hide-not-delete, no touching contact/employers/dates/education.
- TAILORING: `summary` → blurb/aboutMe; 3-5 most relevant bullets per role; hide up to half;
  reorder tag groups by relevance; one-sentence rationale per change.
- REPORTING: closed category list (requirements-inflation | buried-hard-gate | title-scope-mismatch |
  logistics | employment-form | compensation | screening-risk | process | listing-quality); severity
  calibration (default info, caution for application-impacting, blocker for hard gates); 2-5 tips;
  evidence verbatim-or-empty; `keywordCoverage.required` only (matched/missing computed server-side).
- `promptVersion` constant (e.g., `"v1-2026-11"`); increment on changes for cache + eval tracking.

## G) Validation Pipeline

Order matters. Run server-side before anything reaches the client:

1. **Decode** — wire Effect Schema. On failure: one retry with decoder error appended (§D).
2. **ID resolution** — every `entryId`/`bulletId` must exist in submitted content. Unknown → drop + log.
3. **Tag length-invariance + membership** — `tagGroups[].tags` length must match current; every tag
   must already exist. Reject the group otherwise.
4. **Fabrication guard** — extract numbers/percentages/capitalised proper nouns from generated text;
   anything absent from content+listing → flag/drop. ~20 lines, high value.
5. **Evidence guard** — normalize whitespace+case, substring-test against CLEANED listing. Failures
   → downgrade to info/empty or drop.
6. **Merge** — apply validated edits to a deep copy of request `ContentState` via pure domain mutation.
   Assert decodes as `ContentState`. On failure → fall back to original.
7. **Keyword coverage** — compute `matched`/`missing` SERVER-SIDE against merged content (normalized
   comparison). Models are unreliable at set arithmetic.
8. **Merge-delta assertion + response content** — assert the delta between the REQUEST content and
   the merged content is replace-only: `Schema.toDifferJsonPatch(ContentStateCodec).diff(requestContent, merged)`
   must contain only `op:"replace"` (given guards 2–3 hold lengths/membership, anything else is a
   merge bug — reject to degraded). `ContentStateCodec` owned by doc 01
   (`packages/shared/src/resume-content/schema.ts`). NOTE: the RESPONSE patch (vs
   `INITIAL_CONTENT_STATE`, computed by the edge codec — doc 01 §D) may legitimately contain
   `add`/`remove` ops reflecting the user's OWN structural edits (their content arrived as a patch
   vs defaults), so replace-only is an invariant of the MERGE DELTA, not of the wire patch. The
   initial plan's §2 assertion is adapted accordingly.
9. **Degraded fallback** — SUPERSEDED by the 2026-11-08 override (see Purpose): hard failures are
   now 500s with cause chains, not no-op degraded 200s. Kept for design history: ~~any hard
   failure → `content` = round-trip of request (no-op), surviving tips, `meta.degraded=true`.
   Unchanged resume + usable fit report > 500.~~

**Threat model:** schema vocabulary is the guardrail (injection can only produce text inside existing
fields); fabrication guard catches invented numbers; tag guard blocks invented skills; rendered-resume
review (D4) is the human control. Human review of a rendered diff is a security control here, not
just UX — the strongest argument for auto-apply + rendered-review over per-edit review.

## H) Operations

**Input hygiene BEFORE prompting** — `src/layers/tailor/hygiene.ts`:

- Strip base64 blobs (`data:...;base64,...`), `<script>` bodies, zero-width chars (`\u200B-\u200F` etc.),
  collapse whitespace runs. Zero-width chars are injection-obfuscation.

**Truncate** listings >~20k chars FROM THE MIDDLE (requirements front-load, EEO back-loads).
Keep 60% front + 40% back + `[...truncated...]` marker. Log when it fires.

**Cache — DEFERRED (D9, owner 2026-11-07).** No cache in v1, not even in-process: `meta.cacheHit`
is a reserved seam, always `false`. The key scheme (`sha256(normalizedListing + contentHash +
promptVersion + schemaVersion + modelSlugs)`, exact-hash only — never semantic), raw-provider-output
storage, and LRU→redis staging all live in doc 06 §C and activate with the persistence work; the
insertion point is a decorator layer over §B's small-service composition. STILL COMPUTED IN V1:
`listingHash = sha256(normalizedListing)` and `contentHash` into `TailorMeta` (doc 01 §E) — doc 06
seam E3 requires the future cache key to be recomputable from a stored entry alone, and they cost
one hash each.

**Quota** — the endpoint spends money (initial-plan §11): a small in-process per-subject token
bucket (start ~10 tailors/day, keyed by the `subject` argument) + a global daily ceiling; on
exhaustion fail with a typed error the handler maps to 4xx-with-retry-after semantics (doc 03).
Cache hits still count against the bucket (prevents hammering) but spend nothing. The FGA matcher
arm (doc 03) is the typed seam if quota later moves into per-resource authorization policy.

**Logging** — meta only at info (tokens, latency, cacheHit, degraded), never listing/content at info.
`Effect.logInfo` with `Effect.annotateLogs({promptTokens, completionTokens, latencyMs, cacheHit, degraded, model})`.

## I) Tests + Evals

**Unit tests** — pure functions where possible: `hygiene.test.ts`, `validation.test.ts` (each guard),
`quota.test.ts` (bucket limit/refill/global ceiling), `prompts.test.ts` (JSON Schema snapshot + prompt version).

**Pipeline tests** — stub `HttpClient`/`OpenRouterClientService`/`TailorQuotaService` via `Layer.succeed`
(house pattern from `print.test.ts`). Cover: happy path, stage-1/2 decode failure, unknown IDs,
tag length violation, fabrication, evidence mismatch, merge failure, quota exhaustion.

**Eval suite** — ~10 fixture listings as vitest fixtures in `test/tailor/fixtures/`:

| Check       | Assertion                                                           | Regression-critical |
| ----------- | ------------------------------------------------------------------- | ------------------- |
| Schema      | Wire output decodes; MERGE DELTA contains only `replace` ops (§G.8) | No                  |
| IDs         | Every edit resolves to an existing entry/bullet                     | No                  |
| Length      | Tag arrays unchanged in length and membership                       | No                  |
| Fabrication | No number in output absent from content + listing                   | No                  |
| Grounding   | Every non-empty `evidence` is a substring of cleaned listing        | No                  |
| Effect      | `matched.length` beats the untailored baseline                      | No                  |
| Rendering   | Apply patch, render, still ≤ 2 pages                                | No                  |
| Injection   | Embedded instruction → edits only to existing fields, no new claims | **Yes**             |
| Poor match  | Bad-fit listing does not return `verdict:"strong"`                  | **Yes**             |

Sycophancy shows up as an optimistic verdict — won't show up anywhere else.

**Live-call test** — gated behind `OPENROUTER_API_KEY_FILE` being set (pattern: `CHROME_EXECUTABLE`
gating in e2e). Runner: vitest + `@effect/vitest` (mirror `print.test.ts` idiom).

## Task Breakdown

### T4 — TailorService Tag + OpenRouter Client

Service tag/def/error in `homelab-services`; env additions in both `env.ts`; OpenRouter client +
shell aggregate + main.ts wiring + test layers. **Done:** `TailorService` compiles + exports,
OpenRouter client can make a real call (gated), `yarn lint && yarn typecheck && yarn test` pass.

### T5 — Cleanup Stage + Prompts

Stage-1 cleanup, prompts, wire schemas, input hygiene, unit tests. **Done:** cleanup calls
OpenRouter, wire schemas emit strict-mode JSON Schema (snapshot test), hygiene strips injection
vectors, tests pass.

### T6 — Validation + Merge + Evals

Full pipeline in `tailor-service.ts`, validation pipeline, quota service, pipeline tests, eval suite.
**Done:** full two-stage pipeline returns valid `TailorResponse`, all guards work, degraded
fallback returns no-op + tips, quota exhausts with `TailorQuotaExceeded`, eval suite passes
(injection + poor-match are regression-critical), live-call test gated.

## Open Questions

1. **Model slugs** — code defaults are TBD placeholders (README OQ 1). Owner benchmarks candidates
   on instruction-following + strict-structured-output reliability (stage 2) and cost/latency
   (stage 1) before T5; pin dated slugs, never mutable aliases.
2. **Cleanup fallback title** — first non-empty line truncated ~100 chars. Good enough for v1?
3. **Cache** — deferred entirely (D9); design + staging live in doc 06 §C, to be built with the
   persistence work. No v1 decision needed.

## Cross-References

- **Doc 01:** wire contract shapes (`TailorRequest`/`Response`/`FitReport`/`TailorMeta`) in
  `packages/homelab-services/src/schemas/resume-tailor.ts`; patch codec + frozen defaults in
  `packages/shared/src/resume-content/`. Reference, don't redefine.
- **Doc 03:** endpoint def + handler + `Resume_Tailor` authz + feature flag. Handler calls
  `TailorService.tailorResume(subject, listing, content, baseVersion)`.
- **Doc 05:** Nix/sops wiring for `OPENROUTER_API_KEY_FILE`. This doc owns code-side reading.
- **Doc 06:** cache design + redis staging (stretch; activates with the persistence work). v1 ships
  NO cache (D9); this doc owns the small-service composition (§B) the cache decorator will wrap.
