import { Effect, Layer, Option } from "effect"
import { Services } from "homelab-services"
import type { WebStoragePort } from "../web-storage-port.js"

/**
 * localStorage key for print config presets.
 *
 * MUST match the key used by the existing usePresets hook in the resume package
 * (packages/resume/src/constants/print-config.constants.ts) to maintain backward
 * compatibility with existing saved presets.
 *
 * Format: "https://resume.rae-hill.dev__print-config-presets"
 */
export const PRESETS_STORAGE_KEY = "https://resume.rae-hill.dev__print-config-presets"

/**
 * Reserved preset name (the built-in read-only default).
 *
 * MUST match the value used by the existing usePresets hook in the resume package
 * (packages/resume/src/constants/print-config.constants.ts).
 */
const DEFAULT_PRESET_NAME = "Default"

type PresetRecord = Record<string, string>

class PresetSnapshotServiceImpl implements Services.PresetSnapshotService.PresetSnapshotServiceDef {
  constructor(private readonly storage: WebStoragePort) {}

  private readRecord(): Effect.Effect<PresetRecord, Services.PresetSnapshotService.PresetSnapshotError> {
    return Effect.gen({ self: this }, function*() {
      const raw = yield* Effect.try({
        try: () => this.storage.getItem(PRESETS_STORAGE_KEY),
        catch: (error) =>
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: "Failed to read presets from storage",
            error,
          }),
      })

      if (raw === null) {
        return {}
      }

      return yield* Effect.try({
        try: () => {
          const parsed = JSON.parse(raw)
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            console.warn("[PresetSnapshotService] Stored presets is not an object, resetting to empty")
            return {}
          }
          // Validate all values are strings
          const result: PresetRecord = {}
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string") {
              result[key] = value
            }
          }
          return result
        },
        catch: (error) => {
          console.warn("[PresetSnapshotService] Parse error, resetting to empty", error)
          return {}
        },
      })
    }).pipe(
      Effect.catch((error) => {
        console.warn("[PresetSnapshotService] readRecord failed, returning empty", error)
        return Effect.succeed({})
      }),
    )
  }

  private writeRecord(
    record: PresetRecord,
  ): Effect.Effect<void, Services.PresetSnapshotService.PresetSnapshotError> {
    return Effect.gen({ self: this }, function*() {
      const encoded = yield* Effect.try({
        try: () => JSON.stringify(record),
        catch: (error) =>
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: "Failed to encode presets",
            error,
          }),
      })

      yield* Effect.try({
        try: () => this.storage.setItem(PRESETS_STORAGE_KEY, encoded),
        catch: (error) =>
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: "Failed to write presets to storage",
            error,
          }),
      })
    })
  }

  readonly list = (): Effect.Effect<
    ReadonlyArray<string>,
    Services.PresetSnapshotService.PresetSnapshotError
  > =>
    Effect.gen({ self: this }, function*() {
      const record = yield* this.readRecord()
      // Sort alphabetically, excluding the reserved "Default" name
      return Object.keys(record)
        .filter((name) => name !== DEFAULT_PRESET_NAME)
        .sort((a, b) => a.localeCompare(b))
    })

  readonly save = (
    name: string,
    configBase64: string,
    options?: { readonly onCollision?: "overwrite" | "suffix" },
  ): Effect.Effect<string, Services.PresetSnapshotService.PresetSnapshotError> =>
    Effect.gen({ self: this }, function*() {
      // Reject empty names
      if (name.trim() === "") {
        return yield* Effect.fail(
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: "Preset name cannot be empty",
            error: null,
          }),
        )
      }

      // Reject the reserved "Default" name
      if (name === DEFAULT_PRESET_NAME) {
        return yield* Effect.fail(
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: `Preset name "${DEFAULT_PRESET_NAME}" is reserved`,
            error: null,
          }),
        )
      }

      const record = yield* this.readRecord()
      // Default = overwrite (legacy usePresets behavior); "suffix" is opt-in for the
      // pre-tailor snapshot flow, which must never clobber an earlier snapshot.
      const finalName = options?.onCollision === "suffix"
        ? Services.PresetSnapshotService.resolveCollision(name, Object.keys(record))
        : name

      record[finalName] = configBase64
      yield* this.writeRecord(record)

      return finalName
    })

  readonly recall = (
    name: string,
  ): Effect.Effect<Option.Option<string>, Services.PresetSnapshotService.PresetSnapshotError> =>
    Effect.gen({ self: this }, function*() {
      const record = yield* this.readRecord()
      const value = record[name]
      return value === undefined ? Option.none() : Option.some(value)
    })

  readonly remove = (
    name: string,
  ): Effect.Effect<void, Services.PresetSnapshotService.PresetSnapshotError> =>
    Effect.gen({ self: this }, function*() {
      // Reject removal of the reserved "Default" name
      if (name === DEFAULT_PRESET_NAME) {
        return yield* Effect.fail(
          new Services.PresetSnapshotService.PresetSnapshotError({
            message: `Cannot remove reserved preset "${DEFAULT_PRESET_NAME}"`,
            error: null,
          }),
        )
      }

      const record = yield* this.readRecord()
      if (name in record) {
        delete record[name]
        yield* this.writeRecord(record)
      }
    })
}

/**
 * Live layer for PresetSnapshotService.
 *
 * Provides the service backed by a WebStoragePort (typically localStorage).
 * The layer is parameterized so tests can inject an in-memory port.
 *
 * @param storage - WebStoragePort implementation (e.g., window.localStorage)
 */
export const PresetSnapshotServiceLive = (
  storage: WebStoragePort,
): Layer.Layer<Services.PresetSnapshotService.PresetSnapshotService, never, never> =>
  Layer.effect(
    Services.PresetSnapshotService.PresetSnapshotService,
    Effect.succeed(new PresetSnapshotServiceImpl(storage)),
  )
