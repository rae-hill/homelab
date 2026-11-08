import { Clock, Effect, Layer, Ref } from "effect"
import { Services } from "homelab-services"

const MILLIS_PER_DAY = 86_400_000

/** Default quota limits (per UTC day). Override via `makeTailorQuotaService` if ever env-driven. */
export interface TailorQuotaLimits {
  readonly subjectDaily: number
  readonly globalDaily: number
}

const defaultLimits: TailorQuotaLimits = { subjectDaily: 10, globalDaily: 100 }

/**
 * Immutable daily-window state, held in a `Ref` OWNED BY THE LAYER INSTANCE — no module-scoped
 * mutable state. The window is keyed by UTC day index, so the midnight reset is just a day-index
 * change detected inside `Ref.modify` (which makes check-and-consume atomic; no mutex needed for
 * a single Ref). House precedent: puppeteer-service.ts.
 */
interface QuotaWindow {
  readonly day: number
  readonly globalCount: number
  readonly subjectCounts: ReadonlyMap<string, number>
}

const emptyWindow = (day: number): QuotaWindow => ({ day, globalCount: 0, subjectCounts: new Map() }) as QuotaWindow

/** Seconds from `now` (epoch millis) until the next UTC midnight. */
const secondsUntilMidnight = (now: number): number => {
  const day = Math.floor(now / MILLIS_PER_DAY)
  return Math.ceil(((day + 1) * MILLIS_PER_DAY - now) / 1000)
}

/**
 * Live implementation of the TailorQuotaService: in-process per-subject daily bucket + global
 * daily ceiling, resetting at UTC midnight. No persistence — restarts clear all buckets.
 * Time comes from `Clock.currentTimeMillis` (testable via Effect's TestClock), never `Date.now()`.
 */
export const makeTailorQuotaService = (limits: TailorQuotaLimits = defaultLimits) =>
  Layer.effect(
    Services.TailorQuotaService.TailorQuotaService,
    Effect.gen(function*() {
      const windowRef = yield* Ref.make(emptyWindow(0))

      const exhausted = (now: number) =>
        Effect.fail(
          new Services.TailorService.TailorQuotaExceeded({
            retryAfterSeconds: secondsUntilMidnight(now),
          }),
        )

      return {
        tryConsume: (subject: string) =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const today = Math.floor(now / MILLIS_PER_DAY)
            // Single atomic check-and-consume across BOTH buckets: on exhaustion the window is
            // returned unchanged (a failed attempt never consumes quota).
            const consumed = yield* Ref.modify(windowRef, (window_) => {
              const current = window_.day === today ? window_ : emptyWindow(today)
              const subjectCount = current.subjectCounts.get(subject) ?? 0
              if (current.globalCount >= limits.globalDaily) {
                return [false, current] as const
              }
              if (subjectCount >= limits.subjectDaily) {
                return [false, current] as const
              }
              const next: QuotaWindow = {
                day: today,
                globalCount: current.globalCount + 1,
                subjectCounts: new Map(current.subjectCounts).set(subject, subjectCount + 1),
              }
              return [true, next] as const
            })
            if (!consumed) {
              return yield* exhausted(now)
            }
          }),
      } satisfies Services.TailorQuotaService.TailorQuotaServiceDef
    }),
  )

export const TailorQuotaServiceLive = makeTailorQuotaService()
