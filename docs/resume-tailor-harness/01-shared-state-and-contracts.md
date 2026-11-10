# 01 — Shared State & Contracts

> **V2 override (owner, 2026-11-09 — plan: [`07-v2-plan.md`](./07-v2-plan.md) §D, task T15):** the
> §E wire shapes grow two fields: `ResumeTailorRequest.policy` (optional,
> `TailorValidationPolicy`, permissive default) and `ResumeTailorResponse.changes`
> (`Array(TailorChange)` — the server-computed merge delta). `ContentPatchBase64`, frozen
> defaults, and versioning policy are unchanged.

Status: **planning** (2026-11). This document covers tasks T1 and T2 from the README's task graph: extract content schemas and defaults into `packages/shared`, extend `ContentState` with the hard-coded blurb and about-me text, build the base64 JSON Patch codec, and define the wire contract shapes. Authoritative on decisions D1–D6: see [`README.md`](./README.md).

---

## Purpose & Scope

This document owns:

- **A)** Extract content schemas from `packages/shared/src/print-config/schema.ts` (~lines 130–162: `BulletPoint`, `ExperienceContent`, `ProjectContent`, `ContentState`) into a new `packages/shared/src/resume-content/` module; `print-config` re-exports for compatibility.
- **B)** Move default content state from `packages/resume/src/state/print-config/content-defaults.ts` into `shared` as `INITIAL_CONTENT_STATE` + a frozen `CONTENT_DEFAULTS_VERSION` ("v1"). Design the versioning policy: patches persist in localStorage (tailor entries) and decode against this base, so defaults are a versioned contract.
- **C)** Extend `ContentState` per decision D2: move the hard-coded heading blurb (`packages/resume/src/components/resume/sections/heading.tsx` `BLURB` const) and AboutMe paragraph (`about-me.tsx`) into `ContentState` as new fields, using today's strings as defaults. Old persisted localStorage blobs must still decode.
- **D)** Patch machinery in `shared` (the heart of D3): hand-written `JsonPatchOperationSchema` (union of add/remove/replace structs, `value: Schema.Json` — the `JsonPatch` module ships no schema), `ContentPatchOps` schema, and `ContentPatchBase64`: a schema whose `Encoded` side is base64 string and whose `Type` side is `ContentState` — decode chain `StringFromBase64` → JSON string → ops → apply to encoded `INITIAL_CONTENT_STATE`.
- **E)** Canonical wire contract **shapes** (placement: `packages/homelab-services/src/schemas/resume-tailor.ts` — sibling of `resume.ts` — plus barrel entry `export * as ResumeTailor` in `schemas/index.ts`; doc 03 wires them into the endpoint, doc 02 consumes them).
- **F)** Consumer migration: `packages/resume/src/state/print-config/types.ts` re-export layer, `slice.ts` id-addressed reducers (~lines 177–247), `persistence.ts` `toStateOrDefault`, `provider.tsx` hydration — list what changes when content schemas move + fields are added.

Out of scope: doc 02 owns the `TailorService` tag + OpenRouter client; doc 03 owns the endpoint definition; doc 04 owns the frontend UI. The model-facing `TailorEdits` schema is **server-internal** (doc 02) — do not put it in `shared` or in the API response.

---

## Verified Current State

### Content schemas in `packages/shared/src/print-config/schema.ts`

Lines 130–162 define the content domain:

```ts
export const BulletPoint = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  visible: Schema.Boolean,
})

export const ExperienceContent = Schema.Struct({
  id: Schema.String,
  company: Schema.String,
  location: Schema.String,
  roles: Schema.Array(Schema.Struct({ title: Schema.String, date: Schema.String })),
  description: Schema.String,
  bulletPoints: Schema.Array(BulletPoint),
  tags: Schema.Array(Schema.String),
})

export const ProjectContent = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  githubLink: Schema.String,
  tags: Schema.Array(Schema.String),
})

export const ContentState = Schema.Struct({
  experience: Schema.Array(ExperienceContent),
  projects: Schema.Array(ProjectContent),
  skills: Schema.Array(Schema.String),
})
```

`PrintConfigState` (line 175) and `PersistedPrintConfig` (line 189) compose `content: ContentState` alongside layout concerns (`toggles`, `featuredMode`, `sections`, `heading`). The README's §"Corrected repo facts" confirms: content schemas live **inside** `print-config/schema.ts`, not in a separate `resume-content/` module.

### Defaults in `packages/resume/src/state/print-config/content-defaults.ts`

Lines 19–134 define `experience: ReadonlyArray<ExperienceContent>` (5 entries: nutrien, shutterfly, simspace, electronic-caregiver, indica-labs). Lines 140–198 define `projects: ReadonlyArray<ProjectContent>` (4 entries: nixos-homelab, schemata-ts, bifold-traverse, matrix-ts). Line 201–205:

```ts
export const initialContentState: ContentState = {
  experience,
  projects,
  skills: ["Foo", "Bar"],
}
```

Note: `content.skills` is a placeholder. The tag cloud reads static `src/components/resume/resume-data.ts` (not in scope for v1 — see §Open Questions).

### Hard-coded text (D2 targets)

`packages/resume/src/components/resume/sections/heading.tsx` lines 13–17:

```ts
const BLURB =
  "Agentic developer, multilingual full-stack engineer, DevOps architect, and mathematician " +
  "seeking a software engineering or DevOps role. Experienced in applying AI to solve " +
  "complex problems and improve user workflows. Proficient in TypeScript, Python, frontend " +
  "frameworks, systems design, and backend microservice architecture. Skilled at building secure, " +
  "distributed, scalable, observable systems with strong performance characteristics."
```

