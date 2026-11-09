import { Context, Data, Effect, Schema } from "effect"
import { FitReport, TailorMeta } from "../schemas/resume-tailor.js"

export const TailorEntryStoreServiceId = "homelab-api/services/tailor/TailorEntryStoreService"

/* ---- Schemas -------------------------------------------------------------------------------- */

/**
 * A single tailor entry as persisted in localStorage. Status reflects the pipeline outcome:
 * - pending: dispatched but not yet resolved
 * - success: pipeline returned a full result (fit + content patch)
 * - degraded: pipeline returned partial/defaulted results (meta.degraded = true)
 * - error: pipeline failed (network, provider, schema mismatch)
 */
export const TailorEntrySchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pending", "success", "degraded", "error"]),
  createdAt: Schema.Number,
  listingText: Schema.String,
  jobTitle: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  fit: Schema.NullOr(FitReport),
  contentPatch: Schema.NullOr(Schema.String),
  baseVersion: Schema.String,
  meta: Schema.NullOr(TailorMeta),
  error: Schema.NullOr(Schema.String),
})

export type TailorEntry = Schema.Schema.Type<typeof TailorEntrySchema>

/**
 * Versioned envelope wrapping the entries array. The version field allows future schema
 * evolution without breaking old persisted data (decode failure → empty list + warn).
 */
export const TailorEntryEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(TailorEntrySchema),
})

export type TailorEntryEnvelope = Schema.Schema.Type<typeof TailorEntryEnvelopeSchema>

/* ---- Pure helpers --------------------------------------------------------------------------- */

/**
 * Keep the newest `cap` entries by `createdAt`. Pure; does not mutate the input.
 * The slice stays thin — cap/prune is applied at persist time by the store service.
 */
export const pruneEntries = (entries: ReadonlyArray<TailorEntry>, cap = 50): ReadonlyArray<TailorEntry> => {
  if (entries.length <= cap) {
    return entries
  }
  return [...entries]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, cap)
}

/* ---- Error ---------------------------------------------------------------------------------- */

/** Raised when the entry store cannot load/save (storage unavailable, schema mismatch). */
export class TailorEntryStoreError extends Data.TaggedError("TailorEntryStoreError")<{
  readonly message: string
  readonly error: unknown
}> {}

/* ---- Service -------------------------------------------------------------------------------- */

export interface TailorEntryStoreServiceDef {
  /** Load all entries from storage. Returns [] on any decode failure (logged + warned). */
  readonly load: () => Effect.Effect<ReadonlyArray<TailorEntry>, TailorEntryStoreError>
  /** Save entries to storage (applies pruneEntries cap). */
  readonly save: (entries: ReadonlyArray<TailorEntry>) => Effect.Effect<void, TailorEntryStoreError>
}

export class TailorEntryStoreService
  extends Context.Service<TailorEntryStoreService, TailorEntryStoreServiceDef>()(TailorEntryStoreServiceId)
{}

/** {@inheritDoc TailorEntryStoreServiceDef.load} */
export const load = Effect.fn("TailorEntryStoreService.load")(function*(
  ...params: Parameters<TailorEntryStoreServiceDef["load"]>
): Effect.fn.Return<ReadonlyArray<TailorEntry>, TailorEntryStoreError, TailorEntryStoreService> {
  const svc = yield* TailorEntryStoreService
  return yield* svc.load(...params)
})

/** {@inheritDoc TailorEntryStoreServiceDef.save} */
export const save = Effect.fn("TailorEntryStoreService.save")(function*(
  ...params: Parameters<TailorEntryStoreServiceDef["save"]>
): Effect.fn.Return<void, TailorEntryStoreError, TailorEntryStoreService> {
  const svc = yield* TailorEntryStoreService
  return yield* svc.save(...params)
})
