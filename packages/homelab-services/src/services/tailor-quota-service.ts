import { Context, Effect } from "effect"
import type { TailorQuotaExceeded } from "./tailor-service.js"

export const TailorQuotaServiceId = "homelab-api/services/tailor/TailorQuotaService"

export interface TailorQuotaServiceDef {
  /**
   * Attempt to consume one tailor slot for the given subject. Fails with `TailorQuotaExceeded`
   * if the per-subject daily bucket or global daily ceiling is exhausted.
   *
   * `retryAfterSeconds` in the failure tells the handler how long to wait before retrying
   * (seconds until UTC midnight).
   */
  readonly tryConsume: (subject: string) => Effect.Effect<void, TailorQuotaExceeded>
}

export class TailorQuotaService
  extends Context.Service<TailorQuotaService, TailorQuotaServiceDef>()(TailorQuotaServiceId)
{}

/** {@inheritDoc TailorQuotaServiceDef.tryConsume} */
export const tryConsume = Effect.fn("TailorQuotaService.tryConsume")(function*(
  ...params: Parameters<TailorQuotaServiceDef["tryConsume"]>
): Effect.fn.Return<void, TailorQuotaExceeded, TailorQuotaService> {
  const svc = yield* TailorQuotaService
  return yield* svc.tryConsume(...params)
})
