# 04 — Frontend UI & State

Status: **planning** (2026-11). Covers T7 and T8. Authoritative on D1, D4, D6: see [`README.md`](./README.md).

> **Override note (2026-11-08):** the server no longer returns degraded results — failures
> arrive as 500s whose message carries the cause chain, flowing through the existing
> `submitFailed` + error-toast path (so users now SEE why a tailor failed). The `"degraded"`
> status/badge/toast described below still exists in the code — unreachable from the live
> server, kept harmless for pre-override localStorage entries. Do not build new UI on it.

## Purpose & Scope

**A) Tailoring tab**: Add `"tailoring"` to `TABS` (`print-config-fab.tsx` line 84). Tab body: listing textarea + char counter (warn near ~20k truncation) + Submit + honest "Working… {elapsed}s" status + error surface. Gate: `useCanTailorResume` checking `signedIn + reachable + Resume_Tailor` role (doc 05 owns constant).

**B) Tailor slice (THIN)**: NEW `src/state/tailor/{slice.ts, types.ts, hooks.ts, index.ts}`. Entry: `{ id, status, createdAt, listingText, jobTitle, company, fit, contentPatch, baseVersion, meta, error }`. Reducers: `submitStarted`, `submitSucceeded`, `submitFailed`, `removeEntry`, `openDetail`, `closeDetail`, `hydrate`. Cap/prune, versioned envelope, and preset-naming logic live in small services (D8) — not in the slice.

**C) Entry persistence (D6+D8)**: `TailorEntryStoreService` — contract in `homelab-services`, browser implementation + tests in the NEW `packages/homelab-services-browser` workspace, over an injected WebStorage port. Key `"https://resume.rae-hill.dev__tailor-listings"`, versioned envelope `{ version: 1, entries }`, cap 50. Resume hydrates + write-through-subscribes.

**D) Auto-apply (D1)**: Submit → POST (mirror `requestResumePdf`). On success: (1) PRE-SAVE preset via `PresetSnapshotService` (D8, extracted from `usePresets`) named "Pre-tailor: <jobTitle> — <YYYY-MM-DD HH:mm>"; (2) dispatch `applyTailoredContent(content)` replacing ONLY `state.content`; (3) toast. Degraded: skip pre-save + apply. Error: badge + Retry.

**E) Details modal (D7)**: regular over-screen Chakra Dialog layered OVER the settings bottom sheet — no right-drawer positioning for now. Content: header + fit + keywords + tips + collapsible listing + meta. Actions: "Apply to resume" + "Delete".

**F) Listings list**: Reverse-chron rows, click → details modal, empty state.

**G) Blurb/AboutMe**: Wire to state + minimal editing UI in Heading tab.

**H) State movement**: Doc 01 moves `content-defaults.ts` → shared.

## Verified Current State

**Settings modal** (`print-config-fab.tsx`): `TABS` line 84 = `["print","heading","experience","projects","presets","share"]`. Dialog.Root at line 697 with `placement="bottom"`, `motionPreset="slide-in-bottom"`, `scrollBehavior="inside"`. Tabs.Root at line 778. URL params validated in `__root.tsx` lines 32–46 via `validateSearch`. Tab validation at line 663: `const tab = TABS.includes(rawTab) ? rawTab : "print"`. Add `"tailoring"` to TABS array; no other changes needed — existing validation handles it.

**Presets** (`hooks.ts` lines 298–374): `usePresets()` hook returns `{ presets, save, recall, remove }`. `save(name, state): boolean` validates non-empty and not "Default" (line 335–338), writes to `PRINT_CONFIG_PRESETS_LOCAL_STORAGE_KEY` via `persist(record)`. **Issue**: auto-apply flow runs in Effect thunk (not React component), so cannot call `usePresets()` directly. **Refactor (D8)**: extract into `PresetSnapshotService` (§D) — contract in `homelab-services`, browser impl + tests in `homelab-services-browser`; `usePresets()` becomes a thin hook wrapping it.

