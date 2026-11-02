# Dynamic, Editable Resume Content — Implementation Plan

## Goal

Move the resume's **content** (experience entries, project entries) out of the static
`resume-data.ts` module and into the global print-config state so it is:

1. **Dynamic** — rendered from state; the current hard-coded data becomes the **Default**.
2. **Editable at runtime** — via a new **Content** subsection inside each of the existing
   **Experience** and **Projects** settings tabs (not one unified "Content" tab).

Editing supported per section:

- **Paragraph fields** (description) — plain `Textarea`.
- **Tags** — Chakra `TagsInput`, with the full pool of known tags displayed as the
  available options (shared across experience + projects).
- **Bullet points** (experience only) — a custom UI: an **Add** button plus a list of
  items, each row = a visibility **Checkbox** + an inline-`Editable` text + a **trash**
  delete button. Lives in its own sub-area of the Content subsection.

Out of scope (explicitly): section **headers** stay static ("Experience" / "Projects");
project **icon/iconColor** stay static (not serializable, not requested).

## State model (`src/state/print-config/types.ts`)

Content is plain, JSON-serializable data (no `IconType` in state).

```ts
export interface BulletPoint {
  readonly id: string // stable id for list keys + edits
  readonly text: string
  readonly visible: boolean // checkbox → render gate
}

export interface ExperienceContent {
  readonly id: string
  readonly company: string
  readonly location: string
  readonly roles: ReadonlyArray<{ readonly title: string; readonly date: string }>
  readonly description: string
  readonly bulletPoints: ReadonlyArray<BulletPoint>
  readonly tags: ReadonlyArray<string>
}

export interface ProjectContent {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly githubLink: string
  readonly tags: ReadonlyArray<string>
  // icon / iconColor NOT stored: derived statically at render time.
}

export interface ContentState {
  readonly experience: ReadonlyArray<ExperienceContent>
  readonly projects: ReadonlyArray<ProjectContent>
}
```

Add `content: ContentState` to `PrintConfigState`. The initial value is derived from the
existing `resume-data.ts` (the "Default"), with ids assigned and each existing
`bulletPoints` string mapped to `{ id, text, visible: true }`.

### Actions (tagged union, mirroring existing style)

Scope edits by `section` + entry `id` (+ bullet `id`) so each is minimal:

- `SetEntryDescription { section, id, description }`
- `SetEntryTags { section, id, tags }`
- `SetEntryText { section, id, field, value }` — for project `title` (future-proofed;
  used now only where a plain text field is editable). Headers stay static, so only the
  description/tags/bullets paths are wired to UI initially.
- Bullets (experience only):
  - `AddBullet { id }`
  - `SetBulletText { entryId, bulletId, text }`
  - `ToggleBulletVisible { entryId, bulletId }`
  - `RemoveBullet { entryId, bulletId }`
- `ResetContent` — handled by the existing global `Reset` (returns full initial state).

All handled in `reducer.ts` with exhaustive `never` default (compile-time safety).

## Persistence (`context.tsx`)

- Extend `parsePersisted` with a `parseContent` that validates each entry/bullet, merging
  over the default so malformed/legacy blobs can't break the UI (same pattern as
  `parseSection` / `parseHeading`).
- Hydration replay: dispatch content-restoring actions after sections/heading. Simplest
  robust approach — add a single `SetContent { content }` action used only by hydration
  to replace the whole slice at once (avoids replaying dozens of granular actions).

## Hook (`usePrintConfig.ts`)

Expose `content` plus typed setters: `setEntryDescription`, `setEntryTags`, `addBullet`,
`setBulletText`, `toggleBulletVisible`, `removeBullet`. Keep `useMemo` deps in sync.

## Tag pool

Export a stable `ALL_KNOWN_TAGS` (union of every category list in
`technologies-list.ts` plus any tag already present in default content), sorted. Feed it
as the `TagsInput` suggestion/available pool for both sections.

## Rendering (`sections/experience.tsx`, `sections/projects.tsx`)

- Read entries from `usePrintConfig().content.{experience|projects}` instead of importing
  `experiences` / `projects`.
- Experience bullets: render only `visible` bullets; keep the existing print toggle on
  `positionResponsibilities`.
- Projects: keep static `icon = githubIcon` / `SiTypescript` default + `techColor`.
- Everything else (layout/align/tagDisplay) already reads from state and is untouched.

## Settings UI (`print-config-fab.tsx`)

Within each of the **Experience** and **Projects** tab panels, add a **Content**
subsection (a titled region under the existing layout controls — e.g. a `Separator` +
heading, or Chakra `Accordion`), containing per-entry editors:

- `Textarea` for description.
- `TagsInput` seeded with `ALL_KNOWN_TAGS`.
- Experience only: the bullet editor (Add button + rows of Checkbox + Editable + trash).

## Verification

- `yarn typecheck` — introduce no new errors beyond the documented baseline.
- `yarn build` — succeeds, no broken links.
- Spot-check: default render matches the previous static resume; edits persist across
  reload; Reset restores defaults.

```
```
