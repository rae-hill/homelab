import { useCallback } from "react"

import { useAppDispatch, useAppSelector } from "../print-config/store"
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