**applyConfig** (`slice.ts` lines 259–261): `applyConfig(state, action)` returns `{ ...action.payload, editingEnabled: state.editingEnabled }` — replaces entire PrintConfigState (toggles, featuredMode, sections, heading, content) except editingEnabled. **Wrong for auto-apply** which must preserve layout. **New reducer needed**: `applyTailoredContent(state, action: PayloadAction<ContentState>)` sets `state.content = action.payload` only.

**requestResumePdf** (`print.ts` lines 44–78): `Effect.gen(function*() { ... })` with `yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: homelabEnv.apiUrl })`, then `yield* client.resume.print({ payload, query, headers: { authorization: \`Bearer ${idToken}\` } })`. Auth:`yield* AuthService`→`auth.getUser()`→`Option.match`to extract`idToken`. Errors:`NotSignedInError`,`ResumePrintRequestError`(both`Data.TaggedError`). **Mirror EXACTLY** for tailor: new`requestTailor(listing, content, baseVersion): Effect<TailorResponse, NotSignedInError | TailorRequestError>`.

**useCanPrintResume** (`hooks.ts` lines 27–37): `reachability === "reachable" && auth.status === "signedIn" && auth.roles.includes(Constants.RESUME_PRINT_ROLE)`. `auth.roles: ReadonlyArray<string>` from slice. `Constants.RESUME_PRINT_ROLE = "Resume_Print"` (shared/constants.ts line 8). **Mirror for tailor**: `useCanTailorResume` checking `Constants.RESUME_TAILOR_ROLE` (doc 05 adds constant).

**Hydration** (`provider.tsx` lines 40–93): one-shot `useEffect` (client-only, SSR-safe): (1) `localStorage.getItem(PRINT_CONFIG_LOCAL_STORAGE_KEY)` → `dispatch(printConfigActions.hydrate(parsePersisted(raw)))`, (2) apply `?importPrintSettings` URL param if present via `decodeBase64Config`, (3) `store.subscribe(() => localStorage.setItem(..., persistableSnapshot(state.printConfig)))` write-through. **Mirror for tailor**: fold into same `useEffect`, add tailor hydration + separate `store.subscribe` for tailor slice, return combined unsubscribe.

**Hard-coded content**: `heading.tsx` lines 13–17 `const BLURB = "Agentic developer..."`, `about-me.tsx` lines 6–11 `<Text m={0}>Multilingual full-stack engineer...</Text>`. Doc 01 moves both to `ContentState.blurb` and `ContentState.aboutMe` with today's strings as defaults in `INITIAL_CONTENT_STATE`.

**Tests**: NO test setup in `packages/resume` — no `vitest.config.ts`, no `*.test.*` files, `package.json` has `"test:staged": "echo 'No tests for resume'"` only. Other packages (homelab-data, homelab-services-node) use vitest with `vitest.shared.js`. **D8 mitigation**: do NOT add vitest to resume in v1 — testable logic moves to the new `homelab-services-browser` package (§C) and `shared` (doc 01); UI behavior is manually checked until the Cypress backlog lands (doc 03).

## Design

### A. Tailoring Tab

**Tab registration**: `TABS` line 84 → add `"tailoring"`. Add `Tabs.Trigger` (icon: `LuWand2`) + `Tabs.Content` wrapping `TailoringTab`.

**Tab body** (`src/components/tailoring/tailoring-tab.tsx`):

- Listing textarea (`Textarea` with `autoresize`, `minH="8rem"`)
- Char counter (orange near 18k, red at 20k)
- Submit button (disabled when `!canTailor || !listingText.trim() || submitting`)
- Status: "Working… {elapsed}s" via `setInterval` (honest, NO fake stages)
- Error surface (red text + Retry when `status === "error"`)
- `ListingList` below

**Auth gating**: `useCanTailorResume` in `hooks.ts` mirroring `useCanPrintResume` with `RESUME_TAILOR_ROLE`. When `!canTailor`: disable Submit, show hint.

