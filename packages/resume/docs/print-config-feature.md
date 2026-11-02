# Print Configuration Feature — Planning Document

## Goal

Add a floating action button (FAB) in the **bottom-left** of the screen — styled like the
existing effects FAB (cherry blossoms / confetti, bottom-right) — that opens a **modal**
containing toggle switches and one segmented control. These control whether particular
resume elements are included when the page is **printed**. The purpose is to let the owner
experiment with different resume print configurations before exporting to PDF.

The controls (FAB + modal) must themselves **never** appear in print output
(`@media print { display: none }`), matching how `EffectsFab` already hides itself. The
modal also includes a **Print** button that triggers the browser print dialog
(`window.print()`).

## Confirmed decisions

1. **Defaults: all-on.** Every toggle starts enabled; the segmented `Featured` control
   starts at `Inline`.
2. **Controls affect print only**, never on-screen rendering. On screen, the resume shows
   everything **except** the inline header education/certification lines (those are
   print-only and are what the Education/Certification toggles + Featured mode drive).
3. **Separate project-tags toggle** in addition to position (experience) tags.
4. **Persistence**: yes — persist the whole print-config state to `localStorage`
   (SSR-safe), mirroring the effects FAB pattern.
5. **FAB bottom-left**, options in a modal popup, plus a submit-style **Print** button in
   the modal that calls `window.print()`.
6. **Chakra `Switch`** for booleans; **Chakra `SegmentGroup`** (segmented control) for the
   Featured Inline/External choice.

## Controls (initial set)

### Boolean toggles (Chakra `Switch`)

| Label                          | Controls (rendered element, in print)                                | Source file                                                   |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Show Position Description      | The italic `<em>{description}</em>` line under each experience entry | `src/components/resume/sections/experience.tsx`               |
| Show Position Responsibilities | The `bulletPoints` `List.Root` under each experience entry           | `src/components/resume/sections/experience.tsx`               |
| Show Tag Cloud                 | The `TagCloud` section                                               | `src/components/resume/sections/tag-cloud.tsx`                |
| Show Position Tags             | The per-experience tag `HStack` (tech pills)                         | `src/components/resume/sections/experience.tsx`               |
| Show Project Tags              | The per-project tag `HStack`                                         | `src/components/resume/sections/projects.tsx`                 |
| Show Certification             | Print-only certification line (see Featured mode below)              | `src/components/resume/sections/heading.tsx` / `featured.tsx` |
| Show Education                 | Print-only education line (see Featured mode below)                  | `src/components/resume/sections/heading.tsx` / `featured.tsx` |

### Segmented control (Chakra `SegmentGroup`)

| Label         | Options               | Meaning                                          |
| ------------- | --------------------- | ------------------------------------------------ |
| Show Featured | `Inline` / `External` | How Education/Certification render **in print**: |

- **Inline** (default): the condensed education/certification lines live in the header
  (as the current print-only education line does in `heading.tsx`). We add a parallel
  certification line. The `Show Education` / `Show Certification` toggles gate each line.
- **External**: the `Featured` boxes (`featured.tsx`) — currently screen-only — are
  revealed in print instead, and the inline header lines are suppressed. The
  `Show Education` / `Show Certification` toggles gate the corresponding box.

So in print the effective rule for education/certification is:
`featuredMode === 'Inline'` → header line (gated by toggle); `=== 'External'` → featured
box (gated by toggle). On screen, neither inline line shows (screen keeps current look);
the featured boxes remain screen-visible as today.

## State architecture

A new global state pattern via **React Context** backed by **`useReducer`** in a
Redux-style action-dispatch pattern. (`useReducer` exists in React 18.)

### Files to add

```
src/
├── state/                                   # NEW directory for global state
│   └── print-config/
│       ├── types.ts        # state shape, literal unions, tagged-union action type
│       ├── reducer.ts      # printConfigReducer(state, action): PrintConfigState
│       ├── context.tsx     # PrintConfigProvider + context (persisted via useLocalStorage)
│       └── index.ts        # barrel
├── hooks/
│   └── usePrintConfig.ts   # public hook: current state + typed dispatch methods
├── constants/
│   └── print-config.constants.ts  # localStorage key constant
└── components/
    ├── print-config-fab.tsx        # the FAB + modal (Dialog) container
    └── chakra/
        ├── dialog.tsx              # thin wrapper (optional, for defaults/portalling)
        └── switch.tsx              # thin wrapper (optional)
```

### Types — tagged union with **action-specific payloads**

Per your guidance, actions are a discriminated union where **each variant carries only the
data relevant to it** (not a shared bag of booleans). This is what lets a future action
like `SetTagLayout` carry `alignment: 'left' | 'center' | 'right'`.

