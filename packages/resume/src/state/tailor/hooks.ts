import { Effect, Schema } from "effect"
import { Services } from "homelab-services"
import { useCallback } from "react"
import { ResumeContent } from "shared"

import { toaster } from "../../components/chakra/toaster"
import { requestTailor, type TailorResponse } from "../homelab/tailor"
import { encodeBase64Config } from "../print-config/persistence"
import { printConfigActions } from "../print-config/slice"
import { useAppDispatch, useAppSelector } from "../print-config/store"
import { runBrowser } from "../services"
import { tailorActions } from "./slice"
import type { TailorEntry } from "./types"

/**
 * Granular selectors + action hooks for the tailor slice. The slice is thin (no persistence
 * logic — that's in the TailorEntryStoreService via the provider's write-through subscription).
 * Submit/recall logic is in T8 (auto-apply flow).
 */

/** Select all tailor entries (reverse-chron — newest first). */
export function useTailorEntries(): ReadonlyArray<TailorEntry> {
  return useAppSelector((s) => s.tailor.entries)
}

/** Select the currently-open detail entry (or null if none). */
export function useTailorDetail(): TailorEntry | null {
  const detailEntryId = useAppSelector((s) => s.tailor.detailEntryId)
  const entries = useAppSelector((s) => s.tailor.entries)
  if (detailEntryId === null) {
    return null
  }
  return entries.find((e) => e.id === detailEntryId) ?? null
}

/** Open the detail view for a specific entry. */
export function useOpenDetail() {
  const dispatch = useAppDispatch()
  return useCallback((id: string) => dispatch(tailorActions.openDetail(id)), [dispatch])
}

/** Close the detail view. */
export function useCloseDetail() {
  const dispatch = useAppDispatch()
  return useCallback(() => dispatch(tailorActions.closeDetail()), [dispatch])
}

/** Remove an entry by id (clears detailEntryId if it was open). */
export function useRemoveEntry() {
  const dispatch = useAppDispatch()
  return useCallback((id: string) => dispatch(tailorActions.removeEntry(id)), [dispatch])
}

/**
 * Submit a job listing for tailoring. Auto-apply flow (D1): on success, pre-save the current
 * config as a preset, dispatch applyTailoredContent, dispatch submitSucceeded, and toast.
 * On degraded, skip pre-save + apply and toast degraded. On error, dispatch submitFailed + toast.
 */
export function useSubmitTailor() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((s) => s.printConfig)

  return useCallback(
    async (listingText: string) => {
      const id = crypto.randomUUID()
      const baseVersion = ResumeContent.CONTENT_DEFAULTS_VERSION

      // Dispatch pending entry.
      dispatch(tailorActions.submitStarted({ id, listingText, baseVersion }))

      // Call the tailor endpoint.
      let response: TailorResponse
      try {
        response = await Effect.runPromise(requestTailor(listingText, state.content, baseVersion))
      } catch (error) {
        // Error path.
        const message =
          typeof error === "object" && error !== null && "_tag" in error && error._tag === "ResumeTailorRequestError" &&
            "message" in error
            ? (error as { message: string }).message
            : String(error)

        // Detect baseVersion mismatch (400 Bad Request with "version" in message).
        const isVersionMismatch = message.toLowerCase().includes("version")

        dispatch(tailorActions.submitFailed({
          id,
          error: isVersionMismatch
            ? "Resume content version changed — reload and re-tailor."
            : message,
        }))

        toaster.create({
          title: "Tailoring failed",
          description: isVersionMismatch
            ? "Resume content version changed — reload and re-tailor."
            : message,
          type: "error",
        })
        return
      }

      // Re-encode the response content for entry storage.
      const contentPatch = Schema.encodeSync(ResumeContent.ContentPatchBase64)(response.content)

      // Dispatch success (sets status to "success" or "degraded" based on meta.degraded).
      dispatch(tailorActions.submitSucceeded({
        id,
        response: {
          jobTitle: response.jobTitle,
          company: response.company,
          fit: response.fit,
          contentPatch,
          baseVersion: response.baseVersion,
          meta: response.meta,
        },
      }))

      if (response.meta?.degraded === true) {
        // Degraded path: skip pre-save + apply, toast degraded.
        toaster.create({
          title: "Degraded response",
          description: "Content unchanged. Snapshot NOT saved.",
          type: "warning",
        })
        return
      }

      // Success path: pre-save preset, apply tailored content, toast.
      const presetName = Services.PresetSnapshotService.generatePresetName(
        response.jobTitle,
        new Date(),
      )
      const fullConfigBase64 = encodeBase64Config(state)

      // Pre-save preset (onCollision: "suffix" → never clobbers an earlier snapshot).
      const finalName = await runBrowser(
        Effect.gen(function*() {
          const service = yield* Services.PresetSnapshotService.PresetSnapshotService
          return yield* service.save(presetName, fullConfigBase64, { onCollision: "suffix" })
        }),
      )

      // Apply tailored content (sets state.content ONLY, preserves layout + editingEnabled).
      dispatch(printConfigActions.applyTailoredContent(response.content))

      toaster.create({
        title: "Content applied",
        description: finalName !== undefined
          ? `Snapshot saved as "${finalName}".`
          : "Snapshot saved.",
        type: "success",
      })
    },
    [dispatch, state],
  )
}

/**
 * Recall a stored entry's tailored content. Stale guard: if entry.baseVersion !== CONTENT_DEFAULTS_VERSION
 * or decode fails, toast "Stale entry — re-tailor" and return false. Otherwise, pre-save preset,
 * apply tailored content, and toast success.
 */
export function useRecallEntry() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((s) => s.printConfig)

  return useCallback(
    async (entry: TailorEntry): Promise<boolean> => {
      // Stale guard: baseVersion mismatch.
      if (entry.baseVersion !== ResumeContent.CONTENT_DEFAULTS_VERSION) {
        toaster.create({
          title: "Stale entry",
          description: "Re-tailor to apply this entry.",
          type: "error",
        })
        return false
      }

      // Decode the stored content patch.
      if (entry.contentPatch === null) {
        toaster.create({
          title: "No content",
          description: "This entry has no content to apply.",
          type: "error",
        })
        return false
      }

      let decoded: ResumeContent.ContentState
      try {
        decoded = Schema.decodeUnknownSync(ResumeContent.ContentPatchBase64)(entry.contentPatch)
      } catch {
        toaster.create({
          title: "Stale entry",
          description: "Re-tailor to apply this entry.",
          type: "error",
        })
        return false
      }

      // Pre-save preset.
      const presetName = Services.PresetSnapshotService.generatePresetName(
        entry.jobTitle,
        new Date(entry.createdAt),
      )
      const fullConfigBase64 = encodeBase64Config(state)

      const finalName = await runBrowser(
        Effect.gen(function*() {
          const service = yield* Services.PresetSnapshotService.PresetSnapshotService
          return yield* service.save(presetName, fullConfigBase64, { onCollision: "suffix" })
        }),
      )

      // Apply tailored content.
      dispatch(printConfigActions.applyTailoredContent(decoded))

      toaster.create({
        title: "Content applied",
        description: finalName !== undefined
          ? `Snapshot saved as "${finalName}".`
          : "Snapshot saved.",
        type: "success",
      })

      return true
    },
    [dispatch, state],
  )
}