`packages/resume/src/components/resume/sections/about-me.tsx` lines 6–11:

```tsx
<Text m={0}>
  Multilingual full-stack engineer and mathematician seeking a software engineering role with an
  emphasis in frontend or backend development. Dedicated to the craft of principled engineering and
  systematized approaches to AI workflow integration. Experienced in TypeScript, Python, frontend
  frameworks, systems design, and backend microservice architecture. Skilled at building secure,
  distributed, scalable, observable systems with strong performance characteristics.
</Text>
```

Both become `ContentState` fields with today's strings as defaults.

### Codec has no version field

`packages/shared/src/print-config/codec.ts` lines 16–22:

```ts
export const PersistedJson = Schema.fromJsonString(S.PersistedPrintConfig)

export const PersistedBase64 = Schema.StringFromBase64.pipe(Schema.decodeTo(PersistedJson))
```

No version field in `PersistedPrintConfig`. Decode failure silently resets to defaults (`packages/resume/src/state/print-config/persistence.ts` `toStateOrDefault` lines 16–31). With `OptionalWithDefault` (see §C), the blob stays decodable when new fields are added — state whether to also add versioning to `PersistedPrintConfig` now or defer (§F).

### Effect JsonPatch verified facts

`repos/effect/packages/effect/src/JsonPatch.ts`:

- Lines 64–103: `JsonPatchOperation` type (union of `add`/`remove`/`replace` structs, `value: Schema.Json`, no `move`/`copy`/`test`).
- Line 140: `JsonPatch = ReadonlyArray<JsonPatchOperation>`.
- Line 184: `get(oldValue, newValue): JsonPatch` — deterministic, sorted keys, index-based arrays, removals high→low.
- Line 287: `apply(patch, oldValue): Schema.Json` — **throws plain `Error`s** (lines 311, 314, 322, 329, 335, 342, 346, 356, 364), does not mutate.
- **No Schema** — the module exports types + `get`/`apply` only. You cannot hand `JsonPatch` to a provider as a schema and get per-path type safety.

`repos/effect/packages/effect/src/Schema.ts`:

- Line 10415: `export interface StringFromBase64 extends decodeTo<String, String> { ... }` + line 10433 `export const StringFromBase64: StringFromBase64 = ...`.
- Line 5678: `export function decodeTo<To extends Constraint>(to: To): <From extends Constraint>(from: From) => compose<To, From>` + line 5679 (overload with custom `{decode, encode}` transformation). The custom decode transformation bridges into `to`'s `ENCODED` side; getters may return `Effect`.
- Line 9838: `export interface fromJsonString<S extends Constraint> extends decodeTo<S, String> { ... }` + line 9875 `export function fromJsonString<S extends Constraint>(...)`. Used by `print-config/codec.ts` `PersistedJson`.
- Line 18548: `Schema.toDifferJsonPatch(codec)` returns `Differ<T, JsonPatch>` whose `diff` runs over `encodeSync`'d values — prescribe it as the canonical way **both sides** build patches (encode: `ContentState` → `diff(defaults, content)` → `JSON.stringify` → base64).

### OptionalWithDefault combinator

`packages/homelab-services/src/schemas/optionals.ts` lines 27–30:

```ts
export function OptionalWithDefault<A, E, RD, RE>(
  schema: Schema.Codec<A, E, RD, RE>,
  _default: LazyArg<A>,
) {
  return schema.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(_default)),
  )
}
```

`Schema.withDecodingDefaultTypeKey` is the Effect v4 combinator for "optional field, materialize default on decode if absent." Verified in `repos/effect/packages/effect/src/Schema.ts` (grep `withDecodingDefault`).

---

## Design

### A. Extract Content Schemas

**New module:** `packages/shared/src/resume-content/`

```
packages/shared/src/
  resume-content/
    schema.ts            BulletPoint, ExperienceContent, ProjectContent, ContentState (moved from print-config/schema.ts lines 130–162)
    types.ts             Schema.Schema.Type aliases (mirror print-config/types.ts pattern)
    constants.ts         INITIAL_CONTENT_STATE (moved from resume/src/state/print-config/content-defaults.ts), CONTENT_DEFAULTS_VERSION
    index.ts             barrel: export * from "./schema.js"; export * from "./types.js"; export * from "./constants.js"
```

**Shared barrel convention:** `packages/shared/src/index.ts` line 2 adds:

```ts
export * as ResumeContent from "./resume-content/index.js"
```

Mirror `export * as PrintConfig from "./print-config/index.js"` (line 2). **No** `package.json` subpath export — `resume-content` is not a heavy dependency like `oidc` (line 20–22 of `packages/shared/package.json`).

**Compatibility re-exports:** `packages/shared/src/print-config/schema.ts` retains the content schemas as re-exports for any downstream code that hasn't migrated:

```ts
// At the bottom of print-config/schema.ts, after the layout schemas
export {
  BulletPoint,
  ContentState,
  ExperienceContent,
  ProjectContent,
} from "../resume-content/schema.js"
```

`print-config/types.ts` similarly re-exports the types. This keeps the migration non-breaking for existing consumers; doc 04 (frontend) migrates to `ResumeContent.*` imports.

### B. Move Defaults + Versioning Policy

**`packages/shared/src/resume-content/constants.ts`:**