### B. Tailor Slice

**Files**: `src/state/tailor/{types.ts, slice.ts, hooks.ts, persistence.ts, index.ts}`.

**Types** (`types.ts`):

```ts
export type TailorStatus = "pending" | "success" | "degraded" | "error"
export interface TailorEntry {
  id: string // ulid or uuid, stable across retries
  status: TailorStatus
  createdAt: number // Date.now()
  listingText: string
  jobTitle: string | null
  company: string | null
  fit: FitReport | null // homelab-services schema (doc 01 §E); types flow through the homelab-api typed client
  contentPatch: string | null // re-encoded from the decoded response via the shared codec (§D step 5)
  baseVersion: string
  meta: TailorMeta | null
  error: string | null
}
export interface TailorState {
  entries: ReadonlyArray<TailorEntry>
  detailEntryId: string | null
}
```

**Slice reducers** (`slice.ts`):

- `submitStarted({ id, listingText, baseVersion })`: unshift pending entry (all response fields null). Cap/prune (50 newest) is applied by `TailorEntryStoreService` at persist time (D8) — the slice stays thin
- `submitSucceeded({ id, response })`: find entry by id, fill `jobTitle/company/fit/contentPatch/meta`, set `status = meta.degraded ? "degraded" : "success"`, clear `error`
- `submitFailed({ id, error })`: find entry, set `status="error"`, `error` message
- `removeEntry(id)`: filter entries, if `detailEntryId === id` set to null
- `openDetail(id)` / `closeDetail()`: set/clear `detailEntryId`
- `hydrate(state)`: replace entire state (for localStorage restore)

**Hooks** (`hooks.ts`):

- `useTailorEntries()`: select `state.tailor.entries`
- `useTailorDetail()`: select `state.tailor.entries.find(e => e.id === state.tailor.detailEntryId)`
- `useSubmitTailor()`: returns `submitTailor(listingText: string)` thunk
- `useCanTailorResume()`: mirror `useCanPrintResume` with `RESUME_TAILOR_ROLE`

**Store registration** (`store.ts` line 14–18): add `tailor: tailorReducer` to reducer map.

