# Plan — Effect adoption, schema-based persistence, import/export, presets

Toward an eventual AI "Tailor" feature (deferred). This plan covers the groundwork + two
user-facing features. **AI/Tailor is explicitly out of scope for now.**

## Phase 0 — Vendor Effect docs

Clone Effect source + docs into `repos/` for their steering docs (incl. the AI examples
`ai-docs/src/71_ai/*` for later). Reference-only; not built.

## Phase 1 — Effect everywhere (prerequisite)

Effect **v4** (the version on `main`; RC is acceptable per owner).

### 1a. Remove dead `@fp-tx/core` code

Nothing live imports these (they served the removed `/experience` page):

- `src/components/experience-item/` (base, mixins, view, index)
- `src/components/experience-items.tsx`, `src/components/experience-items-list.tsx`
- `src/components/mixins/` (ts-mixer helper)

Delete all of the above. Keep `src/blog/**` (owner will migrate later). This removes the
bulk of fp-tx usage and the `ts-mixer` dependency.

### 1b. Migrate the few live fp-tx usages

- `src/hooks/useParallax.ts` — uses `@fp-tx/core/IO` + `Option` + `pipe`/`constVoid`. The
  logic is a simple scroll→transform; rewrite in plain TS (or `effect`'s `Option` if it
  reads cleanly). No behavior change.
- `src/util.ts` — `concat` uses `@fp-tx/core/string` + `Monoid`. Replace with plain
  template-string concat. Keep `awaitEl`/`awaitClasses` (used by effects hooks).

Then drop `@fp-tx/core` and `ts-mixer` from `package.json`.

### 1c. Schema-based persistence (schemas as source of truth)

Add `effect` (v4). Define `effect/Schema` schemas for the whole print-config state and
**derive the TS types** from them (`typeof Schema.Type`), replacing the hand-written
interfaces in `types.ts` and the hand-rolled validators in `persistence.ts`.

- Model the tagged unions (`SectionLayout`, `HeaderDescription`) with
  `Schema.Union` + `Schema.TaggedStruct` (Effect has first-class ADT support).
- Decode persisted JSON with `Schema.decodeUnknownEither` (or `decodeUnknownSync` with a
  try/catch), falling back to defaults on failure — same resilience as today, far less code.
- `editingEnabled` stays omitted from the persisted projection (ephemeral); the persisted
  schema simply doesn't include it (or we strip before encode).
- The slice/reducers/hooks keep the same shapes (types now come from the schema). The
  `PrintConfigState` type stays exported from `types.ts` but is now `Schema.Type<...>`.

Net: `persistence.ts`'s ~340 lines of manual parsers collapse into schema decode; this also
gives the exact codec reused by Phases 2–3.

## Phase 2 — Import / Export config (Settings)

A control group (likely a new subsection in the Print tab, or a small "Import/Export"
area) with:

- **Export**: `Schema.encode` current state → JSON string → base64 → shown in a read-only
  textarea + copy button. Base64 avoids whitespace/paste issues.
- **Import**: textarea to paste base64 → decode base64 → JSON → `Schema.decode` → on
  success dispatch `hydrate`; on failure show an inline error (no state change).

Reuses the Phase-1 codec; no new validation logic.

## Phase 3 — Presets (new "Presets" tab)

- New settings tab "Presets".
- **Save**: name input + Save button → stores `{ name → base64(state) }` in a dedicated
  localStorage key (separate from the live config key).
- **Recall**: list of saved presets, each with Recall + Delete.
- **Default preset**: a built-in, read-only "Default" always listed first = the current
  `initialPrintConfigState`. The existing **Reset** button recalls exactly this. Saving a
  preset named "Default" is disallowed (reserved name).
- Persist via the same base64/schema codec for consistency.

## Verification (each phase)

- `yarn typecheck` (0 errors), `yarn build`, `yarn preview` smoke.
- Phase 1: render parity + persisted-config round-trips (old localStorage blobs still
  decode, or fall back cleanly).
- Phases 2–3: export→import round-trip restores identical state; preset save/recall/delete;
  Reset recalls Default.

## Out of scope (deferred, per owner)

- AI "Tailor" tab + Effect AI/Anthropic→Qwen wiring (owner still designing; Qwen provider
  details at docs.qwencloud.com claude-code guide for later).
- Content "don't lie" tailoring contract.
