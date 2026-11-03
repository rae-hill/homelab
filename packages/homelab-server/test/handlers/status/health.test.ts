import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleHealth } from "../../../src/handlers/status/health.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const healthArgs = (): Homelab.StatusEndpoints.Health.HealthEndpointHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {} as any,
})

const withFetch = (fn: typeof fetch) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, HttpClient.filterStatusOk),
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fn)),
  )

describe("handleHealth", () => {
  it.effect("should return health status for identity with Status_Health permission", () =>
    Effect.gen(function*() {
      const result = yield* handleHealth(healthArgs())

      expect(result).toEqual({
        Kanidm: "Healthy",
        Jellyfin: "Healthy",
        "Step-CA": "Healthy",
      })
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Status_Health"])),
        ),
        HandlerTestLayer,
      )),
    ))

  it.effect("should deny access when identity lacks Status.Health permission", () =>
    Effect.gen(function*() {
      const result = yield* Effect.flip(handleHealth(healthArgs()))

      assert(result instanceof ApiErrors.AuthorizationError)
      expect(result.resource).toBe("Status_Health")
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Config_Wifi"])),
        ),
        HandlerTestLayer,
      )),
    ))

  it.effect("should deny access with empty permissions", () =>
    Effect.gen(function*() {
      const result = yield* Effect.flip(handleHealth(healthArgs()))

      assert(result instanceof ApiErrors.AuthorizationError)
      expect(result.resource).toBe("Status_Health")
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable([])),
        ),
        HandlerTestLayer,
      )),
    ))

  it.effect("should allow mTLS identity with Status.Health permission", () =>
    Effect.gen(function*() {
      const result = yield* handleHealth(healthArgs())

      expect(result).toEqual({
        Kanidm: "Healthy",
        Jellyfin: "Healthy",
        "Step-CA": "Healthy",
      })
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.MTLSIdentity("client.example.com", HashSet.fromIterable(["Status_Health"])),
        ),
        HandlerTestLayer,
      )),
    ))

  it.effect("should return Unreachable for services returning 503", () =>
    Effect.gen(function*() {
      const result = yield* handleHealth(healthArgs())

      expect(result).toEqual({
        Kanidm: "Unreachable",
        Jellyfin: "Unreachable",
        "Step-CA": "Unreachable",
      })
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Status_Health"])),
        ),
        Layer.provideMerge(
          HandlerTestLayer,
          withFetch(() => Promise.resolve(new Response("", { status: 503 }))),
        ),
      )),
    ))

  it.effect("should return Unhealthy for services returning non-2xx non-retryable status", () =>
    Effect.gen(function*() {
      const result = yield* handleHealth(healthArgs())

      expect(result).toEqual({
        Kanidm: "Unhealthy",
        Jellyfin: "Unhealthy",
        "Step-CA": "Unhealthy",
      })
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Status_Health"])),
        ),
        Layer.provideMerge(
          HandlerTestLayer,
          withFetch(() => Promise.resolve(new Response("", { status: 403 }))),
        ),
      )),
    ))

  it.effect("should return Unreachable for network errors", () =>
    Effect.gen(function*() {
      const result = yield* handleHealth(healthArgs())

      expect(result).toEqual({
        Kanidm: "Unreachable",
        Jellyfin: "Unreachable",
        "Step-CA": "Unreachable",
      })
    }).pipe(
      Effect.provide(Layer.provideMerge(
        withIdentity(
          new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Status_Health"])),
        ),
        Layer.provideMerge(
          HandlerTestLayer,
          withFetch(() => Promise.reject(new Error("ECONNREFUSED"))),
        ),
      )),
    ))
})
