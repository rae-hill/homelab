import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleDns } from "../../../src/handlers/mobile-config/dns.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const dnsArgs = (overrides?: {
  profile?: Homelab.MobileConfigEndpoints.Dns.DnsHandlerArgs["params"]["profile"]
  name?: string
  ssid?: string
}): Homelab.MobileConfigEndpoints.Dns.DnsHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
  query: {
    ...(overrides?.name ? { name: overrides.name } : {}),
    ...(overrides?.ssid ? { ssid: overrides.ssid } : {}),
  },
  params: { profile: overrides?.profile ?? "private_homelab" },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Config_DNS"]),
)

describe("handleDns", () => {
  describe("authorization", () => {
    it.effect("should deny access when identity lacks Config_DNS permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleDns(dnsArgs()))

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable([]))),
          HandlerTestLayer,
        )),
      ))
  })

  describe("validation", () => {
    it.effect("should reject private_homelab_resolver_only without ssid", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleDns(dnsArgs({ profile: "private_homelab_resolver_only" })))

        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("should generate DNS profile for private_homelab", () =>
      Effect.gen(function*() {
        const result = yield* handleDns(dnsArgs())

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("should generate DNS profile for private_homelab_resolver_only with ssid", () =>
      Effect.gen(function*() {
        const result = yield* handleDns(dnsArgs({ profile: "private_homelab_resolver_only", ssid: "MyNetwork" }))

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("should default name to identity principle", () =>
      Effect.gen(function*() {
        const result = yield* handleDns(dnsArgs())

        expect(result).toContain("user")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })
})
