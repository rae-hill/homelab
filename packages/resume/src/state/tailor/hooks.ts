import { Effect, Equal, Schema } from "effect"
import type { Schemas } from "homelab-services"
import { useCallback, useState } from "react"
import { ResumeContent } from "shared"

import { toaster } from "../../components/chakra/toaster"
import { requestTailor, type TailorResponse } from "../homelab/tailor"
import { printConfigActions } from "../print-config/slice"
import { useAppDispatch, useAppSelector } from "../print-config/store"
import { tailorActions } from "./slice"
import type { TailorEntry } from "./types"

/**
 * Granular selectors + action hooks for the tailor slice. The slice is thin (no persistence
 * logic — that's in the TailorEntryStoreService via the provider's write-through subscription).
 * Submit/recall logic is in T17 (review-flow: no auto-apply, no pre-tailor snapshots).
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
 * Submit a job listing for tailoring. v2 review flow (T17): NO auto-apply, NO pre-tailor
 * snapshot. On success: dispatch submitSucceeded (entry now stores `changes`), open the
 * detail modal for review, toast "Tailoring ready — review the changes." Degraded path
 * opens the modal too (entry is still reviewable). Error path unchanged.
 */
export function useSubmitTailor() {
  const dispatch = useAppDispatch()
  const currentContent = useAppSelector((s) => s.printConfig.content)

  return useCallback(
    async (
      listingText: string,
      policy?: Schemas.ResumeTailor.TailorValidationPolicy,
    ) => {
      const id = crypto.randomUUID()
      const baseVersion = ResumeContent.CONTENT_DEFAULTS_VERSION

      // Dispatch pending entry.
      dispatch(tailorActions.submitStarted({ id, listingText, baseVersion }))

      // Call the tailor endpoint. Send the user's current content as context (the server
      // uses it to know what they already have). The user-supplied policy is always sent
      // (the wire schema accepts it); the server applies the permissive defaults when
      // fields are unset.
      let response: TailorResponse
      try {
        response = await Effect.runPromise(
          requestTailor(listingText, currentContent, baseVersion, policy),
        )
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
      // Store the changes from the response for the Changes tab review flow.
      dispatch(tailorActions.submitSucceeded({
        id,
        response: {
          jobTitle: response.jobTitle,
          company: response.company,
          fit: response.fit,
          contentPatch,
          baseVersion: response.baseVersion,
          meta: response.meta,
          changes: response.changes,
        },
      }))

      // Open the detail modal for review (both success and degraded paths).
      dispatch(tailorActions.openDetail(id))

      if (response.meta?.degraded === true) {
        // Degraded path: toast degraded.
        toaster.create({
          title: "Degraded response",
          description: "Content unchanged. Review the analysis.",
          type: "warning",
        })
        return
      }

      // Success path: toast review prompt.
      toaster.create({
        title: "Tailoring ready",
        description: "Review the changes.",
        type: "success",
      })
    },
    [dispatch, currentContent],
  )
}

/**
 * Apply a stored entry's tailored content with overwrite confirmation (T17/M8). Stale guard:
 * if entry.baseVersion !== CONTENT_DEFAULTS_VERSION or decode fails, toast "Stale entry" and
 * return false. Otherwise, check if current content equals INITIAL_CONTENT_STATE (deep structural
 * equality via Effect's Equal.equals). If equal (pristine defaults) → apply immediately. If
 * different → return the decoded content for the caller to show a confirmation dialog.
 */
export function useApplyEntry() {
  const dispatch = useAppDispatch()
  const currentContent = useAppSelector((s) => s.printConfig.content)
  const [pendingApply, setPendingApply] = useState<ResumeContent.ContentState | null>(null)

  const requestApply = useCallback(
    (entry: TailorEntry): boolean => {
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

      // Check if current content equals the default (pristine) state.
      const isPristine = Equal.equals(currentContent, ResumeContent.INITIAL_CONTENT_STATE)

      if (isPristine) {
        // Apply immediately — no confirmation needed.
        dispatch(printConfigActions.applyTailoredContent(decoded))
        toaster.create({
          title: "Tailored content applied.",
          type: "success",
        })
        return true
      }

      // Content differs from default — need confirmation.
      setPendingApply(decoded)
      return true
    },
    [dispatch, currentContent],
  )

  const confirm = useCallback(() => {
    if (pendingApply !== null) {
      dispatch(printConfigActions.applyTailoredContent(pendingApply))
      toaster.create({
        title: "Tailored content applied.",
        type: "success",
      })
      setPendingApply(null)
    }
  }, [dispatch, pendingApply])

  const cancel = useCallback(() => {
    setPendingApply(null)
  }, [])

  return {
    requestApply,
    confirmationPending: pendingApply !== null,
    confirm,
    cancel,
  }
}
