import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { Schemas } from "homelab-services"
import { castDraft } from "immer"

import type { TailorEntry, TailorState } from "./types"

/**
 * The tailor slice. Manages job listing entries and the currently-open detail view.
 * Reducers are thin — cap/prune and persistence logic live in the TailorEntryStoreService
 * (D8), not in the slice. The slice stays pure and testable.
 */
export const tailorSlice = createSlice({
  name: "tailor",
  initialState: {
    entries: [],
    detailEntryId: null,
  } as TailorState,
  reducers: {
    /**
     * Create a pending entry (unshift — newest first). All response fields null; filled
     * by submitSucceeded or submitFailed.
     */
    submitStarted(
      state,
      action: PayloadAction<{
        id: string
        listingText: string
        baseVersion: string
      }>,
    ) {
      const { baseVersion, id, listingText } = action.payload
      const entry: TailorEntry = {
        id,
        status: "pending",
        createdAt: Date.now(),
        listingText,
        baseVersion,
        jobTitle: null,
        company: null,
        fit: null,
        contentPatch: null,
        meta: null,
        error: null,
        changes: null,
      }
      state.entries.unshift(castDraft(entry))
    },

    /**
     * Fill a pending entry with the tailor response. Status becomes "success" or "degraded"
     * based on meta.degraded. Clears any previous error. Stores the structured changes
     * list (server-derived from merge delta) for the Changes tab review flow.
     */
    submitSucceeded(
      state,
      action: PayloadAction<{
        id: string
        response: {
          jobTitle: string
          company: string | null
          fit: TailorEntry["fit"]
          contentPatch: string | null
          baseVersion: string
          meta: TailorEntry["meta"]
          changes: ReadonlyArray<Schemas.ResumeTailor.TailorChange>
        }
      }>,
    ) {
      const { id, response } = action.payload
      const entry = state.entries.find((e) => e.id === id)
      if (entry !== undefined) {
        entry.status = response.meta?.degraded === true ? "degraded" : "success"
        entry.jobTitle = response.jobTitle
        entry.company = response.company
        entry.fit = castDraft(response.fit)
        entry.contentPatch = response.contentPatch
        entry.baseVersion = response.baseVersion
        entry.meta = castDraft(response.meta)
        entry.changes = castDraft(response.changes)
        entry.error = null
      }
    },

    /** Set a pending entry's status to "error" with an error message. */
    submitFailed(state, action: PayloadAction<{ id: string; error: string }>) {
      const { error, id } = action.payload
      const entry = state.entries.find((e) => e.id === id)
      if (entry !== undefined) {
        entry.status = "error"
        entry.error = error
      }
    },

    /** Remove an entry by id. Clear detailEntryId if it was the open detail. */
    removeEntry(state, action: PayloadAction<string>) {
      const id = action.payload
      state.entries = state.entries.filter((e) => e.id !== id)
      if (state.detailEntryId === id) {
        state.detailEntryId = null
      }
    },

    /** Open the detail view for a specific entry. */
    openDetail(state, action: PayloadAction<string>) {
      state.detailEntryId = action.payload
    },

    /** Close the detail view. */
    closeDetail(state) {
      state.detailEntryId = null
    },

    /** Replace the entire slice (used by one-shot hydration from localStorage). */
    hydrate(_state, action: PayloadAction<TailorState>) {
      return action.payload
    },
  },
})

export const tailorActions = tailorSlice.actions
export const tailorReducer = tailorSlice.reducer
