# 07 — v2: Service Extraction, Validation Policy, Review Flow, Observability

Status: **planning** (2026-11-09). Owner-directed v2 phase for the resume-tailor feature — the
"final stretch". This doc is the authoritative plan for tasks **T12–T19**; where it conflicts with
docs 01–05, this doc wins (they carry override banners pointing here). v1 shipped state is recorded
in `progress.md` (canonical commit hashes).

## Purpose

v1 works live but concentrates load-bearing pipeline logic in plain function modules
(`homelab-services-node/src/layers/tailor/*`) imported directly by the tailor service. v2:

1. Extracts that logic into **opaque Effect services** (consumers depend on tags + effects, never
   on _how_).
2. Makes validation **policy-driven** (permissive by default; policy travels on the wire from the
   frontend).
3. Makes the LLM **more creatively permissive** (rewrite + add bullets) while keeping the
   no-fabrication core.
4. Turns the details modal into a **review surface** (Summary | Changes tabs; explicit apply with
   overwrite confirmation) — replacing auto-apply + pre-tailor snapshots.
5. Pays down error/schema/hashing/redaction hygiene and fixes **Tempo → logs** correlation.
6. Makes patch machinery **Effect JsonPatch-native** — a dedicated merge-delta service produces
   the delta/guard/`changes` as JsonPatch ops — and plans the gated switch of the MODEL-FACING
   edit vocabulary to JsonPatch ops too (T19, owner's "JsonPatches for everything", M12).

## Owner directives (2026-11-09) — the requirement list

**Extractions** (each impl opaque to consumers; consumers care _what_, not _how_):

- **E1 `resume-tailor-validation-service.ts`** — the `validation.ts` logic, made **configurable via
  a "policy"**: choose which tailorings to keep vs. reject. Eventually the policy is passed from
  the front-end (→ M7). Policy is an extensible concept ("cool stuff later").
- **E2 `resume-listing-extraction-service.ts`** — the `cleanup.ts` logic (renamed for clarity:
  it _extracts_ a clean listing + title/company).
- **E3 `resume-prompt-config-service.ts`** — the `prompts.ts` logic, with a **public `version`
  property** on the service (not encoded in the filesystem). Opens the door to multiple
  version-keyed implementations and eventually version selection.
- **E4 `prompt-sanitization-service.ts`** — the `hygiene.ts` logic; truncation logic stays, but the
  constants become **method arguments** (with current values as defaults).

**Misc / features:**

- **M1 Retire `errors.ts`** — stop formatting nested errors into human-readable strings
  (`describeErrorChain`). Prefer the **raw nested error JSON** in logs and error response objects.
  Tests asserting the old string format: **skip for now** (don't rewrite yet).
- **M2 Wire-schema relocation** — `layers/tailor/wire-schema.ts` → NEW
  `homelab-services-node/src/schemas/Tailoring.ts`, namespace re-export from the package index:
  `Schemas.Tailoring.*`.
- **M3 `hashing-service-sha256`** — new service (def in `homelab-services`, node impl in
  `homelab-services-node`) that creates sha256 digests. Use **native Effect APIs** where possible;
  return an Effect with **its own error type** (house pattern). Replaces manual `createHash`.
- **M4 Schema-based JSON parsing** — replace the manual `JSON.parse(...) as X` casts in the tailor
  pipeline with Effect Schema decoding composed with JSON-parsing helpers.
- **M5 Tempo "View logs for this span" must resolve** — today the link filters on a
  non-existent service label (Loki actually carries `unit="homelab-api.service"` via Alloy journald
  relabels) **and** log lines contain no trace-id. Fix both.
- **M6 `Redacted` at the source** — stop manual key-pattern log redaction in `homelab-server`;
  wrap every sensitive token in Effect's `Redacted` module (stringification redacts itself).
- **M7 Policy on the wire** — the tailor endpoint accepts the validation policy; front-end
  tailoring-tab UI passes it through.
- **M8 Overwrite confirmation instead of backups** — stop saving the "Pre-tailor:" preset snapshot.
  Show _"Are you sure …? Your existing configuration will be overwritten."_ **only when the current
  config differs from the default**, using **Effect equality APIs** for the comparison.
  **Clarified:** the modal pops **only when clicking "Apply changes to resume" in the new Changes
  tab** (→ C1 below).
- **M9 Permissive validation** — default policy **disables validation**; the tag check becomes the
  policy item **"Require tags to be globally available"** instead of a hard rule.
- **M10 Permissive prompts** — the LLM should **rewrite bullets and descriptions** to better match
  the listing, and may **add any bullet** to match a listing requirement, EXCEPT claims that are
  specifically a **language, framework, or runtime** thing. Still avoid fabricating experience.
  Owner reviews every result individually before submitting applications ("allow it to hallucinate
  a bit" — the review is the control). A better "here are all possible options" system may come
  later; not now.
- **M11 Tailoring modal tabs** — the modal opened from a saved tailoring gets tabs **"Summary"**
  (existing analysis) and **"Changes"** (the list of changes the response included). Future:
  feedback for another refinement round — **do not plan/implement that now**.
- **M12 Merge-delta design — agent discretion (owner, 2026-11-09, second message):** a dedicated
  service for the merge delta is welcome if it fits; its relationship with the validation service
  is the agent's call. Owner wants to **"switch to Effect JsonPatches for everything"** eventually
  (it simplifies a lot) — if feasible, plan it now while code is being ripped out anyway.

**Owner clarifications this session:**

- **C1** — the overwrite-confirmation modal pops **only** on "Apply changes to resume" in the
  Changes tab. Consequence (owner-consistent with M11's "currently it just updates state"):
  **submitting a tailoring no longer auto-applies content and no longer snapshots** — the entry is
  stored, the modal opens for review, and apply is explicit. **D1 and D4 are overridden** (README).
- **C2** — the change list is **server-provided**: the response gains a structured `changes` field
  derived from the merge delta the server already computes for its guard (single source of truth;
  ready to feed a future refinement round).
- **C3 (agent decision under M12 delegation)** — merge + delta becomes its own service
  (`ResumeContentMergeService`): validation = SEMANTIC policy (which edits to keep/reject),
  merge = MECHANICAL merge + STRUCTURAL policy (which content-shape transformations are allowed,
  expressed over the **Effect JsonPatch delta**). Wire `changes` are JsonPatch-native (ops reuse
  shared's existing `JsonPatchOperationSchema`, wrapped with `previous` values). The
  JsonPatch-everywhere switch (model emits patch ops directly) is planned as **gated fast-follow
  T19** — feasibility verified, gate = offline evals (details in §H); owner may pull it into v2.

## Verified current state (exploration, 2026-11-09)

- `layers/tailor/`: `validation.ts` (resolveIds, checkTagInvariance, checkFabrication,
  checkEvidence, mergeEdits, computeKeywordCoverage), `cleanup.ts` (`runCleanupStage`; manual
  `JSON.parse(response.content) as CleanupResponse` at L56), `prompts.ts` (8 builders; NONCE-delimited
  listing wrappers), `hygiene.ts` (sanitize/truncate/hygienize; `MAX_LISTING_CHARS=20_000`,
  `TRUNCATION_MARKER`, `FRONT_RATIO=0.6`, `BACK_RATIO=0.4`), `errors.ts` (`describeErrorChain`),
  `wire-schema.ts` (`CleanupResponse`, `TailorEdits`, **`promptVersion = "v1-2026-11"` lives HERE,
  not in prompts.ts**, `schemaVersion = "v1"`).
- `layers/tailor-service.ts` pipeline: hashes (`createHash("sha256")` L61–64: `listingHash`,
  `contentHash`) → hygiene → quota → stage 1 → stage 2 (`JSON.parse(...) as TailorEdits` L131) →
  validation 5a–5g (5g = inline merge-delta assert via `ResumeContent.ContentDiffer.diff`, **fails
  on non-`replace` ops**) → result+meta. `describeErrorChain` at 9 call sites + `cleanup.ts` (2) +
  `openrouter-client-service.ts` (1 import).
- Tests: `tailor-validation.test.ts`, `tailor-hygiene.test.ts`, `tailor-prompts.test.ts` (asserts
  `promptVersion`), `errors.test.ts` (**asserts exact `describeErrorChain` string format**),
  `tailor-pipeline.test.ts`; `homelab-server/test/handlers/resume/tailor.test.ts` (chain via
  `toContain`).
- `homelab-services-node/src/index.ts` exports `Config`, `Layers`, `Shell` — **no `Schemas`
  namespace yet**; `homelab-services/src/index.ts` has `export * as Schemas from "./schemas/index.js"`.
- `TailorService` def: `tailorResume(subject, listing, content, baseVersion) =>
  Effect<TailorResult, TailorError | TailorQuotaExceeded>`; `TailorError{message, error: unknown}`.
  `Shell.Tailor.Aggregate` = TailorServiceLive + OpenRouterClientServiceLive + TailorQuotaServiceLive.
- `ApiErrors.InternalServerError` **already carries `error: OptionalUnknown`** (http-errors.ts:57–64)
  → raw nested error JSON needs NO error-schema change.
- Effect **4.1.2** (vendored `repos/effect`): `effect/crypto` exports `Digest` service
  (`digest.digestHex(Digest.sha256, bytes)`, `Digest.layerWebCrypto` — Node 18+ has
  `globalThis.crypto.subtle`); `Schema.fromJsonString(schema)` decodes a JSON string to the
  schema's Type (there is NO `Schema.parseJson` in v4); `Equal.equals` does **deep structural
  equality on plain objects**; `Redacted.make/value`, `toString()/toJSON()` → `<redacted[:label]>`,
  `Schema.Redacted`/`Schema.RedactedFromValue` exist; **no `Secret` module** in this version.
- Logging/OTel: `homelab-server/src/logger.ts` — `LOG_STYLE` JSON|pretty; JSON lines =
  `{logLevel, timestamp, cause, annotations, spans, fiberId, …message}`, **no trace_id**;
  `Logger.tracerLogger` present in both branches (span-event bridge). Manual redaction =
  **key-name pattern only** (`SENSITIVE_KEY_PATTERN` in logger.ts:5 + `RedactingSpanProcessor` in
  otel.ts:30 covering span + span-event attributes). OTel `serviceName: "homelab-api"` (otel.ts:102).
  `@effect/opentelemetry` spans expose a **public `traceId`** (OtelTracer.ts:417/458).
- Grafana provisioning `nix-config/modules/features/grafana/service.nix:93–99`:
  `tracesToLogsV2 = { datasourceUid="loki"; filterByTraceID=true; filterBySpanID=false;
  customQuery=false; }` — **no `tags` mapping**, so Grafana derives a `service_name`-style label
  matcher that never matches Alloy's journald labels (`nix-config/modules/services/alloy.nix:24–67`
  produces `unit`, `hostname`, `syslevel`, `container`, `transport` — the unit label for homelab-api
  is `homelab-api.service`). Hence "view logs for this span" resolves to nothing.
- Secrets: env vars are file PATHS (raw strings, fine); contents already `Redacted` in
  `openrouter-client-service.ts` (`Redacted.make`) and `api-key-config.ts`
  (`Schema.RedactedFromValue`); `basic-auth-middleware.ts` uses `Redacted`. **Token-issuer private
  key / JWK / homelab-secret reads are NOT yet `Redacted`-wrapped** (audit in T18).
- Frontend: `packages/resume/src/state/tailor/hooks.ts` — `useSubmitTailor` (L59–157: pre-saves
  "Pre-tailor:" snapshot L130–142, auto-applies via `printConfigActions.applyTailoredContent`) and
  `useRecallEntry` (L202–214: pre-save + apply). `listing-detail-modal.tsx` = single-scroll Chakra
  Dialog (header → FitSummary → KeywordCoverage → TipsList → CollapsibleListing → MetaFooter;
  footer Delete + "Apply to resume"). `TailorEntry` (contract in
  `homelab-services/src/services/tailor-entry-store-service.ts`): `{id, status, createdAt,
  listingText, jobTitle, company, fit, contentPatch, baseVersion, meta, error}` — **no changes
  field**; envelope `version: 1`, cap 50. `packages/resume` has `effect@4.1.2` (Equal available).
  Content default for comparison: `ResumeContent.INITIAL_CONTENT_STATE` (already imported in
  `print-config/types.ts`). `generatePresetName`/`resolveCollision` live in
  `homelab-services/src/services/preset-snapshot-service.ts`.
- Content/patch facts bearing on the merge-delta design (verified 2026-11-09):
  `BulletPoint` is an OBJECT `{id, text, visible}` (`shared/src/resume-content/schema.ts:13`) —
  v1's "hide" = `visible: false` (a `replace` op, which is why the replace-only guard passed);
  **added bullets (T16) produce `add` ops** → the guard must relax. `tags: Array(String)` per
  entry/project. `shared/src/resume-content/patch.ts` ALREADY hand-writes the JsonPatch op schemas
  (`AddOp`/`RemoveOp`/`ReplaceOp` → `JsonPatchOperationSchema` union → `ContentPatchOps`) because
  effect's `JsonPatch` module exports types + `get`/`apply` only, and exports
  `ContentDiffer = Schema.toDifferJsonPatch(ContentState)`. `mergeEdits` (validation.ts) is pure
  ID-based domain mutation over a `JSON.parse(JSON.stringify(...))` deep copy. All
  model-editable leaf values are `string | boolean | string[]` — a flattened strict-mode-safe op
  schema for T19 is feasible (no unions needed in the model-facing response_format).

## Design

### A) T12 — Retire `errors.ts`: raw nested error JSON (M1)

> **LANDED (`fc3364dac`)** — per owner directive (2026-11-09), serialization is
> Effect-Schema-native, not a hand-rolled mapper: `Utils.errorToJson`/`parseErrorJson`
> (`homelab-services/src/utils/error-json.ts`) wrap **`Schema.Defect()`** — encode: `Error` →
> recursive `{name, message, cause?}` JSON (cycles → `"[Circular]"`; `Data.TaggedError` identity
> survives via `name` = tag); decode: validates the JSON and rebuilds `Error`s. Trade-off: the
> native encoder drops Error-subclass own-fields beyond name/message/cause — load-bearing context
> belongs in `message`/`cause` (`TailorError.error` carries the pre-encoded nested JSON).

- Delete `layers/tailor/errors.ts`; remove all 12 `describeErrorChain` call sites
  (`tailor-service.ts` ×9, `cleanup.ts` ×2, `openrouter-client-service.ts` ×1).
- Failure shape stays `TailorError{message, error}` — but `message` becomes a SHORT stage context
  string (e.g. `"tailor stage 1 failed"`) and `error` carries the **raw underlying error object**
  (nested `.cause`/`.error` chain untouched — no string rendering).
- Handler mapping (doc 03): `TailorError → new ApiErrors.InternalServerError({ message: err.message,
  error: err.error })` — the `error: OptionalUnknown` field already exists on the wire schema, so
  clients/logs get the raw nested JSON to dig through. Server-side logging keeps `Effect.logError`
  (the JSON logger's `cause` field renders chains in its own structured way — that is acceptable;
  the point is no bespoke string formatter).
- Tests: `errors.test.ts` asserts the exact old format → convert to a `describe.skip` placeholder
  with a `TODO(v2)` note (module is gone, so imports must go too — keep the file as the skip
  marker per owner's "skip them for now"). Audit `tailor-pipeline.test.ts` +
  `homelab-server/test/handlers/resume/tailor.test.ts` for chain-string assertions: keep behavioral
  assertions (500 mapping, quota 400), skip/relax format-specific ones with `TODO(v2)` comments.

### B) T13 — The four extracted services (E1–E4, M9)

House pattern per doc 02 §B: **tag+def+error in `homelab-services/src/services/<name>.ts`** (barrel
`export * as XService`), **Live layer in `homelab-services-node/src/layers/<name>.ts`** (barrel
`layers/index.ts`), composed in `shell/tailor.ts`. Owner directives apply: no module-scoped mutable
state; `makeXService(...)` factories for configurable internals; time via `Clock`.
`TailorServiceLive` becomes a pure orchestrator over the tags — it must not import any `tailor/*`
function module afterwards (those files are deleted; `wire-schema.ts` survives until T14).

**1. `ResumeTailorValidationService`** (`resume-tailor-validation-service.ts`) — absorbs the
SEMANTIC half of `validation.ts` (resolveIds, checkTagInvariance → policy rule, checkFabrication,
checkEvidence, computeKeywordCoverage). Structural concerns (merge, delta, guard) move to the
merge service below (C3 split). Interface sketch:

```ts
readonly validateEdits: (args: {
  content: ContentState // request content (decoded at edge)
  edits: Schemas.Tailoring.TailorEdits.Type // parsed stage-2 output (T14 moves the schema)
  cleanedListing: string
  policy: TailorValidationPolicy
}) => Effect.Effect<{
  edits: Schemas.Tailoring.TailorEdits.Type // filtered: rejected edits removed
  dropped: ReadonlyArray<{ reason: string; detail: unknown }> // for structured logging
}, TailorValidationError>
readonly computeKeywordCoverage: (args: {
  merged: ContentState
  required: ReadonlyArray<string>
}) => Effect.Effect<{
  matched: ReadonlyArray<string>
  missing: ReadonlyArray<string>
}, TailorValidationError>
```

- **`TailorValidationPolicy` schema** lives in `homelab-services/src/schemas/resume-tailor.ts`
  (`Schemas.ResumeTailor.TailorValidationPolicy`) so the SAME schema serves the service def, the
  wire request (T15), and the frontend (M7). Sketch (all fields defaulted → the schema alone
  defines the permissive default policy):

```ts
Struct({
  enabled: Boolean, // DEFAULT false — master switch (M9)
  requireTagsGloballyAvailable: Boolean, // DEFAULT true when enabled — the tag policy item (M9)
  rejectFabricatedMetrics: Boolean, // DEFAULT true when enabled — numbers/%/proper nouns
  groundTipsInListing: Boolean, // DEFAULT true when enabled — evidence substring check
})
```

Extensible: new rules = new defaulted fields (old clients keep decoding; T19 adds
`allowedEditPaths`). "Globally available" tags = the tag vocabulary of the submitted base content
(union of `experience[].tags` + `projects[].tags`) — the static resume tag cloud lives only in
`packages/resume` today; see OQ6 for promoting it to `shared`.

- `policy.enabled === false` (the default) → skip fabrication/evidence/tag checks. Unknown-ID
  edits are still dropped (they cannot be merged — merge mechanics, not policy).
  `enabled === true` → v1 strictness, with the tag rule now toggled by
  `requireTagsGloballyAvailable` instead of the unconditional `checkTagInvariance`.
- Tests: migrate `tailor-validation.test.ts` → service-level tests (stub-free: the impl is pure
  over inputs), covering the policy-off vs policy-on matrix, tag-vocabulary rule, drop reporting.

**2. `ResumeListingExtractionService`** (`resume-listing-extraction-service.ts`) — absorbs
`cleanup.ts` (`runCleanupStage`). Interface sketch:

```ts
readonly extract: (args: { listing: string }) => Effect.Effect<{
  cleanedListing: string
  jobTitle: string
  company: string | null
  stage: StageMeta-ish { model, promptTokens, completionTokens, latencyMs }
}, ListingExtractionError>
```

Impl depends on `OpenRouterClientService` + `ResumePromptConfigService` (cleanup messages +
response format) and parses via schema (T14). Errors: typed, raw-cause (T12 semantics — no chain
strings). The extractive-only cleanup PROMPT contract (doc 02 §E) is unchanged in v2.

**3. `ResumePromptConfigService`** (`resume-prompt-config-service.ts`) — absorbs `prompts.ts`.
Public **`version`** property on the service def (E3):

```ts
interface ResumePromptConfigServiceDef {
  readonly version: string // promptVersion — was wire-schema.ts "v1-2026-11"
  readonly schemaVersion: string // model-facing output-schema version — was "v1"
  readonly buildCleanupMessages: (args) => ChatMessage[]
  readonly buildCleanupResponseFormat: () => ResponseFormat
  readonly buildTailorMessages: (args) => ChatMessage[]
  readonly buildTailorResponseFormat: () => ResponseFormat
}
```

`version` is a plain property (no Effect needed to read it); `TailorMeta.promptVersion` reports
`service.version`. Impl = `makeResumePromptConfigService({ version, schemaVersion, …builders })`
layer factory → multiple version-keyed impls compose; **version selection** (env or request) is
deferred (OQ7). T16 ships the v2 impl (permissive prompts) — the factory shape makes "v1 vs v2"
a layer choice, enabling A/B evals.

**4. `PromptSanitizationService`** (`prompt-sanitization-service.ts`) — absorbs `hygiene.ts`
(sanitize/truncate/hygienize). Truncation constants become **method arguments** with today's values
as defaults (E4):

```ts
readonly sanitize: (text: string) => string-effect…
readonly truncate: (text: string, opts?: {
  maxChars?: number      // default 20_000
  marker?: string        // default "\n[...truncated...]\n"
  frontRatio?: number    // default 0.6
  backRatio?: number     // default 0.4
}) => …
readonly hygienize: (text: string, opts?) => …   // sanitize+truncate composition
```

Migrate `tailor-hygiene.test.ts` (incl. explicit-args cases).

**5. `ResumeContentMergeService`** (`resume-content-merge-service.ts`) — NEW service (agent-named
under the M12 delegation, decision C3). Absorbs `mergeEdits` from `validation.ts` AND the inline
merge-delta assertion (tailor-service 5g). The MECHANICAL + STRUCTURAL counterpart to the
validation service's SEMANTIC policy:

```ts
readonly merge: (args: {
  content: ContentState // request content
  edits: Schemas.Tailoring.TailorEdits.Type // VALIDATED edits (validation service output)
  policy: TailorValidationPolicy // structural-guard configuration
}) => Effect.Effect<{
  merged: ContentState
  delta: JsonPatch.JsonPatch // Effect JsonPatch: ContentDiffer.diff(content, merged)
  changes: ReadonlyArray<TailorChange> // delta ops enriched with `previous` (→ T15 wire)
}, ContentMergeError>
```

- Merge mechanics: ID-addressed domain mutation (headline→blurb, summary→aboutMe, bullet text,
  `visible:false` hides, descriptions, tag reorder; **appends `addedBullets` from T16**); deep copy
  via `structuredClone` (replaces the `JSON.parse(JSON.stringify())` idiom, M4-adjacent).
- **Structural guard over the delta (policy-driven):** merged output must decode as `ContentState`;
  allowed delta ops under the default permissive policy = `replace` + `add` (added bullets need
  `add`; hides are `replace` on `bulletPoints/*/visible` — verified in source, which is why v1's
  replace-only guard passed). `remove` stays REJECTED in v2 (nothing in the edit vocabulary
  produces it; a policy flag can allow it later). `policy.enabled === true` → v1 replace-only
  strictness plus `add` only where the policy explicitly allows additions (exact mapping decided
  in T13 impl; the strict policy reproduces v1 behavior by default).
- **Relationship with the validation service (C3):** sequential, composed by the orchestrator —
  `validateEdits` (semantic keep/reject) → `merge` (mechanical + structural) →
  `computeKeywordCoverage(merged, …)`. Two services because they change for different reasons
  (semantic policy evolves with prompts/models; the structural guard evolves with the content
  schema), and because the merge service is the **JsonPatch seam for T19**: when the model starts
  emitting patch ops directly, `merge` becomes `JsonPatch.apply` + a path-allowlist guard and the
  validation service shrinks — consumers (the orchestrator) don't change.
- `changes` enrichment: for each delta op, look up `previous` at its path in the REQUEST content
  (replace/remove); adds carry `previous: null`.
- Tests: merge mechanics (rewrites/hides/additions/tag reorder), delta op vocabulary per edit
  kind, guard matrix (policy on/off × op kinds), `changes` enrichment correctness.

**Wiring:** `shell/tailor.ts` Aggregate grows the five new Live layers; `layers/index.ts` +
`services/index.ts` barrel entries. `tailor-prompts.test.ts` migrates to prompt-config-service
tests and asserts `service.version` instead of the wire-schema constant.

### C) T14 — `Schemas.Tailoring`, schema-based parsing, hashing service (M2–M4)

- **M2:** move `layers/tailor/wire-schema.ts` → `homelab-services-node/src/schemas/Tailoring.ts`
  (`CleanupResponse`, `TailorEdits`; the `promptVersion`/`schemaVersion` constants moved to the
  prompt-config service in T13). NEW `src/schemas/index.ts` (`export * as Tailoring from
  "./Tailoring.js"`); `src/index.ts` gains `export * as Schemas from "./schemas/index.js"` (mirrors
  homelab-services). Consumers use `Schemas.Tailoring.TailorEdits` etc.
- **M4:** replace `JSON.parse(response.content) as CleanupResponse` (extraction service) and
  `as TailorEdits` (tailor-service L131) with
  `Schema.decodeUnknownEffect(Schema.fromJsonString(Schemas.Tailoring.X))` — decode failures become
  typed errors feeding the existing one-retry-with-decoder-error logic (doc 02 §D). Also replace
  validation's `JSON.parse(JSON.stringify(content))` deep copy with `structuredClone`.
- **M3 `HashingServiceSha256`:** def `homelab-services/src/services/hashing-service-sha256.ts`:

```ts
class HashingServiceSha256Error extends Data.TaggedError("HashingServiceSha256Error")<{
  message: string
  error: unknown
}> {}
interface HashingServiceSha256Def {
  readonly digestHex: (
    input: string | Uint8Array,
  ) => Effect.Effect<string, HashingServiceSha256Error>
}
```

Node impl prefers the **native Effect API**: `effect/crypto` `Digest` service
(`digest.digestHex(Digest.sha256, bytes)` + `Digest.layerWebCrypto`; Node 18+ provides
`crypto.subtle`). Fallback if the rolldown bundle mishandles it (remember the undici lesson):
node `createHash` inside `Effect.try` (hmac-service precedent) — still behind the same tag.
Replace `tailor-service.ts` L61–64 (`listingHash`/`contentHash`). Barrel + Shell wiring; unit
test with a known vector (`"abc"` → `ba7816bf…`).

### D) T15 — Wire v2: `policy` in, `changes` out (M7 backend, C2)

- `Schemas.ResumeTailor.ResumeTailorRequest` gains optional **`policy`**
  (`TailorValidationPolicy`, defaulted → omitting it selects the permissive default).
- `Schemas.ResumeTailor.ResumeTailorResponse` gains **`changes: Array(TailorChange)`**:

```ts
TailorChange = Struct({
  patch: ResumeContent.JsonPatchOperationSchema, // Effect JsonPatch op (add/remove/replace) —
  //   reuses shared's existing hand-written op schema (resume-content/patch.ts:40)
  previous: OptionalUnknown, // value at path before merge (replace/remove); null for add
})
```

The `changes` array IS the merge service's **Effect JsonPatch delta** (§B.5), enriched with
`previous` — JsonPatch-native vocabulary end-to-end (C3/M12): the content wire codec already
speaks JsonPatch (doc 01), the delta/guard/changes now do too, and T19 extends it to the
model-facing edits. Single source of truth for the Changes tab (C2) and the seam a future
refinement round would post back.

- `TailorServiceDef.tailorResume(subject, listing, content, baseVersion, policy?)`;
  `TailorResult` gains `changes`. Handler passes `args.payload.policy ?? default`.
- Endpoint def (homelab-api) needs no change (schema-driven; typed client picks it up).
- Tests: handler (policy passthrough; `changes` present in stub response), e2e resume tailor
  (response decodes with `changes`; request accepts an explicit policy). Update docs 01 §E / 03
  contract text when landed.

### E) T16 — Prompt v2: creative liberty within fabrication bounds (M10)

- Model-facing `Schemas.Tailoring.TailorEdits` extends with
  **`addedBullets: Array(Struct({ entryId, text, rationale }))`** (strict-mode rules preserved:
  all-required, `additionalProperties:false`). The MERGE SERVICE appends them to the addressed
  entry's `bulletPoints` (fresh ids, `visible: true`) — allowed under the default permissive
  policy's add-tolerant structural guard (§B.5); produces `add` ops in the delta/changes.
- Stage-2 system prompt rewrite (in the v2 prompt-config impl):
  - KEEP: nonce-delimited untrusted-listing injection rules; ID-copying; don't touch
    contact/employers/dates/education; one-sentence rationale per change; fit-report contract
    (closed categories, severity calibration, evidence verbatim-or-empty).
  - RELAX: bullets and descriptions SHOULD be rewritten to mirror the listing's language and
    requirements; adding bullets that match listing requirements is allowed.
  - HARD BOUND: never fabricate experience claiming a specific **language, framework, or runtime**
    that is absent from the candidate's content; no invented metrics/numbers/percentages/titles/
    credentials beyond content+listing. (Owner reviews every result before applying — M11's
    Changes tab is the human control, matching doc 02's threat-model note that diff review is a
    security control.)
- Bump **`promptVersion` → `"v2-2026-11"`** and **`schemaVersion` → `"v2"`** (both now properties
  of the prompt-config service). JSON-Schema emission snapshot test updates (doc 02 §F).
- Evals (doc 02 §I) rework: Length/tag/IDs checks become policy-conditional (run them with
  `enabled:true` fixtures); Injection stays **regression-critical** but its assertion shifts to the
  new bound (injection must not produce language/framework/runtime claims or new metrics);
  Poor-match unchanged. NOTE for the owner: with the default permissive policy the server-side
  fabrication guard is OFF — prompt-level bounds + Changes-tab review are the controls.

### F) T17 — Frontend v2: review flow, policy UI, Summary|Changes tabs (M7 UI, M8, M11, C1)

- **Submit flow** (`state/tailor/hooks.ts` `useSubmitTailor`): delete the pre-save snapshot block;
  **no auto-apply**. On success: dispatch `submitSucceeded` (entry now stores `changes` from the
  response), `openDetail(entry.id)` so the modal opens for review, toast "Tailoring ready — review
  the changes." (Error path unchanged: badge + toast + Retry.)
- **Entry schema** (`homelab-services/src/services/tailor-entry-store-service.ts`): add
  `changes: ReadonlyArray<TailorChange> | null` — nullable so pre-v2 localStorage entries decode
  (envelope stays `version: 1`; absence → null). services-browser entry-store tests updated.
- **Details modal → tabs** (`listing-detail-modal.tsx`, Chakra v3 `Tabs.Root` inside the Dialog):
  - **Summary** tab: existing sections (FitSummary, KeywordCoverage, TipsList, CollapsibleListing,
    MetaFooter).
  - **Changes** tab: render `entry.changes` as a readable list (op badge + humanized path +
    previous → value; null changes → "No changes recorded (pre-v2 entry)"). Primary action
    **"Apply changes to resume"** lives HERE (footer keeps Delete only).
- **Apply + confirmation (M8/C1):** clicking apply decodes `entry.contentPatch` (stale-base guard
  unchanged) and checks `Equal.equals(currentContent, ResumeContent.INITIAL_CONTENT_STATE)`
  (deep structural equality — verified in Effect 4.1.2). If **different from default** → centered
  confirmation Dialog: _"Are you sure you want to apply this tailoring? Your existing
  configuration will be overwritten."_ (Confirm → `applyTailoredContent` + toast; Cancel → back to
  the Changes tab.) If equal to default → apply immediately, no modal. `useRecallEntry` loses its
  pre-save block and routes through this same confirm-then-apply helper.
- **Policy UI (M7):** collapsible "Validation policy" section in the tailoring tab — a Switch per
  policy field (`enabled` master switch off by default; the three rule switches disabled unless
  `enabled`), wired into `requestTailor`'s payload (`state/homelab/tailor.ts` gains the `policy`
  arg). Component-state only for v2 (persistence = OQ8).
- **Dead-code sweep:** remove `generatePresetName` (+ its tests) from `preset-snapshot-service.ts`
  — the "Pre-tailor:" naming is retired with the snapshot flow. Keep `resolveCollision`, the
  `onCollision:"suffix"` API, and manual preset behavior untouched.

### G) T18 — Observability: Tempo→logs, trace-id in logs, Redacted at source (M5, M6)

- **Grafana provisioning** (`nix-config/modules/features/grafana/service.nix` tracesToLogsV2):
  switch to a deterministic custom query keyed on the label Loki actually has:

```nix
tracesToLogsV2 = {
  datasourceUid = "loki";
  filterByTraceID = true;
  filterBySpanID = false;
  customQuery = true;
  query = ''{unit="homelab-api.service"} |= "$__traceID"'';
};
```

(Verify the exact `${__traceID}` interpolation syntax against the provisioned Grafana version;
the derived-matcher path is dead because Alloy exposes `unit`, not `service_name`.)

- **trace-id in log lines** (`homelab-server/src/logger.ts`): extend the JSON console logger to
  emit `trace_id` (and `span_id`) when the log entry has an active OTel-backed span — the
  `@effect/opentelemetry` span exposes a public `traceId` (verified OtelTracer.ts:417/458);
  research the exact access path from the log entry's `spans` collection (fallback: annotate logs
  with the trace id inside the tracer middleware in `main.ts`). Pretty/dev style unchanged.
  Acceptance: a request-scoped `journalctl -u homelab-api` line contains the trace id; Tempo "View
  logs for this span" returns the request's logs.
- **Redacted at source (M6):** audit every sensitive-value read and wrap in `Redacted` where not
  already: token-issuer private key + JWK secret reads, `HOMELAB_SECRET_FILE` contents
  (openrouter key + api-key config already done). Then **delete the manual redaction**:
  `SENSITIVE_KEY_PATTERN`/`redactSensitiveValue` in logger.ts and the `RedactingSpanProcessor`
  attribute-rewriting in otel.ts (keep plain `BatchSpanProcessor`). `Redacted.toString/toJSON` →
  `<redacted>` covers console lines, span events (via `Logger.tracerLogger`), and any accidental
  stringification. Add a behavioral unit test (a `Redacted` secret inside a logged annotation
  renders `<redacted>` in the JSON line) and KEEP doc 05 §9's acceptance grep
  (`journalctl … | grep -c 'sk-or-'` → 0) at deploy time.
- Sequencing: after T12 (openrouter-client-service is touched there); logger.ts/otel.ts/nix-config
  are otherwise disjoint from T13–T17 and can run in parallel with them.

### H) T19 — Effect JsonPatch everywhere: model-facing edits switch (GATED fast-follow; M12)

The owner's end-state (M12): the whole system speaks Effect JsonPatch — "it simplifies things a
lot." v2 delivers the server-side half: the content wire codec is already JsonPatch (doc 01), and
the merge delta/guard/`changes` become JsonPatch-native (§B.5, §D). The remaining piece is the
**model-facing** `TailorEdits` vocabulary (ID-addressed semantic edits). T19 replaces it with
constrained JsonPatch ops. Planned now (owner: "we're ripping things out anyway"), executed
behind a gate.

**Feasibility (verified 2026-11-09 against vendored Effect 4.1.2 + shared source):**

- Effect's `JsonPatch` exports types + `get(old,new)` + `apply(patch,doc)` only; `apply` THROWS on
  bad paths/indices. Shared already hand-writes the op schemas (`JsonPatchOperationSchema`,
  `ContentPatchOps` in `resume-content/patch.ts`) — the wire vocabulary exists.
- Every model-editable leaf is `string | boolean | string[]` (bullet `text`, `visible`,
  descriptions, blurb/aboutMe, tags) → a **flattened strict-mode-safe op schema** for the
  OpenRouter `response_format` is feasible WITHOUT unions:
  `{op: enum(add|remove|replace), path: string, value: string|null, flag: boolean|null,
  tags: string[]|null}` (all-required, `additionalProperties:false`; per-kind value fields keep
  strict structured-output happy — no `anyOf` inside array items).
- Bad model paths → `JsonPatch.apply` throws → typed failure → the existing one-retry-with-
  decoder-error loop (doc 02 §D) → 500 on second failure (D5 override). Same failure semantics as
  today's decode retry.

**Design:**

- Prompt-config **v3 impl** (the E3 factory — version bump = a layer choice): the user message
  renders the content **path-annotated** (every editable leaf carries its exact JSON pointer —
  deterministic, and "copy the address" is the same skill v1's ID-copying already demands); the
  system prompt requires ops that reference ONLY those paths. M10's fabrication bounds carry over
  verbatim.
- Merge service: `merge` becomes `JsonPatch.apply(ops, content)` + re-decode as `ContentState`;
  the structural guard becomes a **path-allowlist policy** — new policy field `allowedEditPaths`
  (defaults admit `/blurb`, `/aboutMe`, `/experience/*/description`,
  `/experience/*/bulletPoints` + `/experience/*/bulletPoints/*` (text/visible/append),
  `/experience/*/tags`, and the `/projects/*` analogs; per-path op kinds: add/replace on bullets,
  `remove` stays policy-gated). Contact/employers/dates/education become **structurally**
  out of reach — strictly stronger than v1's prompt-level "don't touch" rule.
- Validation service shrinks: ID resolution disappears (paths ARE the addressing); fabrication/
  evidence checks move onto op `value` payloads; the tag-vocabulary rule = allowlist + value
  check. The semantic policy items survive unchanged.
- Frontend/wire unaffected: `changes` are already JsonPatch ops (T15) — the Changes tab renders
  them identically.

**Gate (ALL must pass before the v3 impl becomes the default — owner sign-off):**

1. Offline evals (doc 02 §I fixtures): patch-apply success rate ≥ the ID-format baseline.
2. Injection eval **regression-critical PASS** under the path allowlist (structural-exclusion
   proof).
3. Poor-match eval unchanged.
4. Owner sample review of v3 output quality (same bar as the M10 review flow).

Gate fails → keep the ID-addressed vocabulary shipped; the merge-service interface isolates the
vocabulary choice either way (the C3 seam). Sequencing: after T16; ∥ T17 (backend-only files).

## Task breakdown & waves

| Task | Scope (directives)                                                                              | Files center of gravity                                               | Depends on                           |
| ---- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| T12  | errors.ts retirement, raw nested error JSON (M1)                                                | tailor-service, cleanup, openrouter-client, handler, tests            | —                                    |
| T13  | 5 service extractions (4 owner-named + merge-delta service) + policy schema (E1–E4, M9, M12/C3) | services defs ×5, layers ×5, shell, tailor-service, tests             | T12                                  |
| T14  | Schemas.Tailoring + fromJsonString parsing + HashingServiceSha256 (M2–M4)                       | services-node schemas/, layers, tailor pipeline, tests                | T13                                  |
| T15  | wire `policy` + `changes` (M7 backend, C2)                                                      | resume-tailor.ts schema, tailor-service def, handler, tests, e2e      | T13, T14                             |
| T16  | prompt v2 + addedBullets + version bumps + evals (M10)                                          | prompt-config impl, Schemas.Tailoring, merge service, eval fixtures   | T15                                  |
| T17  | frontend review flow + tabs + policy UI + confirm modal (M7 UI, M8, M11, C1)                    | packages/resume, entry-store contract, services-browser tests         | T15                                  |
| T18  | Tempo→logs + trace-id logging + Redacted at source (M5, M6)                                     | homelab-server logger/otel/env-adjacent, nix-config grafana           | T12                                  |
| T19  | model-facing edits → Effect JsonPatch ops + path-allowlist policy (M12, §H)                     | prompt-config v3, Schemas.Tailoring v3, merge/validation impls, evals | T16 — **GATED** (§H gate + owner go) |

Waves: **V2-A:** T12 → T13 → T14 (serial — shared files). **V2-B:** T15 → T16 → T19 (serial; T19
is GATED — starts only after the §H eval gate passes and the owner green-lights the switch), ∥ T18
(after T12; disjoint files). **V2-C:** T17 (after T15; ∥ T16/T19). **Validation:** per-task
`yarn lint && yarn typecheck && yarn test` (+ `yarn workspace resume build` for T17; shellcheck +
`nix build`/eval for T18's nix changes — `git add` new `.nix` files first). **Full `e2e` suite
runs LAST**, after all tasks land (owner directive — subprocess-heavy). Every task commits with
`--no-verify`.

Execution protocol (owner directives): conserve tokens — delegate to cheap subagents
(`qwen3.8-flash` mechanical, `qwen3.7-plus` design-heavy) with self-contained prompts and disjoint
file scopes; coordinator reviews. If a test resists diagnosis after ~2 attempts: **commit, mark the
test skipped with `TODO(v2)`, flag it in progress.md** — do not loop. Update `progress.md` (status
table + session log + gotchas) after every task.

**Seeding private test values (owner directive, 2026-11-09):** never hand-place files under
`packages/*/private/` — run **`yarn seed:test-secrets`** (consolidates the reusable
`scripts/stage-test-secrets.mjs` + `scripts/stage-e2e-secrets.mjs`; idempotent, never overwrites).
REQUIRED first step in any fresh worktree/checkout — the gitignored fixtures (hmac-secret,
jwk.json, api-keys.json, dummy openrouter key, `.env-serve-test`) are absent there and `yarn test`
cascade-fails without them (627 errors observed). CI runs the unit seeder itself (ci.yml).

## Test plan

- T12: behavioral error-mapping tests survive (500 + `error` field carries the raw cause);
  format-assertion suites skipped with `TODO(v2)`.
- T13: per-service unit tests (policy-off/on matrix; tag-vocabulary rule; truncation args;
  extraction parse-failure typing; prompt `version` property; merge mechanics + delta op
  vocabulary + guard matrix + `changes` enrichment).
- T14: `Schemas.Tailoring` emission snapshot; decode-failure → typed error (no casts);
  hashing known-vector test.
- T15: handler policy passthrough + `changes` in response; e2e resume tailor asserts `changes`
  decodes and a strict policy round-trips.
- T16: eval fixtures per doc 02 §I (injection + poor-fit regression-critical under the new bound);
  JSON-Schema snapshot diff for `addedBullets`.
- T17: services-browser entry-store tests (nullable `changes`, legacy envelope compat); manual
  browser checklist (modal tabs, confirm-only-when-non-default, apply, policy UI) — resume has no
  test infra (D8); Cypress remains backlog.
- T18: redaction behavioral test; local trace-id log check (boot server, hit an endpoint, grep the
  log line); nix eval + `nix build` for the grafana module; deploy-time acceptance = doc 05 §9
  grep + a live Tempo "View logs for this span" click.
- T19: the §H gate IS the test plan — offline eval comparison (patch-apply success ≥ ID baseline;
  injection regression-critical PASS under the allowlist; poor-match unchanged) + owner sample
  review, all before the v3 impl becomes the default.

## Open questions

6. **Global tag vocabulary source** — v2 defines "globally available" as the base content's tag
   union (server-visible). Promote the static resume tag cloud (`packages/resume` resume-data.ts) to
   `shared` for a true global list? (Owner, with T13/T16.)
7. **Prompt version selection** — the prompt-config factory enables version-keyed impls; selection
   mechanism (env var? request field? per-policy?) deferred until a second version needs to run
   concurrently. (Owner.)
8. **Policy UI persistence** — component state for v2; persist per-user (redux/localStorage) if the
   owner finds themselves re-toggling. (Owner, after living with it.)
9. **Changes rendering polish** — v2 renders raw JSON-pointer paths + values; humanized field
   labels ("Experience → Acme Corp → bullet 3") can come with the refinement-round work. (Backlog.)
10. **T19 timing** — planned as a gated fast-follow (§H); the owner may pull it into v2 scope.
    The merge-service seam makes it cheap either way. (Owner.)

## Cross-references

- **Doc 01** — wire shapes it owns gain `policy`/`changes` (banner added; T15 updates §E text).
- **Doc 02** — v1 pipeline design; §B's "pure internal modules under layers/tailor/" is superseded
  by §B above (services); §G validation order becomes policy-driven; §F prompt contract becomes
  the v1 impl of the prompt-config service; §D's redaction notes superseded by T18.
- **Doc 03** — endpoint/handler; request/response sketch gains `policy`/`changes`; 500 mapping
  gains the raw `error` field.
- **Doc 04** — D1 auto-apply/snapshot flow superseded by §F above (review-then-apply); details
  modal gains tabs.
- **Doc 05** — §9 redaction acceptance grep survives; manual-redaction implementation it describes
  is replaced by Redacted-at-source (T18).
- **progress.md** — status table + session log + gotchas (canonical).