```ts
import type { ContentState } from "./schema.js"

/** Frozen version tag for the default content state. Patches persist in localStorage (tailor entries) and decode against this base, so changing the default is a versioned contract change. */
export const CONTENT_DEFAULTS_VERSION = "v1" as const

/** The default content state — lifted from `packages/resume/src/state/print-config/content-defaults.ts`. */
export const INITIAL_CONTENT_STATE: ContentState = {
  blurb: "...", // see §C
  aboutMe: "...", // see §C
  experience: [
    // ... lifted from content-defaults.ts lines 19–134
  ],
  projects: [
    // ... lifted from content-defaults.ts lines 140–198
  ],
  skills: ["Foo", "Bar"], // placeholder; see §Open Questions
}
```

**Versioning policy:**

- **Frozen-base registry.** When `INITIAL_CONTENT_STATE` changes (new field, default text update, entry added/removed), bump `CONTENT_DEFAULTS_VERSION` to "v2", "v3", etc. Keep the old `INITIAL_CONTENT_STATE_v1` in a `versions/` subdirectory (or inline in `constants.ts` if small) so old patches in localStorage/presets/entries can still decode.
- **Wire contract:** `baseVersion: string` field in `ResumeTailorRequest` and `ResumeTailorResponse` (see §E). Server rejects with 4xx if `request.baseVersion !== CONTENT_DEFAULTS_VERSION` (README §"Wire contract": "mismatch => 4xx"). The client sends the `CONTENT_DEFAULTS_VERSION` it was built with; a newer server version means a newer deployed SPA bundle, so the 4xx simply prompts a reload (defaults ship in the bundle — there is nothing to "fetch").
- **localStorage fallback:** tailor entries store `{ baseVersion, patch: ContentPatchBase64 }`. On decode, if `entry.baseVersion !== CONTENT_DEFAULTS_VERSION`, look up the frozen base for that version, apply the patch, and migrate forward (re-encode against the current base). If the version is unknown (server rolled back?), discard the entry and log.
- **Cadence:** see README §"Open questions" #2 — how often will the real resume content drift from `INITIAL_CONTENT_STATE` v1? Propose: only when entries are added/removed or default text is materially rewritten. Field additions (like §C's `blurb`/`aboutMe`) use `OptionalWithDefault` and do **not** bump the version (the blob stays decodable).

### C. Extend ContentState (D2)

**New fields in `packages/shared/src/resume-content/schema.ts`:**

```ts
export const ContentState = Schema.Struct({
  blurb: OptionalWithDefault(Schema.String, () => BLURB_DEFAULT),
  aboutMe: OptionalWithDefault(Schema.String, () => ABOUT_ME_DEFAULT),
  experience: Schema.Array(ExperienceContent),
  projects: Schema.Array(ProjectContent),
  skills: Schema.Array(Schema.String),
})
```

`OptionalWithDefault` is defined in `packages/homelab-services/src/schemas/optionals.ts` (line 27–30). **Re-export it in `shared`** for symmetry: add `packages/shared/src/schemas/optionals.ts` with the same definition (or move the definition to `shared` and re-export from `homelab-services`). Recommend the latter — `OptionalWithDefault` is a general combinator, not resume-specific.

**Defaults:**

```ts
// packages/shared/src/resume-content/constants.ts
export const BLURB_DEFAULT =
  "Agentic developer, multilingual full-stack engineer, DevOps architect, and mathematician seeking a software engineering or DevOps role. Experienced in applying AI to solve complex problems and improve user workflows. Proficient in TypeScript, Python, frontend frameworks, systems design, and backend microservice architecture. Skilled at building secure, distributed, scalable, observable systems with strong performance characteristics."

export const ABOUT_ME_DEFAULT =
  "Multilingual full-stack engineer and mathematician seeking a software engineering role with an emphasis in frontend or backend development. Dedicated to the craft of principled engineering and systematized approaches to AI workflow integration. Experienced in TypeScript, Python, frontend frameworks, systems design, and backend microservice architecture. Skilled at building secure, distributed, scalable, observable systems with strong performance characteristics."
```

**Field naming:** `blurb` and `aboutMe` as top-level fields (not nested in a `summary` struct). Rationale: the heading blurb and about-me paragraph are rendered in different locations with different styling (`heading.tsx` lines 120–145 renders `blurb` when `heading.description.kind === "Blurb"`; `about-me.tsx` renders `aboutMe` in a separate section). Keeping them flat mirrors the render surface and makes the AI's job clearer (two distinct summaries, one for the heading, one for the body).

**Layout stays layout:** the `heading.description` kind union (`HeaderDescription` in `print-config/schema.ts` lines 59–69: `Blurb | SkillList`) stays layout-only. The `kind` discriminant controls **which layout** renders; the `blurb` field in `ContentState` supplies the text when `kind === "Blurb"`. The `SkillList` layout reads from `SKILL_LINES` (heading.tsx lines 20–23) — still hard-coded, still layout-only. The AI never sees or emits `heading.description.kind`; it only emits `blurb` text. This is the README's §"Core design decision": "Content only. The AI never sees or emits layout."

**Backward compat:** old persisted blobs lack `blurb` and `aboutMe`. `OptionalWithDefault` materializes the defaults on decode, so the blob stays decodable. No version bump. See §F for the migration plan.

