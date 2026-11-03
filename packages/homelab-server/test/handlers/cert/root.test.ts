import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleRoot } from "../../../src/handlers/cert/root.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const rootArgs = (format: "crt" | "der" = "der"): Homelab.CertEndpoints.Root.RootCertHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
  params: { format },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Cert_Root"]),
)

describe("handleRoot", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Cert_Root permission", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleRoot(rootArgs()))
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
    it.effect("returns DER certificate when format is der", () =>
      Effect.gen(function*() {
        const result = yield* handleRoot(rootArgs("der"))
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result.length).toBeGreaterThan(0)
      }).pipe(
        Effect.provide(Layer.provideMerge(withIdentity(authorizedIdentity), HandlerTestLayer)),
      ))

    it.effect("returns CRT certificate when format is crt", () =>
      Effect.gen(function*() {
        const result = yield* handleRoot(rootArgs("crt"))
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result.length).toBeGreaterThan(0)
      }).pipe(
        Effect.provide(Layer.provideMerge(withIdentity(authorizedIdentity), HandlerTestLayer)),
      ))

    it.effect("allows guest identity", () =>
      Effect.gen(function*() {
        const result = yield* handleRoot(rootArgs("der"))
        expect(result).toBeInstanceOf(Uint8Array)
      }).pipe(
        Effect.provide(Layer.provideMerge(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
        )),
      ))
  })
})
