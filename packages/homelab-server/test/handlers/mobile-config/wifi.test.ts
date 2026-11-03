import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleWifi } from "../../../src/handlers/mobile-config/wifi.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const wifiArgs = (overrides?: {
  ssid?: string
  encryption?: "WPA3" | "WPA2"
  password?: string
  username?: string
  disableMACRandomization?: boolean
  enterpriseClientType?: "PEAP" | "EAP-TLS"
  includeEthernetProfile?: boolean
}): Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs => {
  const enterpriseClientType = overrides?.enterpriseClientType
    ?? (overrides?.username !== undefined ? "PEAP" : undefined)

  const payload = enterpriseClientType === "PEAP"
    ? {
      enterpriseClientType: "PEAP" as const,
      username: overrides?.username ?? "test",
      password: overrides?.password ?? "test-password",
      disableMACRandomization: overrides?.disableMACRandomization ?? false,
      includeEthernetProfile: overrides?.includeEthernetProfile ?? false,
    }
    : enterpriseClientType === "EAP-TLS"
    ? {
      enterpriseClientType: "EAP-TLS" as const,
      disableMACRandomization: overrides?.disableMACRandomization ?? false,
      includeEthernetProfile: overrides?.includeEthernetProfile ?? false,
    }
    : {
      password: overrides?.password ?? "test-password",
      disableMACRandomization: overrides?.disableMACRandomization ?? false,
    }

  return {
    params: {
      ssid: overrides?.ssid ?? "0x676179",
      encryption: overrides?.encryption ?? "WPA3" as const,
    },
    payload,
    query: {},
    request: {} as any,
    endpoint: {} as any,
    group: {} as any,
    headers: {},
  } as Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs
}

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Config_Wifi"]),
)

describe("handleWifi", () => {
  describe("authorization", () => {
    it.effect("should deny access when identity lacks Config_Wifi permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifi(wifiArgs()))

        assert(result instanceof ApiErrors.AuthorizationError)
        expect(result.resource).toBe("Config_Wifi")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(
            new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable(["Status_Health"])),
          ),
          HandlerTestLayer,
        )),
      ))

    it.effect("should deny access with empty permissions", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifi(wifiArgs()))

        assert(result instanceof ApiErrors.AuthorizationError)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(
            new Identity.OIDCIdentity("user@example.com", HashSet.fromIterable([])),
          ),
          HandlerTestLayer,
        )),
      ))

    it.effect("should deny when OIDC identity principle does not match username", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifi(wifiArgs({ username: "alice" })))

        assert(result instanceof ApiErrors.AuthorizationError)
        expect(result.message).toBe("User's principle identifer must match the requested username")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(
            new Identity.OIDCIdentity("john@example.com", HashSet.fromIterable(["Config_Wifi"])),
          ),
          HandlerTestLayer,
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("should generate WPA personal wifi profile", () =>
      Effect.gen(function*() {
        const result = yield* handleWifi(wifiArgs())

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
        expect(result).toContain("0x676179")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("should generate WPA2 wifi profile", () =>
      Effect.gen(function*() {
        const result = yield* handleWifi(wifiArgs({ encryption: "WPA2" }))

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("should generate enterprise PEAP wifi profile with matching username", () =>
      Effect.gen(function*() {
        const result = yield* handleWifi(wifiArgs({
          enterpriseClientType: "PEAP",
          username: "user",
        }))

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("EAP-TLS", () => {
    it.effect("should return AuthorizationError for unrecognized IP", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifi(wifiArgs({
          enterpriseClientType: "EAP-TLS",
        })))

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("internal errors", () => {
    it.effect("should return NotFound for unknown SSID", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifi(wifiArgs({ ssid: "unknown-ssid" })))

        assert(result instanceof ApiErrors.NotFound)
        expect(result.reason).toBe("ssid-not-found")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("ethernet profile", () => {
    it.effect("should include ethernet payload when includeEthernetProfile is true for PEAP", () =>
      Effect.gen(function*() {
        const result = yield* handleWifi(wifiArgs({
          enterpriseClientType: "PEAP",
          username: "user",
          includeEthernetProfile: true,
        }))

        expect(result).toContain("com.apple.globalethernet.managed")
        expect(result).toContain("1674d657-58d2-4f31-83c4-abe0530f0fef")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))

    it.effect("should not include ethernet payload when includeEthernetProfile is false for PEAP", () =>
      Effect.gen(function*() {
        const result = yield* handleWifi(wifiArgs({
          enterpriseClientType: "PEAP",
          username: "user",
          includeEthernetProfile: false,
        }))

        expect(result).not.toContain("com.apple.firstactiveethernet.managed")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
        )),
      ))
  })
})
