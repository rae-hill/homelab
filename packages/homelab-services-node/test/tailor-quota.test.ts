import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Services } from "homelab-services"
import { TailorQuotaServiceLive } from "../src/layers/tailor-quota-service.js"

describe("tailor quota", () => {
  const TestLayer = TailorQuotaServiceLive

  it.effect("allows requests within daily limit", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService
      yield* quota.tryConsume("user@example.com")
      // Should not throw
    }).pipe(Effect.provide(TestLayer)))

  it.effect("enforces per-subject daily limit of 10", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService

      // Consume 10 requests (should succeed)
      for (let i = 0; i < 10; i++) {
        yield* quota.tryConsume("user@example.com")
      }

      // 11th request should fail
      const result = yield* Effect.exit(quota.tryConsume("user@example.com"))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorOption = Cause.findErrorOption(result.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorQuotaExceeded")
          if (errorOption.value._tag === "TailorQuotaExceeded") {
            expect(errorOption.value.retryAfterSeconds).toBeGreaterThan(0)
            expect(errorOption.value.retryAfterSeconds).toBeLessThanOrEqual(86400)
          }
        }
      }
    }).pipe(Effect.provide(TestLayer)))

  it.effect("enforces global daily limit of 100", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService

      // Consume 100 requests across different subjects (should succeed)
      for (let i = 0; i < 100; i++) {
        yield* quota.tryConsume(`user${i}@example.com`)
      }

      // 101st request should fail
      const result = yield* Effect.exit(quota.tryConsume("user101@example.com"))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorOption = Cause.findErrorOption(result.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorQuotaExceeded")
        }
      }
    }).pipe(Effect.provide(TestLayer)))

  it.effect("tracks per-subject quotas independently", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService

      // User A consumes 5 requests
      for (let i = 0; i < 5; i++) {
        yield* quota.tryConsume("user-a@example.com")
      }

      // User B should still be able to consume 10 requests
      for (let i = 0; i < 10; i++) {
        yield* quota.tryConsume("user-b@example.com")
      }

      // User A should still be able to consume 5 more
      for (let i = 0; i < 5; i++) {
        yield* quota.tryConsume("user-a@example.com")
      }

      // User A's 11th request should fail
      const result = yield* Effect.exit(quota.tryConsume("user-a@example.com"))
      expect(result._tag).toBe("Failure")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("returns retryAfterSeconds based on time until midnight UTC", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService

      // Exhaust the quota
      for (let i = 0; i < 10; i++) {
        yield* quota.tryConsume("user@example.com")
      }

      const result = yield* Effect.exit(quota.tryConsume("user@example.com"))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorOption = Cause.findErrorOption(result.cause)
        if (errorOption._tag === "Some" && errorOption.value._tag === "TailorQuotaExceeded") {
          const retryAfter = errorOption.value.retryAfterSeconds
          // Should be between 0 and 86400 seconds (24 hours)
          expect(retryAfter).toBeGreaterThanOrEqual(0)
          expect(retryAfter).toBeLessThanOrEqual(86400)
        }
      }
    }).pipe(Effect.provide(TestLayer)))

  it.effect("reads Clock (not Date.now) and resets buckets at UTC midnight", () =>
    Effect.gen(function*() {
      const quota = yield* Services.TailorQuotaService.TailorQuotaService

      // Pin TestClock to epoch 0 (start of a UTC day).
      yield* TestClock.setTime(0)

      for (let i = 0; i < 10; i++) {
        yield* quota.tryConsume("user@example.com")
      }
      const exhausted = yield* Effect.exit(quota.tryConsume("user@example.com"))
      expect(exhausted._tag).toBe("Failure")
      if (exhausted._tag === "Failure") {
        const errorOption = Cause.findErrorOption(exhausted.cause)
        if (errorOption._tag === "Some" && errorOption.value._tag === "TailorQuotaExceeded") {
          // Exactly one full day at epoch 0 — impossible with a wall clock:
          // proves the service reads Clock.currentTimeMillis (layer-integrated time).
          expect(errorOption.value.retryAfterSeconds).toBe(86400)
        }
      }

      // Advance past UTC midnight: the window's day index changes and buckets reset.
      yield* TestClock.setTime(86_400_000 + 1_000)
      yield* quota.tryConsume("user@example.com") // succeeds again
    }).pipe(Effect.provide(Layer.merge(TestLayer, TestClock.layer()))))
})
