import { Effect, Layer, Result, Schema } from "effect"
import { Services } from "homelab-services"
import type { WebStoragePort } from "../web-storage-port.js"

/**
 * localStorage key for tailor entries.
 *
 * Namespace follows the existing resume.app convention (https://resume.rae-hill.dev)
 * to avoid collisions with other apps on the same origin.
 */
export const TAILOR_ENTRIES_STORAGE_KEY = "https://resume.rae-hill.dev/tailor-entries"

class TailorEntryStoreServiceImpl implements Services.TailorEntryStoreService.TailorEntryStoreServiceDef {
  constructor(private readonly storage: WebStoragePort) {}

  readonly load = (): Effect.Effect<
    ReadonlyArray<Services.TailorEntryStoreService.TailorEntry>,
    Services.TailorEntryStoreService.TailorEntryStoreError
  > =>
    Effect.gen({ self: this }, function*() {
      const raw = yield* Effect.try({
        try: () => this.storage.getItem(TAILOR_ENTRIES_STORAGE_KEY),
        catch: (error) =>
          new Services.TailorEntryStoreService.TailorEntryStoreError({
            message: "Failed to read tailor entries from storage",
            error,
          }),
      })

      if (raw === null) {
        return []
      }

      const decoded = yield* Effect.try({
        try: () => {
          const parsed = JSON.parse(raw)
          const decode = Schema.decodeUnknownResult(Services.TailorEntryStoreService.TailorEntryEnvelopeSchema)
          const result = decode(parsed)
          if (Result.isSuccess(result)) {
            return result.success.entries
          }
          console.warn(
            "[TailorEntryStoreService] Failed to decode stored entries, resetting to empty",
            result.failure,
          )
          return []
        },
        catch: (error) => {
          console.warn("[TailorEntryStoreService] Parse error, resetting to empty", error)
          return []
        },
      })

      return decoded
    }).pipe(
      Effect.catch((error) => {
        console.warn("[TailorEntryStoreService] load failed, returning empty", error)
        return Effect.succeed([])
      }),
    )

  readonly save = (
    entries: ReadonlyArray<Services.TailorEntryStoreService.TailorEntry>,
  ): Effect.Effect<void, Services.TailorEntryStoreService.TailorEntryStoreError> =>
    Effect.gen({ self: this }, function*() {
      const pruned = Services.TailorEntryStoreService.pruneEntries(entries, 50)
      const envelope = {
        version: 1 as const,
        entries: pruned,
      }

      const encoded = yield* Effect.try({
        try: () => JSON.stringify(envelope),
        catch: (error) =>
          new Services.TailorEntryStoreService.TailorEntryStoreError({
            message: "Failed to encode tailor entries",
            error,
          }),
      })

      yield* Effect.try({
        try: () => this.storage.setItem(TAILOR_ENTRIES_STORAGE_KEY, encoded),
        catch: (error) =>
          new Services.TailorEntryStoreService.TailorEntryStoreError({
            message: "Failed to write tailor entries to storage",
            error,
          }),
      })
    })
}

/**
 * Live layer for TailorEntryStoreService.
 *
 * Provides the service backed by a WebStoragePort (typically localStorage).
 * The layer is parameterized so tests can inject an in-memory port.
 *
 * @param storage - WebStoragePort implementation (e.g., window.localStorage)
 */
export const TailorEntryStoreServiceLive = (
  storage: WebStoragePort,
): Layer.Layer<Services.TailorEntryStoreService.TailorEntryStoreService, never, never> =>
  Layer.effect(
    Services.TailorEntryStoreService.TailorEntryStoreService,
    Effect.succeed(new TailorEntryStoreServiceImpl(storage)),
  )