```ts
// --- literal unions (extensible) ---

export type PrintToggleKey =
  | "positionDescription"
  | "positionResponsibilities"
  | "tagCloud"
  | "positionTags"
  | "projectTags"
  | "certification"
  | "education"

export type FeaturedMode = "Inline" | "External"

// Illustrative future literal union referenced by a future action variant:
// export type TagAlignment = 'left' | 'center' | 'right'

// --- state shape ---

export interface PrintConfigState {
  readonly toggles: Readonly<Record<PrintToggleKey, boolean>>
  readonly featuredMode: FeaturedMode
  // Future: readonly tagAlignment: TagAlignment
}

// --- tagged-union actions: each variant has its own payload fields ---

export type PrintConfigAction =
  | { readonly type: "ToggleOption"; readonly key: PrintToggleKey }
  | { readonly type: "SetOption"; readonly key: PrintToggleKey; readonly value: boolean }
  | { readonly type: "SetFeaturedMode"; readonly mode: FeaturedMode }
  | { readonly type: "Reset" }
// Example of a future action variant carrying action-specific options:
// | { readonly type: 'SetTagLayout'; readonly alignment: TagAlignment }

export const initialPrintConfigState: PrintConfigState = {
  toggles: {
    positionDescription: true,
    positionResponsibilities: true,
    tagCloud: true,
    positionTags: true,
    projectTags: true,
    certification: true,
    education: true,
  },
  featuredMode: "Inline",
}
```

### Reducer

Pure `printConfigReducer(state, action)` with an exhaustive `switch (action.type)` and a
`never`-typed default branch (satisfies `noFallthroughCasesInSwitch` and forces every new
action variant to be handled):

- `ToggleOption` → flip `toggles[action.key]`.
- `SetOption` → set `toggles[action.key] = action.value`.
- `SetFeaturedMode` → set `featuredMode = action.mode`.
- `Reset` → return `initialPrintConfigState`.

### Context + Provider + persistence

- Single context value `{ state, dispatch }` (the public hook hides `dispatch`).
- `PrintConfigProvider` uses `useReducer(printConfigReducer, initialPrintConfigState)`.
- **Persistence**: use the existing SSR-safe `useLocalStorage` with
  `PRINT_CONFIG_LOCAL_STORAGE_KEY`. Approach: hydrate the reducer's initial state from
  localStorage (lazy init), and write the serialized state back on every change via an
  effect. `useLocalStorage` stores strings, so we JSON-serialize the `PrintConfigState`.
  Guard parse failures (fall back to `initialPrintConfigState`). No `window`/`localStorage`
  access at module top level — all inside the provider/effects.
- Mounted in `src/theme/Root.tsx` inside the provider stack (wrapping `{children}` and the
  FABs) so both the FAB and resume sections read the same store.

### Public hook: `usePrintConfig()`

Exposes current state plus strongly-typed methods that **dispatch the tagged-union actions
internally** (callers never touch `dispatch`):

```ts
interface UsePrintConfig {
  readonly toggles: Readonly<Record<PrintToggleKey, boolean>>
  readonly featuredMode: FeaturedMode
  readonly isEnabled: (key: PrintToggleKey) => boolean
  readonly toggleOption: (key: PrintToggleKey) => void // → { type: 'ToggleOption', key }
  readonly setOption: (key: PrintToggleKey, value: boolean) => void // → { type: 'SetOption', ... }
  readonly setFeaturedMode: (mode: FeaturedMode) => void // → { type: 'SetFeaturedMode', mode }
  readonly reset: () => void // → { type: 'Reset' }
}
```

## Wiring the controls into print CSS

Each controlled element gets an `@media print` rule whose `display` is derived from the
relevant toggle / featured mode. On-screen styles are untouched (print-only effect).

- `experience.tsx`: description `<em>`, `bulletPoints` list, experience tags `HStack` each
  read `toggles.positionDescription` / `.positionResponsibilities` / `.positionTags`.
  The `bulletPoints` list print rule is driven **solely** by
  `toggles.positionResponsibilities` (ON → shown, OFF → `display: none`).
- `projects.tsx`: project tags `HStack` reads `toggles.projectTags`.
- `tag-cloud.tsx`: `TagCloud` wrapper reads `toggles.tagCloud` (add an `@media print`
  display rule — none exists today).
- `heading.tsx`: existing print-only education line gated by
  `featuredMode === 'Inline' && toggles.education`; add parallel certification line gated
  by `featuredMode === 'Inline' && toggles.certification`.
- `featured.tsx`: the featured boxes become print-visible only when
  `featuredMode === 'External'`, each box gated by its toggle
  (`education` / `certification`). Screen behavior unchanged.

Because these are already Chakra components using the Emotion `css` prop with `@media
print` blocks, each change is localized — no structural refactor.

## FAB + modal UI (`print-config-fab.tsx`)

- Chakra `IconButton`, `position="fixed"`, `rounded="full"`, `size="xl"`, `shadow="lg"`,
  `zIndex="docked"`, `@media print { display: none }` — mirroring `EffectsFab`.
- Placement: bottom-left → `left={[10,10,16]}` `bottom={[8,8,14]}` (effects FAB stays
  bottom-right), so they don't overlap.
