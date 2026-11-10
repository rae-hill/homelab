import { Context, Data, Effect } from "effect"
import type { Option } from "effect"

export const PresetSnapshotServiceId = "homelab-api/services/tailor/PresetSnapshotService"

/* ---- Pure helpers --------------------------------------------------------------------------- */

/**
 * Resolve a naming collision by appending " (1)", " (2)", ... until a unique name is found.
 * Pure; does not mutate the input set.
 */
export const resolveCollision = (name: string, existingNames: Iterable<string>): string => {
  const existingSet = new Set(existingNames)
  if (!existingSet.has(name)) {
    return name
  }
  let counter = 1
  let candidate = `${name} (${counter})`
  while (existingSet.has(candidate)) {
    counter += 1
    candidate = `${name} (${counter})`
  }
  return candidate
}

/* ---- Error ---------------------------------------------------------------------------------- */

/** Raised when a preset snapshot operation fails (storage unavailable, name reserved). */
export class PresetSnapshotError extends Data.TaggedError("PresetSnapshotError")<{
  readonly message: string
  readonly error: unknown
}> {}

/* ---- Service -------------------------------------------------------------------------------- */

/**
 * Named snapshot storage for print configs (base64-encoded). The underlying format is a
 * plain JSON `Record<name, base64>` stored under the existing presets localStorage key —
 * backward-compatible with the pre-T7 `usePresets` hook. The built-in "Default" preset is
 * NOT stored here (it's the initial state, always available via Reset).
 */
export interface PresetSnapshotServiceDef {
  /** List all saved preset names (alphabetical order, excludes "Default"). */
  readonly list: () => Effect.Effect<ReadonlyArray<string>, PresetSnapshotError>
  /**
   * Save a preset under `name`; returns the final name written. Rejects empty names and the
   * reserved "Default" with a PresetSnapshotError. `onCollision: "overwrite"` (the DEFAULT —
   * legacy `usePresets` behavior) replaces an existing preset of the same name;
   * `onCollision: "suffix"` appends " (1)", " (2)", … — used by the pre-tailor snapshot flow,
   * which must never clobber an earlier snapshot.
   */
  readonly save: (
    name: string,
    configBase64: string,
    options?: { readonly onCollision?: "overwrite" | "suffix" },
  ) => Effect.Effect<string, PresetSnapshotError>
  /** Recall a preset by name. Returns None if not found. */
  readonly recall: (name: string) => Effect.Effect<Option.Option<string>, PresetSnapshotError>
  /** Remove a preset by name. No-op if not found. Rejects "Default". */
  readonly remove: (name: string) => Effect.Effect<void, PresetSnapshotError>
}

export class PresetSnapshotService
  extends Context.Service<PresetSnapshotService, PresetSnapshotServiceDef>()(PresetSnapshotServiceId)
{}

/** {@inheritDoc PresetSnapshotServiceDef.list} */
export const list = Effect.fn("PresetSnapshotService.list")(
  function*(): Effect.fn.Return<ReadonlyArray<string>, PresetSnapshotError, PresetSnapshotService> {
    const svc = yield* PresetSnapshotService
    return yield* svc.list()
  },
)

/** {@inheritDoc PresetSnapshotServiceDef.save} */
export const save = Effect.fn("PresetSnapshotService.save")(function*(
  ...params: Parameters<PresetSnapshotServiceDef["save"]>
): Effect.fn.Return<string, PresetSnapshotError, PresetSnapshotService> {
  const svc = yield* PresetSnapshotService
  return yield* svc.save(...params)
})

/** {@inheritDoc PresetSnapshotServiceDef.recall} */
export const recall = Effect.fn("PresetSnapshotService.recall")(function*(
  ...params: Parameters<PresetSnapshotServiceDef["recall"]>
): Effect.fn.Return<Option.Option<string>, PresetSnapshotError, PresetSnapshotService> {
  const svc = yield* PresetSnapshotService
  return yield* svc.recall(...params)
})

/** {@inheritDoc PresetSnapshotServiceDef.remove} */
export const remove = Effect.fn("PresetSnapshotService.remove")(function*(
  ...params: Parameters<PresetSnapshotServiceDef["remove"]>
): Effect.fn.Return<void, PresetSnapshotError, PresetSnapshotService> {
  const svc = yield* PresetSnapshotService
  return yield* svc.remove(...params)
})