**Out of scope (report, likely defer):** `content.skills` is a placeholder `["Foo", "Bar"]` (content-defaults.ts line 204). The tag cloud reads static `src/components/resume/resume-data.ts` (not in `ContentState`). Both are layout/presentation concerns today, not content the AI should tailor. Note in §Open Questions; keep out of v1 scope.

### D. Patch Machinery in Shared

**The heart of D3:** a schema whose `Encoded` side is base64 string and whose `Type` side is `ContentState` — decode chain `StringFromBase64` → JSON string → ops → apply to encoded `INITIAL_CONTENT_STATE`.

**Hand-written `JsonPatchOperationSchema`:**

```ts
// packages/shared/src/resume-content/patch.ts
import { JsonPatch, Schema } from "effect"

const AddOp = Schema.Struct({
  op: Schema.Literal("add"),
  path: Schema.String,
  value: Schema.Json,
  description: Schema.optional(Schema.String),
})

const RemoveOp = Schema.Struct({
  op: Schema.Literal("remove"),
  path: Schema.String,
  description: Schema.optional(Schema.String),
})

const ReplaceOp = Schema.Struct({
  op: Schema.Literal("replace"),
  path: Schema.String,
  value: Schema.Json,
  description: Schema.optional(Schema.String),
})

export const JsonPatchOperationSchema = Schema.Union([AddOp, RemoveOp, ReplaceOp])

export const ContentPatchOps = Schema.Array(JsonPatchOperationSchema)
```

**Why hand-written:** the `JsonPatch` module ships types only, no schema (verified in `repos/effect/packages/effect/src/JsonPatch.ts`). You cannot hand `JsonPatch.JsonPatch` to a provider as a schema and get per-path type safety. The hand-written schema validates the wire shape; the `JsonPatch.apply` call validates the semantics (paths exist, indices in bounds).

**`ContentPatchBase64` codec:**

```ts
// packages/shared/src/resume-content/patch.ts
import { Effect, JsonPatch, Schema, SchemaGetter } from "effect"
import { INITIAL_CONTENT_STATE } from "./constants.js"
import { ContentState } from "./schema.js"

// Encoded (plain-JSON) form of the defaults, computed once. Patches are applied
// and diffed in ENCODED space — this matches toDifferJsonPatch semantics and keeps
// both sides byte-identical.
const EncodedDefaults = Schema.encodeSync(ContentState)(INITIAL_CONTENT_STATE)

/** Wire side: base64 string. Typed side: ContentState.
 *  Decode = apply the patch to the frozen defaults, then ContentState's own decode
 *  validates the result. Encode = diff against the same defaults. */
export const ContentPatchBase64 = Schema.StringFromBase64.pipe(
  // base64 string <-> JSON string <-> ops array
  Schema.decodeTo(Schema.fromJsonString(ContentPatchOps)),
  // ops array <-> ENCODED ContentState JSON (getter directions verified against
  // repos/effect Schema.ts:5678–5707 + SchemaGetter.ts: decode maps From.Type ->
  // To.Encoded; encode maps To.Encoded -> From.Type — NOT the typed ContentState)
  Schema.decodeTo(ContentState, {
    decode: SchemaGetter.transformEffect((ops) =>
      Effect.try({
        try: () => JsonPatch.apply(ops, EncodedDefaults), // apply THROWS plain Errors
        catch: (cause) => new InvalidContentPatchError(cause), // -> decode failure
      })
    ),
    encode: SchemaGetter.transform((encodedContent) =>
      JsonPatch.get(EncodedDefaults, encodedContent)
    ),
  }),
)
```

`InvalidContentPatchError` is a small `Data.TaggedError` in the same module (exact
failure-propagation combinator — `SchemaGetter.fail` vs throwing inside `transformEffect` —
to be confirmed against `repos/effect/packages/effect/src/SchemaGetter.ts` during T2; either
surfaces as a decode failure, which is the requirement).

**Verified facts (re-verify specifics in `repos/effect/packages/effect/src/Schema.ts` if you quote signatures):**