- Icon: `AiOutlinePrinter` from `react-icons/ai`.
- Clicking opens a Chakra v3 **`Dialog`** (`Dialog.Root` controlled by local `open` state;
  `Backdrop` → `Positioner` → `Content` → `Header`/`Title`, `Body`, `Footer`).
- Body:
  - One `Switch.Root` (`checked` + `onCheckedChange`) per boolean `PrintToggleKey`, with
    `Switch.HiddenInput`, `Switch.Control` (default thumb), `Switch.Label` (human label).
  - One `SegmentGroup.Root` (`value` + `onValueChange`) for Featured with
    `SegmentGroup.Indicator` + `SegmentGroup.Items items={['Inline','External']}`.
- Footer:
  - A **Reset** `Button` (dispatches `Reset`).
  - A submit-style **Print** `Button` (`colorPalette` accent) that calls `window.print()`
    (guarded for SSR; it's a click handler so window exists). Optionally close the modal
    first so controls aren't in the print snapshot — though `@media print { display:none }`
    already hides them.

### Chakra v3 API confirmation (from `repos/chakra-ui` subtree)

- `Switch`: `Switch.Root` accepts `checked` + `onCheckedChange(details)` where
  `details: Switch.CheckedChangeDetails` (`{ checked: boolean }`); parts `Root`,
  `HiddenInput`, `Control` (defaults to rendering `Thumb`), `Label`.
- `SegmentGroup` (the segmented control): `Root` accepts `value` + `onValueChange(details)`
  (`ValueChangeDetails` → `{ value: string }`); parts `Indicator`, `Items` (convenience
  `items={[...]}`), or `Item`/`ItemText`/`ItemHiddenInput`.
- `Dialog`: parts `Root` (`open`/`onOpenChange`), `Backdrop`, `Positioner`, `Content`,
  `Header`, `Title`, `Body`, `Footer`, `CloseTrigger`, `ActionTrigger`.

## Component/provider ordering

- Add `PrintConfigProvider` in `src/theme/Root.tsx` wrapping `{children}` and the FABs,
  inside `ThemeProvider`, preserving documented provider ordering.
- Render `<PrintConfigFab />` alongside `<EffectsFab />`.

## Conventions to honor

- Prettier: single quotes, no semicolons, trailing commas, `printWidth: 90`,
  `arrowParens: 'avoid'`, experimental ternaries allowed.
- TS strict + no-unused + `noImplicitReturns` + `noFallthroughCasesInSwitch`
  (exhaustive reducer with `never` guard).
- SSR-safe: guard `window`/`document`/`localStorage`; use `useLocalStorage`.
- Export a `*Props` interface for the FAB/modal components.
- localStorage key as a constant in `src/constants/`.
- Keep print fidelity; use `@media print` blocks.

## Build / validation plan

- `yarn typecheck` — introduce no new errors beyond the documented baseline
  (`open-source.tsx` `spacing`, `index.tsx` unused `Icon`, `emotion.ts` ×2).
- `yarn build` — must succeed (`onBrokenLinks: 'throw'`).
- Manual: FAB bottom-left on screen, switches + segmented control work and persist across
  reload, Print button opens the print dialog, and print preview reflects each toggle /
  featured mode while the FAB/modal are absent in print.

## Implementation checklist (ordered)

1. `src/state/print-config/types.ts` — literal unions, `PrintConfigState`,
   tagged-union `PrintConfigAction`, `initialPrintConfigState`.
2. `src/state/print-config/reducer.ts` — pure reducer, exhaustive switch + `never` guard.
3. `src/constants/print-config.constants.ts` — `PRINT_CONFIG_LOCAL_STORAGE_KEY`.
4. `src/state/print-config/context.tsx` — provider with `useReducer` + localStorage
   hydration/persistence.
5. `src/state/print-config/index.ts` — barrel.
6. `src/hooks/usePrintConfig.ts` — public hook with typed dispatch methods.
7. `src/components/chakra/dialog.tsx` + `switch.tsx` — optional thin wrappers.
8. `src/components/print-config-fab.tsx` — FAB + Dialog (switches, segmented control,
   Reset, Print).
9. Mount provider + FAB in `src/theme/Root.tsx`.
10. Wire controls into print CSS: `experience.tsx`, `projects.tsx`, `tag-cloud.tsx`,
    `heading.tsx`, `featured.tsx`.
11. Remove `printExpand` from `resume-data.ts` (interface + entries) and
    `experience.tsx` (destructure + list print rule).
12. `yarn typecheck` + `yarn build`; manual print-preview verification.

## Remaining minor confirmations

Resolved: FAB icon `AiOutlinePrinter`; state directory `src/state/`.

## Removal: `printExpand`

The existing `printExpand` field is being **removed entirely** in favor of this state.
Touch points (all removed/replaced during implementation):

- `src/components/resume/resume-data.ts` — remove `printExpand` from the `ExperienceEntry`
  interface and from all data entries that set it.
- `src/components/resume/sections/experience.tsx` — remove `printExpand` from the
  destructure; the `bulletPoints` list's print `display` is now driven only by
  `toggles.positionResponsibilities`.
