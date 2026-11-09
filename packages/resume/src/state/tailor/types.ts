import type { Services } from "homelab-services"

/** Re-export the contract's TailorEntry type (schema-derived). */
export type TailorEntry = Services.TailorEntryStoreService.TailorEntry

/** Entry lifecycle status. */
export type TailorStatus = "pending" | "success" | "degraded" | "error"

/** The tailor slice state shape. */
export interface TailorState {
  readonly entries: ReadonlyArray<TailorEntry>
  readonly detailEntryId: string | null
}