- `Schema.StringFromBase64` (line 10415) is a `decodeTo<String, String>` — bridges base64 string ↔ plain string.
- `Schema.fromJsonString(ContentPatchOps)` (line 9875) is a `decodeTo<ContentPatchOps, String>` — bridges JSON string ↔ ops array.
- `Schema.decodeTo(to, {decode, encode})` (line 5678–5707) is the custom decode transformation. The `decode` getter receives the `From`'s `Type` (ops array) and must return the `To`'s **`Encoded`** side (plain JSON — `ContentState`'s own decode then validates it into the typed value). The `encode` getter receives the `To`'s **`Encoded`** side and must return the `From`'s `Type` (ops array) — it never sees the typed `ContentState`. **Getters may return `Effect`**: `SchemaGetter.transform` (pure), `SchemaGetter.transformEffect` (throwing code like `JsonPatch.apply`), `SchemaGetter.fail` (explicit failure) — verified in `repos/effect/packages/effect/src/SchemaGetter.ts` (exports at lines 358–811).
- `JsonPatch.apply(patch, doc)` (line 287) **throws plain `Error`s** — wrap in `Effect.try` or `try/catch` and convert to `Effect.fail(new Schema.DecodeError(...))`.
- `Schema.toDifferJsonPatch(codec)` (line 18548) returns `Differ<T, JsonPatch>` whose `diff` runs over `encodeSync`'d values — prescribe it as the canonical way **both sides** build patches. The server uses it to diff `INITIAL_CONTENT_STATE` vs the tailored `ContentState`; the client uses it to diff `INITIAL_CONTENT_STATE` vs the user's current `ContentState` (to build the request).

**Canonical patch-building pattern (both sides):**

```ts
import { Schema } from "effect"
import { ResumeContent } from "shared"

// Encoding IS patch-building: ContentState -> diff vs frozen defaults -> base64.
// Runs in Node and the browser alike (no Buffer); the codec's encode side does everything.
const patchBase64: string = Schema.encodeSync(ResumeContent.ContentPatchBase64)(currentContent)
```

No hand-rolled diff/base64 on either side — the codec is the single builder. The server's HttpApi success codec encodes the merged `ContentState` into the response patch; the client's typed API client encodes the request patch and decodes the response patch back to `ContentState` (doc 03 §"Patch codec ⇒ who decodes"). Base64 patches exist **only on the wire and in localStorage** — typed code on both sides handles `ContentState`. `Schema.toDifferJsonPatch(ContentState)` (whose `diff` internally runs `JsonPatch.get(encodeSync(old), encodeSync(new))`) remains available for tests and the server-side merge-delta assertion (doc 02 §G step 8). Because both sides use the same `shared` schemas, encoded forms are byte-identical and diffs deterministic.

**Full codec sketch (decode direction):**

```ts
base64 string
  → Schema.StringFromBase64 → JSON string
  → Schema.fromJsonString(ContentPatchOps) → ops array
  → custom decodeTo → JsonPatch.apply(ops, encodeSync(INITIAL_CONTENT_STATE)) → encoded ContentState
  → decodeUnknownSync(ContentState) → ContentState
```

**Full codec sketch (encode direction):**

```ts
ContentState
  → encodeSync(ContentState) → encoded ContentState (JSON)
  → custom encodeTo → JsonPatch.get(encodeSync(INITIAL_CONTENT_STATE), encodedContent) → ops array
  → JSON.stringify → JSON string
  → Schema.StringFromBase64 (encode direction) → base64 string
```

### E. Wire Contract Shapes

**Placement:** `packages/homelab-services/src/schemas/resume-tailor.ts` (sibling to `resume.ts`). Mirror how `ResumePrintRequest`/`ResumePrintQuery` live in `resume.ts` today. Add barrel export in `packages/homelab-services/src/schemas/index.ts`.

**`ResumeTailorRequest`:**

```ts
// packages/homelab-services/src/schemas/resume-tailor.ts
import { Schema } from "effect"
import { ResumeContent } from "shared"

export const ResumeTailorRequest = Schema.Struct({
  // Abuse bounds ONLY — the server-side middle-truncation (~20k chars) is doc 02 §H's job,
  // so maxLength sits far above it. Adopts doc 03 §Design recommendation (its OQ 3).
  // Verify the exact v4 filter combinator names against repos/effect during T2.
  listing: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200_000)),
  content: ResumeContent.ContentPatchBase64,
  baseVersion: Schema.String,
})

export type ResumeTailorRequest = Schema.Schema.Type<typeof ResumeTailorRequest>
```

**`ResumeTailorResponse`:**

```ts
export const FitReport = Schema.Struct({
  verdict: Schema.Literals(["strong", "partial", "weak"]),
  summary: Schema.String,
  tips: Schema.Array(
    Schema.Struct({
      category: Schema.Literals([
        "requirements-inflation",
        "buried-hard-gate",
        "title-scope-mismatch",
        "logistics",
        "employment-form",
        "compensation",
        "screening-risk",
        "process",
        "listing-quality",
      ]),
      severity: Schema.Literals(["info", "caution", "blocker"]),
      title: Schema.String,
      detail: Schema.String,
      evidence: Schema.String, // verbatim listing quote, or ""
    }),
  ),
  keywordCoverage: Schema.Struct({
    required: Schema.Array(Schema.String),
    matched: Schema.Array(Schema.String), // computed server-side
    missing: Schema.Array(Schema.String),
  }),
})

export type FitReport = Schema.Schema.Type<typeof FitReport>

const StageMeta = Schema.Struct({
  model: Schema.String,
  tokens: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
  latencyMs: Schema.Number,
})

export const TailorMeta = Schema.Struct({
  // Per-stage tokens + latency + model slugs. A stage record is null when that stage
  // produced no successful LLM call — e.g. stage-1 cleanup fallback (doc 02 §E) sets
  // stage1: null and degraded: true. `degraded` stays a FLAT boolean (doc 02 alignment).
  stage1: Schema.NullOr(StageMeta),
  stage2: Schema.NullOr(StageMeta),
  degraded: Schema.Boolean,
  cacheHit: Schema.Boolean, // reserved seam — ALWAYS false in v1 (D9: no cache until the persistence work, doc 06)
  contentHash: Schema.String, // sha256 of the encoded request content
  listingHash: Schema.String, // sha256 of the normalized listing — cache-key ingredient + doc 06 seam E3
  promptVersion: Schema.String,
  schemaVersion: Schema.String,
})

export type TailorMeta = Schema.Schema.Type<typeof TailorMeta>

export const ResumeTailorResponse = Schema.Struct({
  jobTitle: Schema.String,
  company: Schema.NullOr(Schema.String),
  content: ResumeContent.ContentPatchBase64,
  baseVersion: Schema.String,
  fit: FitReport,
  meta: TailorMeta,
})

export type ResumeTailorResponse = Schema.Schema.Type<typeof ResumeTailorResponse>
```

**Type-level vs schema-level:** because `ContentPatchBase64`'s `Type` side is `ContentState`, both `content` fields are `ContentState` in the decoded TypeScript types — the base64 patch exists only on the wire, and the HttpApi edge codecs do the encode/decode (doc 03 §"Patch codec ⇒ who decodes"). Handlers, services, and client thunks never touch base64 (except doc 04's localStorage entries, which re-encode via the codec for compact storage).

