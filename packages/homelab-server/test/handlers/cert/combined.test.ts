import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleCombined } from "../../../src/handlers/cert/combined.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const combinedArgs = (): Homelab.CertEndpoints.Combined.CombinedCertHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Cert_Combined"]),
)

describe("handleCombined", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Cert_Combined permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleCombined(combinedArgs()))
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

  describe("happy path", () => {
    it.effect("returns combined PEM certificate", () =>
      Effect.gen(function*() {
        const result = yield* handleCombined(combinedArgs())
        expect(result).toBeInstanceOf(Uint8Array)
        const text = Buffer.from(result).toString("utf-8")
        expect(text).toContain("-----BEGIN CERTIFICATE-----")
      }).pipe(
        Effect.provide(Layer.provideMerge(withIdentity(authorizedIdentity), HandlerTestLayer)),
      ))

    it.effect("allows guest identity", () =>
      Effect.gen(function*() {
        const result = yield* handleCombined(combinedArgs())
        expect(result).toBeInstanceOf(Uint8Array)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
        )),
      ))
  })
})
