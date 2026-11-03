import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleWifiDownload } from "../../../src/handlers/mobile-config/wifi-download.js"
import { generateWifiProfile } from "../../../src/handlers/mobile-config/wifi.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const downloadArgs = (overrides?: {
  ssid?: string
  encryption?: "WPA3" | "WPA2"
  password?: string
}): Homelab.MobileConfigEndpoints.WifiDownload.WifiMobileConfigDownloadHandlerArgs => ({
  params: {
    ssid: overrides?.ssid ?? "0x676179",
    encryption: overrides?.encryption ?? "WPA3" as const,
  },
  query: {
    password: overrides?.password ?? "test-password",
    disableMACRandomization: false,
    enterpriseClientType: "None" as const,
  },
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
})

const viewOnlyIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Config_Wifi.view"]),
)

const fullAccessIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Config_Wifi"]),
)

describe("handleWifiDownload", () => {
  describe("authorization", () => {
    it.effect("should deny access when identity lacks Config_Wifi permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleWifiDownload(downloadArgs()))

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

    it.effect("should allow view-only permission (does not require create)", () =>
      Effect.gen(function*() {
        const result = yield* handleWifiDownload(downloadArgs())

        expect(result).toContain("<?xml")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(viewOnlyIdentity),
          HandlerTestLayer,
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("should generate wifi profile via download", () =>
      Effect.gen(function*() {
        const result = yield* handleWifiDownload(downloadArgs())

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
        expect(result).toContain("0x676179")
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(fullAccessIdentity),
          HandlerTestLayer,
        )),
      ))
  })
})

describe("generateWifiProfile (shared logic)", () => {
  it.effect("should generate profile without authorization context", () =>
    Effect.gen(function*() {
      const result = yield* generateWifiProfile({
        params: { ssid: "dialup-express", encryption: "WPA3" as const },
        payload: { password: "secret", disableMACRandomization: false },
        query: {},
        request: {} as any,
        endpoint: {} as any,
        group: {} as any,
        headers: {},
      } as Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs)

      expect(result).toContain("<?xml")
      expect(result).toContain("dialup-express")
    }).pipe(
      Effect.provide(HandlerTestLayer),
    ))
})