**Gotcha category list:** closed, from the initial plan §8 table. Keep it honest — see the initial plan §8 "Calibration matters more than coverage."

**`TailorEdits` (model-facing) is SERVER-INTERNAL.** Doc 02 owns it. Do not put it in `shared` or in the API response. The server decodes the model's output against `TailorEdits`, validates, applies to a copy of the content, diffs against `INITIAL_CONTENT_STATE`, and returns the patch as `ContentPatchBase64`. The client never sees `TailorEdits`.

### F. Consumer Migration

**`packages/resume/src/state/print-config/types.ts`:** re-export layer. Lines 16–37 re-export types from `PrintConfig.*`. After the move, content types come from `ResumeContent.*`:

```ts
export type BulletPoint = ResumeContent.BulletPoint
export type ExperienceContent = ResumeContent.ExperienceContent
export type ProjectContent = ResumeContent.ProjectContent
export type ContentState = ResumeContent.ContentState
```

Layout types stay in `PrintConfig.*`. Add `blurb` and `aboutMe` to the re-exports if needed (they're fields of `ContentState`, not separate types).

**`slice.ts` id-addressed reducers (~lines 177–247):** no changes needed. The reducers (`setEntryDescription`, `setEntryTags`, `addBullet`, `setBulletText`, `toggleBulletVisible`, `removeBullet`) operate on `state.content.experience` and `state.content.projects` — the structure is unchanged. The new `blurb` and `aboutMe` fields are top-level strings; add reducers if the UI needs to edit them (likely doc 04 adds `SetBlurb` and `SetAboutMe` actions).

**`persistence.ts` `toStateOrDefault`:** lines 16–31. No changes needed — `OptionalWithDefault` keeps old blobs decodable. The `result.success` already includes the new fields (materialized with defaults).

**`provider.tsx` hydration:** lines 40–94. No changes needed — the hydration flow reads from localStorage, decodes via `parsePersisted`, and dispatches `hydrate`. The new fields are part of `PrintConfigState.content`, so they flow through unchanged.

**Should we also add versioning to `PersistedPrintConfig` now?** Recommend **defer.** Rationale:

- `OptionalWithDefault` keeps blobs decodable when fields are added (like `blurb`/`aboutMe`). No version bump needed.
- A version field in `PersistedPrintConfig` would let us reject blobs from incompatible versions, but we don't have incompatible versions yet — only additive changes.
- The wire contract (`ResumeTailorRequest.baseVersion`) already versions the **content defaults** separately from the persisted print config. Mixing the two would conflate "this blob was encoded against version X of the defaults" with "this blob was encoded against version Y of the print-config schema."
- If we later need to make a breaking change to `PersistedPrintConfig` (e.g., rename a field, change a type), add a version field then and migrate old blobs. For now, `OptionalWithDefault` is sufficient.

Doc 04 (frontend) may revisit this when building the tailor localStorage entries — those entries store `{ baseVersion, patch }` separately from the print config, so they have their own versioning (see §B).

---

## File-by-File Changes

### Created

1. **`packages/shared/src/resume-content/schema.ts`** — `BulletPoint`, `ExperienceContent`, `ProjectContent`, `ContentState` (moved from `print-config/schema.ts` lines 130–162, extended with `blurb` and `aboutMe` fields using `OptionalWithDefault`).
2. **`packages/shared/src/resume-content/types.ts`** — `Schema.Schema.Type` aliases for the schemas.
3. **`packages/shared/src/resume-content/constants.ts`** — `CONTENT_DEFAULTS_VERSION`, `INITIAL_CONTENT_STATE`, `BLURB_DEFAULT`, `ABOUT_ME_DEFAULT`.
4. **`packages/shared/src/resume-content/patch.ts`** — `JsonPatchOperationSchema`, `ContentPatchOps`, `ContentPatchBase64` codec.
5. **`packages/shared/src/resume-content/index.ts`** — barrel exports.
6. **`packages/shared/src/schemas/optionals.ts`** — `OptionalWithDefault` combinator (moved from `homelab-services/src/schemas/optionals.ts` or re-exported).
7. **`packages/homelab-services/src/schemas/resume-tailor.ts`** — `ResumeTailorRequest`, `ResumeTailorResponse`, `FitReport`, `TailorMeta`.

### Modified

8. **`packages/shared/src/index.ts`** — add `export * as ResumeContent from "./resume-content/index.js"`.
9. **`packages/shared/src/print-config/schema.ts`** — remove lines 130–162 (moved to `resume-content/schema.ts`), add re-exports at the bottom for compatibility.
10. **`packages/shared/src/print-config/types.ts`** — re-export content types from `ResumeContent.*` instead of defining locally.
11. **`packages/homelab-services/src/schemas/optionals.ts`** — if `OptionalWithDefault` is moved to `shared`, re-export it here for backward compat.
12. **`packages/homelab-services/src/schemas/index.ts`** — add barrel export for `resume-tailor.ts`.
13. **`packages/resume/src/state/print-config/types.ts`** — re-export content types from `ResumeContent.*` instead of `PrintConfig.*`.
14. **`packages/resume/src/state/print-config/content-defaults.ts`** — delete (moved to `shared/src/resume-content/constants.ts`).
15. **`packages/resume/src/state/print-config/types.ts`** — remove `initialContentState` export (moved to `shared`).
16. **`packages/resume/src/components/resume/sections/heading.tsx`** — remove `BLURB` const (lines 13–17), read from `content.blurb` instead (doc 04 wires this up).
17. **`packages/resume/src/components/resume/sections/about-me.tsx`** — read from `content.aboutMe` instead of hard-coded text (doc 04 wires this up).

---

## Task Breakdown

### T1: Extract Content Schemas + Extend with Blurb/AboutMe

**Scope:** items A, B, C above.

**Done criteria:**

- `packages/shared/src/resume-content/` module exists with `schema.ts`, `types.ts`, `constants.ts`, `index.ts`.
- `ContentState` includes `blurb` and `aboutMe` fields with `OptionalWithDefault` combinators.
- `INITIAL_CONTENT_STATE` and `CONTENT_DEFAULTS_VERSION` are exported from `constants.ts`.
- `packages/shared/src/index.ts` exports `ResumeContent` namespace.
- `packages/shared/src/print-config/schema.ts` re-exports content schemas for compatibility.
- `packages/resume/src/state/print-config/content-defaults.ts` is deleted.
- `packages/resume/src/state/print-config/types.ts` re-exports content types from `ResumeContent.*`.
- `yarn typecheck` passes in `shared` and `resume`.
- Existing tests in `packages/shared/src/print-config/print-config.test.ts` still pass (old blobs decode with `blurb` and `aboutMe` materialized with defaults).
- New test in `packages/shared/src/resume-content/`: roundtrip `INITIAL_CONTENT_STATE` → encode → decode → assert equal.
- New test: old blob (without `blurb`/`aboutMe`) decodes with defaults materialized.
- New purity test (Test Plan below): encoded `PersistedPrintConfig` contains no tailor-data keys (D8 — lives in `shared`, not the resume app).

### T2: Patch Codec + Wire Contract Shapes

**Scope:** items D, E above.

**Done criteria:**

- `packages/shared/src/resume-content/patch.ts` defines `JsonPatchOperationSchema`, `ContentPatchOps`, `ContentPatchBase64`.
- `ContentPatchBase64` codec roundtrips: `ContentState` → encode → base64 string → decode → `ContentState` (assert equal).
- `ContentPatchBase64` decodes a hand-crafted patch against `INITIAL_CONTENT_STATE` (assert the result matches the expected content).
- `ContentPatchBase64` decode failure on malformed patch (bad path, out-of-bounds index) → decode error (not a throw).
- `packages/homelab-services/src/schemas/resume-tailor.ts` defines `ResumeTailorRequest`, `ResumeTailorResponse`, `FitReport`, `TailorMeta`.
- `FitReport` schema matches the initial plan §8 (verdict, summary, tips[] with closed category list, keywordCoverage).
- `TailorMeta` includes per-stage tokens + latency + model slugs, degraded, cacheHit, contentHash, promptVersion, schemaVersion.
- `yarn typecheck` passes in `shared` and `homelab-services`.
- Snapshot test: emit JSON Schema from `ResumeTailorRequest` and `ResumeTailorResponse` and snapshot it for **shape stability** (accidental field/refinement changes surface as diffs). Note: the initial plan's strict-mode constraints (no `pattern`/length bounds/`minItems`) apply to the **model-facing** `TailorEdits` schema (doc 02 §F), NOT to these HTTP schemas — the `listing` bounds above are deliberate abuse limits.
- Diff determinism test: build a patch with `Schema.toDifferJsonPatch(ContentState)`, assert the patch is stable across multiple calls (same input → same output).

---

## Test Plan

### Roundtrip: ContentState → encode → decode → ContentState

```ts
// packages/shared/src/resume-content/patch.test.ts
import { decodeSync, encodeSync } from "effect/Schema"
import { ContentPatchBase64, INITIAL_CONTENT_STATE } from "./index.js"

const content = { ...INITIAL_CONTENT_STATE, blurb: "Custom blurb" }
const base64 = encodeSync(ContentPatchBase64)(content)
const decoded = decodeSync(ContentPatchBase64)(base64)
assert.deepEqual(decoded, content)
```

### Old-blob compat fixture

```ts
// packages/shared/src/resume-content/compat.test.ts
import { decodeSync } from "effect/Schema"
import { ContentPatchBase64, INITIAL_CONTENT_STATE } from "./index.js"

// Hand-craft a v1 patch (before blurb/aboutMe were added)
const v1Patch = "..." // base64-encoded JSON patch that modifies experience/projects/skills only
const decoded = decodeSync(ContentPatchBase64)(v1Patch)
assert.equal(decoded.blurb, BLURB_DEFAULT) // materialized with default
assert.equal(decoded.aboutMe, ABOUT_ME_DEFAULT) // materialized with default
```

### Apply-failure → decode-failure

```ts
// packages/shared/src/resume-content/patch.test.ts
import { Result } from "effect"
import { decodeUnknownResult } from "effect/Schema"
import { ContentPatchBase64 } from "./index.js"

const malformedPatch = "..." // base64-encoded JSON patch with bad path (e.g., "/experience/99/bullets/0/text")
const result = decodeUnknownResult(ContentPatchBase64)(malformedPatch)
assert.isTrue(Result.isFailure(result)) // decode error, not a throw
```

### Print purity (doc 04 §B — D8: tested outside the resume app)

```ts
// packages/shared/src/print-config/purity.test.ts
// PersistedPrintConfig is a closed struct: assert the ENCODED key set can never contain
// tailor data, so nothing from the tailor slice can leak into a printed PDF's config blob.
const encoded = Schema.encodeSync(PrintConfig.PersistedPrintConfig)(fixtureConfig)
const json = JSON.stringify(encoded)
assert.isFalse(/"fit"|"tips"|"verdict"|"listingText"|"jobTitle"|"contentPatch"/.test(json))
```

### Defaults snapshot

```ts
// packages/shared/src/resume-content/constants.test.ts
import { ABOUT_ME_DEFAULT, BLURB_DEFAULT, INITIAL_CONTENT_STATE } from "./constants.js"

assert.equal(INITIAL_CONTENT_STATE.blurb, BLURB_DEFAULT)
assert.equal(INITIAL_CONTENT_STATE.aboutMe, ABOUT_ME_DEFAULT)
assert.equal(INITIAL_CONTENT_STATE.skills.length, 2) // placeholder
assert.equal(INITIAL_CONTENT_STATE.experience.length, 5) // nutrien, shutterfly, simspace, electronic-caregiver, indica-labs
assert.equal(INITIAL_CONTENT_STATE.projects.length, 4) // nixos-homelab, schemata-ts, bifold-traverse, matrix-ts
```

### Diff determinism

```ts
// packages/shared/src/resume-content/patch.test.ts
import { toDifferJsonPatch } from "effect/Schema"
import { ContentState, INITIAL_CONTENT_STATE } from "./index.js"

// NOTE: toDifferJsonPatch's diff takes TYPED values and encodeSyncs internally —
// passing pre-encoded JSON would double-encode.
const differ = toDifferJsonPatch(ContentState)
const content1 = { ...INITIAL_CONTENT_STATE, blurb: "Custom" }
const content2 = { ...INITIAL_CONTENT_STATE, blurb: "Custom" }

const patch1 = differ.diff(INITIAL_CONTENT_STATE, content1)
const patch2 = differ.diff(INITIAL_CONTENT_STATE, content2)

assert.deepEqual(patch1, patch2) // deterministic
```

---

## Open Questions

1. **`content.skills` placeholder and tag-cloud static.** `content.skills` is `["Foo", "Bar"]` (content-defaults.ts line 204). The tag cloud reads static `src/components/resume/resume-data.ts`. Both are layout/presentation concerns today, not content the AI should tailor. Propose: keep out of v1 scope. If the AI needs to tailor skills in v2, move `resume-data.ts` into `ContentState.skills` and remove the placeholder.

2. **PersistedPrintConfig versioning.** Recommend defer (see §F). `OptionalWithDefault` keeps blobs decodable when fields are added. A version field in `PersistedPrintConfig` would let us reject blobs from incompatible versions, but we don't have incompatible versions yet — only additive changes. Revisit if we later need to make a breaking change (rename a field, change a type).

3. **Versioning cadence for CONTENT_DEFAULTS_VERSION.** See README §"Open questions" #2. Propose: only bump when entries are added/removed or default text is materially rewritten. Field additions use `OptionalWithDefault` and do not bump the version.

---

## Cross-References

- **README:** D1–D6 (decisions), wire contract (request/response shapes), task graph (T1, T2).
- **Doc 02 (`02-ai-pipeline.md`):** owns `TailorService` tag + OpenRouter client, cleanup & tailor prompts, model-facing `TailorEdits` schema (server-internal, not in `shared` or API response), validation pipeline, degraded fallback, quota, evals (cache deferred per D9).
- **Doc 03 (`03-api-endpoint.md`):** owns `POST /resume/tailor` endpoint def, handler, `Resume_Tailor` authz chain, feature flag, handler + e2e tests. Wires `ResumeTailorRequest`/`ResumeTailorResponse` from `homelab-services/schemas/resume-tailor.ts` into the endpoint.
- **Doc 04 (`04-frontend-ui.md`):** owns Tailoring tab, Job Listings, details modal (D7), thin `tailor` redux slice + the NEW `homelab-services-browser` entry-store/preset services (D8), auto-apply/preset-snapshot flow, recall. Consumes `ResumeTailorRequest`/`ResumeTailorResponse` types from `homelab-services` (flowing through the `homelab-api` typed client). Migrates `packages/resume` to `ResumeContent.*` imports. Wires `content.blurb` and `content.aboutMe` into the heading and about-me components.

**Boundaries:**

- `shared` owns content schemas + frozen defaults + patch codec. No business logic, no HTTP, no UI.
- `homelab-services` owns wire contract shapes (`ResumeTailorRequest`/`ResumeTailorResponse`/`FitReport`/`TailorMeta`) + the `TailorService` tag (doc 02 §A). No business logic, no HTTP, no UI.
- `homelab-services-node` owns the pipeline (doc 02): provider calls, `TailorEdits` decode, validation guards, merge into a `ContentState`. Base64 patch encoding is done by the HttpApi edge codec (doc 01 §D), never by hand.
- `homelab-server` owns the handler (doc 03): authz, `baseVersion` check, service call, error mapping. No AI logic.
- `resume` owns the UI (doc 04): sends typed `ContentState` (edge encodes the request patch), receives decoded `ContentState`, applies it, stores entries as base64 patches (re-encoded via the codec).
