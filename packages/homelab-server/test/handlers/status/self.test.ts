import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer, Option } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware, type Schemas } from "homelab-services"
import { handleSelf } from "../../../src/handlers/status/self.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const selfArgs = (overrides?: {
  "x-forwarded-for"?: string
}): Homelab.StatusEndpoints.Self.SelfEndpointHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {
    ...(overrides?.["x-forwarded-for"] != null
      && { "x-forwarded-for": overrides["x-forwarded-for"] as Schemas.IpAddress.IpAddress }),
  },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Status_Self"]),
  "user",
  "User Name",
)

describe("handleSelf", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Status_Self permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleSelf(selfArgs({ "x-forwarded-for": "192.168.1.1" })))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(new Identity.OIDCIdentity("user@example.com", HashSet.empty())),
          HandlerTestLayer,
        )),
      ))
  })

  describe("error cases", () => {
    it.effect("returns InternalServerError when x-forwarded-for is missing", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleSelf(selfArgs()))
        assert(
          result instanceof ApiErrors.InternalServerError,
          `Expected InternalServerError, got ${result._tag ?? result}`,
        )
        expect(result.message).toBe("missing X-Forwarded-For header")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("returns isTailscale false for non-tailscale IP", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "192.168.1.1" }))
        expect(result.isTailscale).toBe(false)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("returns isTailscale true for Tailscale IPv4", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "100.64.0.1" }))
        expect(result.isTailscale).toBe(true)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("returns isTailscale true for Tailscale IPv6", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "fd7a:115c:a1e0::1" }))
        expect(result.isTailscale).toBe(true)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("returns correct principal and permissions", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "192.168.1.1" }))
        expect(result.principal).toBe("user")
        expect(HashSet.has(result.permissions, "Status_Self")).toBe(true)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("returns fullname from OIDC identity", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "192.168.1.1" }))
        expect(result.fullname).toEqual(Option.some("User Name"))
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("returns fullname none for guest identity", () =>
      Effect.gen(function*() {
        const result = yield* handleSelf(selfArgs({ "x-forwarded-for": "192.168.1.1" }))
        expect(result.fullname).toEqual(Option.none())
        expect(result.principal).toBe("guest")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
        )),
      ))
  })
})
