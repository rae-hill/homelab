# 04 — Frontend: Actions Tab + Cover-Letter Download

Covers CL-T7. App: `packages/resume` (React 18 + RTK + Chakra v3 + TanStack Router). Scope is
deliberately small (CL-D11): one new tab in the existing details modal, one request/download
Effect pair, one role hook. **No new redux slice, no new localStorage keys** — the entry already
stores everything the request needs (`listing`, `contentPatch`, `baseVersion`).

Load the `frontend`-adjacent conventions from the live files, not from memory; the patterns below
name their exact precedents.

## A) Role plumbing

- `packages/shared/src/constants.ts`: add `RESUME_COVER_LETTER_ROLE = "Resume_CoverLetter"`
  (beside `RESUME_PRINT_ROLE` / `RESUME_TAILOR_ROLE`).
- `packages/resume/src/state/homelab/hooks.ts`: add `useCanCoverLetter()` — exact mirror of
  `useCanTailorResume()` keyed on the new role constant.

## B) Request + download — `packages/resume/src/state/homelab/cover-letter.ts`

Mirror `print.ts` (`requestResumeDocument` / `downloadResumeDocument`) structure-for-structure:

```ts
export class CoverLetterRequestError extends Data.TaggedError("CoverLetterRequestError")<{
  readonly reason: "transport" | "server"
  readonly error: unknown
}> {}

/** Effect program — run at the React boundary with Effect.runPromise (print.ts idiom). */
export const requestCoverLetter = (
  listing: string,
  content: ResumeContent.ContentState,   // DECODED entry patch — the edge codec re-encodes it
  baseVersion: string,
): Effect.Effect<Uint8Array, NotSignedInError | CoverLetterRequestError> =>
  /* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: homelabEnv.apiUrl })
     → client.resume["cover-letter"]({
         payload: { listing, content, baseVersion },
         headers: { authorization: `Bearer ${idToken}` },   // authLayer() as in print.ts/tailor.ts
       }) */

export const downloadCoverLetter = (
  bytes: Uint8Array,
  jobTitle: string,
): Effect.Effect<void, never> =>
  /* Blob([bytes], { type: "application/pdf" }) → URL.createObjectURL → anchor
     download = `cover-letter-${slugify(jobTitle)}-${YYYY-MM-DD}.pdf` → click → revoke
     (downloadResumeDocument's exact mechanics) */
```

Notes:

- The typed client's payload codec expects `ContentState` and encodes to the base64 patch on the
  wire (same as `requestTailor`) — so the caller DECODES `entry.contentPatch` first (below).
- Errors: map `ApiErrors.BadRequest` reasons (`…quota-exceeded`, `…base-version-mismatch`) to
  distinct toast copy; everything else → generic "Couldn't generate the cover letter".

## C) Entry → request glue — `useDownloadCoverLetter(entry)` in `packages/resume/src/state/tailor/hooks.ts`

Follows `useApplyEntry`'s decode + stale-guard mechanics:

1. Stale guard: `entry.baseVersion !== ResumeContent.CONTENT_DEFAULTS_VERSION` → toast
   "Stale entry — re-tailor this listing first" (same copy family as apply), no request.
2. Decode: `Schema.decodeUnknownSync(ResumeContent.ContentPatchBase64)(entry.contentPatch)`
   (wrapped in try/catch → error toast on decode failure).
3. Local state: `busy: boolean` + `elapsed: number` (1 s interval, the tailoring-tab
   `Working… ${elapsed}s` idiom) — component-local `useState`, NOT redux (CL-D11).
4. Run `Effect.runPromise(requestCoverLetter(entry.listing, decoded, entry.baseVersion).pipe(
   Effect.provide(authLayer())))` → `downloadCoverLetter(bytes, entry.jobTitle)` →
   toaster success "Cover letter ready"; failure → toaster error with reason-specific copy.
   (`entry.listing` / `entry.jobTitle` field names: verify against `TailorEntrySchema` at impl.)

## D) Actions tab — `packages/resume/src/components/tailoring/actions-tab.tsx` (NEW)

Inserted into `listing-detail-modal.tsx`: third `Tabs.Trigger value="actions"` (label "Actions",
icon `LuSparkles` or `LuFileDown` — sibling of the Summary/Changes triggers in the same
`Tabs.List`) + `Tabs.Content value="actions"` rendering `<ActionsTab entry={entry} />`.
The details modal keeps its local `useState("summary")` tab control — no URL-param work.

`ActionsTab` layout (Chakra v3 tokens per the house palette — teal primary, `fg.muted` secondary
text, `bg.panel`/`bg.surface` surfaces):

```
┌───────────────────────────────────────────────────────────┐
│ ✨ Cover letter                                            │  Heading size md, fontWeight semibold
│ Generate a letter in your voice for this listing, matched  │  Text textStyle sm, fg.muted
│ to the tailored resume in this entry. Takes ~15–45 s.      │
│                                                            │
│ ┌───────────────────────────────────────────────────────┐ │
│ │  [⬇ Download cover letter]      Working… 12s           │ │  Button colorPalette teal, size lg,
│ └───────────────────────────────────────────────────────┘ │  w-full on mobile; spinner + elapsed
│                                                            │  while busy (tailor-submit idiom)
│ Requires the Resume_CoverLetter role.                      │  orange hint, tailoring-tab copy style,
│                                                            │  when !useCanCoverLetter()
└───────────────────────────────────────────────────────────┘
```

Enable/disable rules (mirror the Apply button's gating):

- disabled unless `entry.status === "success" || entry.status === "degraded"` AND
  `entry.contentPatch !== null` (degraded entries allowed — README OQ4 default) AND not `busy`;
- disabled + orange role hint when `!useCanCoverLetter()`;
- stale `baseVersion`: button stays enabled, the hook's guard toasts the explanation (same UX as
  apply — one source of truth for staleness copy).

Keep the tab honest about cost/latency: the helper line mentions the wait; the elapsed timer
covers the two-LLM-call + render pipeline. No progress stages (bytes-only response, CL-D1).

## E) Tests

`packages/resume` has no test infra (D8 of the tailor harness) — logic lives where it's testable:

- The request/download/glue code is thin Effect wiring over precedents that are already untested
  in-app; the **server-side** contract is covered by doc 03's unit + e2e suites.
- `homelab-services-browser` gains nothing (no new store) — confirm no accidental imports.
- Manual verification steps recorded in the PR: tailor a listing → open entry → Actions →
  download → open PDF; second click after server restart (cache cold) vs warm (cache hit latency).

## Cross-references

- **Doc 03** — wire contract the client consumes (`client.resume["cover-letter"]`).
- **`state/homelab/print.ts`** — download mechanics precedent (blob → anchor → revoke).
- **`state/tailor/hooks.ts` (`useApplyEntry`)** — decode + stale-guard precedent.
- **`components/tailoring/listing-detail-modal.tsx`** — insertion point (Tabs.List ~lines 82–128).
