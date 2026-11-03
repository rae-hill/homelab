import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe, Schema } from "effect"
import { Schemas } from "homelab-services"

describe("HealthResponseSchema", () => {
  describe("decode", () => {
    it.effect("should decode 'All services healthy' message", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeEffect(Schemas.Health.HealthResponseSchema)("All services healthy")

        expect(result).toEqual({
          Jellyfin: "Healthy",
          Kanidm: "Healthy",
          "Step-CA": "Healthy",
        })
      }))

    it.effect("should decode single unhealthy service", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeEffect(Schemas.Health.HealthResponseSchema)("Jellyfin is Unreachable")

        expect(result).toEqual({
          Jellyfin: "Unreachable",
          Kanidm: "Healthy",
          "Step-CA": "Healthy",
        })
      }))

    it.effect("should decode multiple unhealthy services", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeEffect(Schemas.Health.HealthResponseSchema)(
          "Jellyfin is Unreachable, Kanidm is Unhealthy, Step-CA is Unreachable",
        )

        expect(result).toEqual({
          Jellyfin: "Unreachable",
          Kanidm: "Unhealthy",
          "Step-CA": "Unreachable",
        })
      }))
  })

  describe("encode", () => {
    it.effect("should encode all healthy services", () =>
      Effect.gen(function*() {
        const result = yield* Schema.encodeEffect(Schemas.Health.HealthResponseSchema)({
          Jellyfin: "Healthy",
          Kanidm: "Healthy",
          "Step-CA": "Healthy",
        })

        expect(result).toBe("All services healthy")
      }))

    it.effect("should encode single unhealthy service", () =>
      Effect.gen(function*() {
        const result = yield* Schema.encodeEffect(Schemas.Health.HealthResponseSchema)({
          Jellyfin: "Unreachable",
          Kanidm: "Healthy",
          "Step-CA": "Healthy",
        })

        expect(result).toBe("Jellyfin is Unreachable")
      }))

    it.effect("should encode multiple unhealthy services with comma-space separator", () =>
      Effect.gen(function*() {
        const result = yield* Schema.encodeEffect(Schemas.Health.HealthResponseSchema)({
          Jellyfin: "Unreachable",
          Kanidm: "Unhealthy",
          "Step-CA": "Healthy",
        })

        expect(result).toBe("Jellyfin is Unreachable, Kanidm is Unhealthy")
      }))
  })

  describe("round-trip encode/decode", () => {
    it.effect.prop(
      "should round-trip for any valid health status record",
      [Schema.toType(Schemas.Health.HealthResponseSchema)],
      ([healthStatus]) =>
        pipe(
          healthStatus,
          Schema.encodeEffect(Schemas.Health.HealthResponseSchema),
          Effect.flatMap(Schema.decodeEffect(Schemas.Health.HealthResponseSchema)),
          Effect.map((_) => {
            expect(_).toEqual(healthStatus)
            return true
          }),
        ),
    )
  })
})