**Purity (D8 — tested outside the resume app)**: `PersistedPrintConfig` is a closed struct and cannot carry tailor data; a schema-level test in `packages/shared` asserts the encoded `PersistedPrintConfig` key set never contains `fit|tips|verdict|listingText|jobTitle|contentPatch` (added to doc 01's test plan).

### C. Entry Persistence — `TailorEntryStoreService` (D8, NEW package)

**NEW workspace `packages/homelab-services-browser`** — scaffold modeled on `homelab-services-node` (package.json: name `homelab-services-browser`, deps `effect`, `shared`, `homelab-services`; tsconfig; `vitest.config.ts` merging `../../vitest.shared.js`; `src/index.ts` barrel + `src/layers/`). Purpose: browser-runtime implementations of runtime-agnostic contracts + their tests — the mitigation for resume having no test infra (owner directive, D8). Adding the workspace changes `yarn.lock` → refresh `fetchYarnBerryDeps` hashes per the `nix-hashes` skill.

**Contract** — `homelab-services/src/services/tailor-entry-store-service.ts` (house pattern: Id const + `DataTaggedError` + Def interface + `Context.Service` class + `Effect.fn` accessor):

```ts
interface TailorEntryStoreServiceDef {
  readonly load: () => Effect.Effect<ReadonlyArray<TailorEntry>, TailorEntryStoreError>
  readonly save: (entries: ReadonlyArray<TailorEntry>) => Effect.Effect<void, TailorEntryStoreError>
}
```

The `TailorEntry` type + envelope schema `{ version: 1, entries }` live in `homelab-services` beside the contract (referencing `FitReport`/`TailorMeta` from doc 01 §E), plus pure `pruneEntries(entries, cap = 50)` exported alongside.

**Implementation** — `homelab-services-browser/src/layers/tailor-entry-store-service.ts` over an injected minimal storage port (`interface WebStoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }` — SOLID: no direct `window.localStorage` dependency; resume passes the real thing at composition, tests inject an in-memory stub → no jsdom). Key constant `TAILOR_LISTINGS_LOCAL_STORAGE_KEY = "https://resume.rae-hill.dev__tailor-listings"` lives with the implementation. Decode failure → empty list + warn (versioned envelope, unlike the unversioned print-config codec).

**Tests (services-browser)**: envelope roundtrip; corrupt data → empty; cap prune keeps newest 50.

**Provider wiring (resume)**: fold into `PrintConfigProvider` (`provider.tsx` `useEffect`): hydrate tailor via the service on mount, `store.subscribe` write-through via `save(pruneEntries(entries))`, combined unsubscribe. Service composition runtime: `src/state/services.ts` composing the browser layers (pattern: the Effect runtime in `src/state/homelab/runtime.ts`).

### D. Auto-Apply Flow (D1)

**Request** (`src/state/homelab/tailor.ts`): mirror `requestResumePdf` pattern exactly. `requestTailor(listing, content, baseVersion): Effect<TailorResponse, NotSignedInError | TailorRequestError>` using `client.resume.tailor({ payload: { listing, content, baseVersion }, headers: { authorization } })`.

**Auto-apply thunk** (`submitTailor(listingText)`):

1. **Generate entry**: `id = crypto.randomUUID()`, `baseVersion = CONTENT_DEFAULTS_VERSION`, `createdAt = Date.now()`
2. **Dispatch `submitStarted`**: creates pending entry in slice
3. **Pass current content TYPED**: `client.resume.tailor`'s payload codec (`ContentPatchBase64`, doc 01 §D) encodes `ContentState` → base64 patch at the HttpApi edge — no manual encoding (doc 03 §"Patch codec ⇒ who decodes")
4. **Call `requestTailor`**: POST to `/resume/tailor`
5. **On success**:
   - **Pre-save preset**: generate name via `generatePresetName(jobTitle)` → `"Pre-tailor: <jobTitle> — <YYYY-MM-DD HH:mm>"`, then `PresetSnapshotService.save(name, currentConfigBase64, { onCollision: "suffix" })` (D8 — plain service call, not a hook; the suffix mode never clobbers an earlier snapshot, while the DEFAULT `"overwrite"` preserves legacy manual-save behavior in PresetsPanel).
   - **Apply tailored content**: the response `content` arrives ALREADY DECODED to `ContentState` (edge codec); if `!meta.degraded`, dispatch `printConfigActions.applyTailoredContent(response.content)`. For entry storage, re-encode: `contentPatch = Schema.encodeSync(ContentPatchBase64)(response.content)` (deterministic — base64 lives only on the wire and in localStorage)
   - **Dispatch `submitSucceeded`**: fills entry with response data
   - **Toast**: "Content applied. Snapshot saved as '{presetName}'." (or "Degraded response — content unchanged" if degraded)
6. **On error**: find pending entry by id, dispatch `submitFailed({ id, error })`, toast error message

**Preset naming logic** (`generatePresetName(jobTitle: string | null): string`):

```ts
const title = jobTitle ?? "Untitled"
const now = new Date()
const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
const time = now.toISOString().slice(11, 16).replace(":", "-") // HH-mm
return `Pre-tailor: ${title} — ${date} ${time}`
```

**Collision handling** (pure helper `resolveCollision(name, existingNames)` beside the contract):

```ts
let finalName = name
let counter = 1
while (existingNames.includes(finalName)) {
  finalName = `${name} (${counter++})`
}
```

**`PresetSnapshotService` (D8)**: extract the preset logic out of `usePresets` (hooks.ts ~298–374) into a small self-contained service — contract `homelab-services/src/services/preset-snapshot-service.ts` (`list/save/recall/remove` over the base64 record; `save(name, base64, { onCollision })` with `"overwrite"` default = legacy behavior and `"suffix"` opt-in for pre-tailor snapshots; "Default" rejection preserved), pure helpers (`generatePresetName(jobTitle, now)`, `resolveCollision`) exported beside the contract; browser impl in `homelab-services-browser` over the same `WebStoragePort`; `usePresets()` becomes a thin hook wrapping the service so `PresetsPanel` behavior is unchanged. The auto-apply thunk calls the service through the composed Effect runtime (`src/state/services.ts`) — no React context needed. **Tests (services-browser)**: naming format, collision suffixing, overwrite default, "Default" rejection, save/recall roundtrip, legacy record compat.

**Degraded response**: skip pre-save + skip apply (content unchanged), badge entry "degraded", tips still viewable in the details modal. Toast: "Degraded response — content unchanged. Snapshot NOT saved."

**Error handling**: badge entry "error", toast error message, Retry button in UI re-submits stored `listingText`. On baseVersion mismatch 4xx: detect via error message containing "version" or status code 400, surface "Resume content version changed — re-tailor".

### E. Details Modal (D7)

**Regular over-screen Chakra Dialog** layered over the settings bottom sheet — owner decision
(2026-11-07): no right-drawer positioning for now. (Verified fact kept for a future drawer: the
Dialog recipe's `placement` union is `"center" | "top" | "bottom"` ONLY and `motionPreset` includes
`"slide-in-right"` — `node_modules/@chakra-ui/react/dist/types/styled-system/generated/recipes.gen.d.ts:653–659`;
a right drawer would need Positioner slot overrides.)

**Design**: `Dialog.Root` (default center placement) + `Dialog.Content size="xl"` with
`scrollBehavior="inside"` — the same idioms the settings modal already uses. Chakra's portal, focus
trap, and Esc/backdrop handling come free.

**Stacking**: two portalled dialogs, last rendered = topmost. Render the details modal AFTER the settings dialog in the component tree. Manage focus: `closeOnEscape={false}` on outer when inner open, `closeOnOverlayClick={!detailOpen}`. Verify Esc closes inner first, then outer.

**Component structure** (`listing-detail-modal.tsx`):

- `Dialog.Root` `open={detailEntryId !== null}` (default center placement)
- `Dialog.Content size="xl"` (scrollable body via `scrollBehavior="inside"`)
- **Header**: jobTitle (fallback "Untitled listing"), company, createdAt formatted, verdict badge (strong/partial/weak coloring), degraded badge if applicable
- **Body** (scrollable):
  - Fit summary: 2-4 sentence prose from `fit.summary`
  - Keyword coverage: chips for `fit.keywordCoverage.matched` (green) vs `missing` (red/orange)
  - Tips list: grouped by severity (blocker → caution → info), each tip shows category label, title, detail, evidence excerpt styled as quote
  - Collapsible listing: expandable textarea showing full `listingText`
  - Meta footer: models used, tokens consumed, latency, cacheHit, promptVersion
- **Footer**: Delete button (red, calls `removeEntry`), "Apply to resume" button (teal, calls `handleRecall`)

**Recall action** (`handleRecall(entry)`): same flow as auto-apply success path:

1. Pre-save current config as preset (generate name, handle collisions)
2. Decode `entry.contentPatch` via the shared `ContentPatchBase64` codec. Stale-base guard: if `entry.baseVersion !== CONTENT_DEFAULTS_VERSION`, resolve through doc 01 §B's frozen-base registry (migrate forward); unknown version or decode failure → toast "Stale entry — re-tailor" + badge, no apply
3. Dispatch `applyTailoredContent(content)`
4. Toast: "Content applied from '{jobTitle}'. Snapshot saved as '{presetName}'."

No confirm dialog — user explicitly clicked Apply, so always pre-save + apply.

### F. Listings List

**Component** (`listing-list.tsx`): reverse-chron rows, empty state "No listings yet. Paste a job listing above to get started."

**Row** (`listing-row.tsx`): HStack with jobTitle (or "Pending…"/"Failed"), company, date, verdict badge, status badge, click → `openDetail`.

### G. Blurb/AboutMe

**Wire to state**: `heading.tsx` line 131 `{BLURB}` → `{content.blurb}` (select via `useContent()`). `about-me.tsx` lines 6–11 → `{content.aboutMe}`.

**Editing UI**: in Heading tab after `HeadingControls`, add textareas for blurb/AboutMe when `editingEnabled`. Dispatch `setContent({ ...content, blurb/AboutMe })` or add dedicated reducers.

### H. State Movement

Doc 01 moves `content-defaults.ts` to shared as `INITIAL_CONTENT_STATE` + `CONTENT_DEFAULTS_VERSION`. Update `types.ts` line 10: `import { INITIAL_CONTENT_STATE as initialContentState } from "shared"`. Grep: confirm nothing else imports `content-defaults`.

## File-by-File Changes

### New files

- **`packages/homelab-services-browser/`** (NEW workspace, D8): `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/web-storage-port.ts`, `src/layers/{tailor-entry-store-service.ts, preset-snapshot-service.ts}`, `test/{tailor-entry-store, preset-snapshot}.test.ts`
- `packages/homelab-services/src/services/{tailor-entry-store-service.ts, preset-snapshot-service.ts}` + barrel entries (+ `TailorEntry`/envelope schema + pure `pruneEntries`/`generatePresetName`/`resolveCollision` helpers beside the contracts)
- `src/state/tailor/{types.ts, slice.ts, hooks.ts, index.ts}` (THIN — no persistence.ts; the store service owns it)
- `src/state/services.ts` (compose browser layers → managed runtime for thunks; pattern: `state/homelab/runtime.ts`)
- `src/state/homelab/tailor.ts` (requestTailor + errors)
- `src/components/tailoring/{tailoring-tab, listing-list, listing-row, listing-detail-modal, verdict-badge, status-badge, fit-summary, keyword-coverage, tips-list, collapsible-listing, meta-footer}.tsx`

### Modified files

- `src/state/print-config/store.ts`: add `tailor: tailorReducer`
- `src/state/print-config/slice.ts`: add `applyTailoredContent` reducer
- `src/state/print-config/hooks.ts`: `usePresets` becomes a thin wrapper over `PresetSnapshotService` (D8)
- `src/state/print-config/provider.tsx`: tailor hydration + write-through via `TailorEntryStoreService`
- `src/state/print-config/types.ts`: re-export `INITIAL_CONTENT_STATE` from shared
- `src/components/print-config-fab.tsx`: add `"tailoring"` to `TABS`, add Trigger + Content; render `ListingDetailModal` after the settings dialog
- `src/components/resume/sections/heading.tsx`: `{BLURB}` → `{content.blurb}`
- `src/components/resume/sections/about-me.tsx`: hard-coded → `{content.aboutMe}`
- `src/state/homelab/hooks.ts`: add `useCanTailorResume`
- resume `package.json`: add `homelab-services` + `homelab-services-browser` workspace deps (NO `test` script in v1 — D8)
- root `yarn.lock` (new workspace) → `fetchYarnBerryDeps` hash refresh per `nix-hashes` skill

## Task Breakdown

### T7 — `homelab-services-browser` Package + Services + Tailor Slice

**Scope**: B + C + the D8 scaffold. Create `packages/homelab-services-browser` (model: `homelab-services-node`); contracts + pure helpers in `homelab-services` (`TailorEntryStoreService`, `PresetSnapshotService`, envelope schema, prune/naming/collision); browser impls over `WebStoragePort`; refactor `usePresets` to a thin wrapper; create the thin `src/state/tailor/` slice + store registration; provider hydration/write-through via the services; `src/state/services.ts` composition runtime.

**Done**:

- services-browser vitest green: envelope roundtrip, corrupt data → empty, cap prune; preset naming/collision/"Default"-rejection/save-recall roundtrip
- shared purity test (encoded `PersistedPrintConfig` keys contain no tailor data)
- slice compiles + registered; hydration/write-through verified manually (no resume test infra in v1 — D8)
- `yarn.lock` updated + `fetchYarnBerryDeps` hashes refreshed (nix-hashes skill)
- Tree green: `yarn lint && yarn typecheck && yarn test`

### T8 — Tailoring Tab + Details Modal + Auto-Apply

**Scope**: A + D + E + F + G. Add `"tailoring"` tab, build `TailoringTab`, implement `requestTailor`, auto-apply thunk, build `ListingDetailModal`, wire blurb/AboutMe + editing UI.

**Done**:

- `useCanTailorResume` gates submission
- Submit: dispatch `submitStarted` → POST → pre-save preset, dispatch `applyTailoredContent`, dispatch `submitSucceeded`, toast
- Degraded: skip pre-save + apply, badge "degraded", tips viewable
- Error: badge error, toast, Retry
- baseVersion 4xx: "Resume content version changed — re-tailor"
- Details modal: click row → opens over the settings modal, shows jobTitle/company/date/verdict/degraded/fit/keywords/tips/listing/meta, "Apply to resume" + "Delete"
- Blurb/AboutMe read from state; editing UI in Heading tab
- Tree green: `yarn lint && yarn typecheck && yarn test`

## Test Plan

**Tooling (D8)**: NO vitest added to `packages/resume` in v1 — testable logic lives in `homelab-services-browser` (services + pure helpers), `shared` (codec/purity, doc 01), and `homelab-server`/e2e (doc 03). UI behavior = manual checks now; Cypress browser e2e is a noted backlog item (doc 03).

**Tests**:

- services-browser: `tailor-entry-store.test.ts` (envelope roundtrip, corrupt → empty, cap prune), `preset-snapshot.test.ts` (naming format, collision suffixing, "Default" rejection, save/recall roundtrip) — in-memory `WebStoragePort` stub, no jsdom
- shared: print-purity (encoded `PersistedPrintConfig` contains no tailor keys) + doc 01's codec tests
- `applyTailoredContent` reducer is a one-line Immer assignment — covered by the type system + manual checks (add resume vitest if the slice ever grows real logic)

## Open Questions

1. **Nested-dialog stacking/focus**: the details view is a regular centered Dialog (D7 — no drawer positioning). Remaining: Esc/backdrop/focus behavior with two portalled Dialogs stacked (bottom sheet + details). **Owner**: T8 implementer.

2. **Entry cap**: 50 newest (~1MB). V1 simple; doc 06 owns DB migration. **Owner**: T7 implementer.

3. **Evidence highlighting**: tips include `evidence` (verbatim quote). Nice-to-have: click → highlight in listing. V1 optional. **Owner**: T8 implementer.

4. **"Update entry from current content"**: README OQ4. V1 does NOT implement; "Apply to resume" always applies stored patch. **Owner**: doc 06.

5. ~~**Test tooling**~~ — **RESOLVED (D8)**: tests live in `homelab-services-browser` + `shared`; no resume test infra in v1. Cypress later (doc 03 backlog).

## Cross-References

- **Doc 01**: content schemas + `INITIAL_CONTENT_STATE` + `CONTENT_DEFAULTS_VERSION` + `ContentPatchBase64` codec in shared; wire contract shapes; consumer migration.
- **Doc 02**: `TailorService` + OpenRouter; prompts; validation; degraded fallback; evals (cache deferred, D9). Server truncates at ~20k. Its §B small-service composition is the pattern this doc's browser services mirror (D8).
- **Doc 03**: `POST /resume/tailor` endpoint + handler + authz + tests. Returns 4xx on baseVersion mismatch.
- **Doc 05**: sops key; env template; kanidm role `Resume_Tailor`; `Constants.RESUME_TAILOR_ROLE`.
- **Doc 06**: Postgres persistence; redis cache; migration off localStorage; seams v1 preserves (stable ids, `listingHash`, `baseVersion`, `meta`).
