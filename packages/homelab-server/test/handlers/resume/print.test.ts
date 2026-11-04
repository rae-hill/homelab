import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware, Services } from "homelab-services"
import { handleResumePrint } from "../../../src/handlers/resume/print.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

/** A stub PdfPrintService layer; override `printResume` per test where needed. */
const withPdfPrint = (
  impl: Partial<Services.PdfPrintService.PdfPrintServiceDef> = {},
) =>
  Layer.succeed(Services.PdfPrintService.PdfPrintService, {
    printResume: () => Effect.succeed(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    ...impl,
  })

const printArgs = (overrides?: {
  config?: string
  theme?: "light" | "dark"
}): Homelab.ResumeEndpoints.Print.ResumePrintHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
  payload: { config: overrides?.config ?? "eyJ0b2dnbGVzIjp7fX0=" },
  query: { theme: overrides?.theme ?? "light" },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Resume_Print"]),
)

describe("handleResumePrint", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Resume_Print permission", () => {
      const unauthorized = new Identity.OIDCIdentity("user@example.com", HashSet.empty())
      return Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumePrint(printArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(unauthorized),
          HandlerTestLayer,
          withPdfPrint(),
        )),
      )
    })

    it.effect("rejects guest identity", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumePrint(printArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
          withPdfPrint(),
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("returns the PDF bytes from the print service", () =>
      Effect.gen(function*() {
        const result = yield* handleResumePrint(printArgs())
        expect(result).toBeInstanceOf(Uint8Array)
        // "%PDF" magic
        expect(Array.from(result.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withPdfPrint(),
        )),
      ))

    it.effect("forwards the config blob and theme to the print service", () => {
      const calls: Array<[string, "light" | "dark"]> = []
      return Effect.gen(function*() {
        const result = yield* handleResumePrint(
          printArgs({ config: "config-blob", theme: "dark" }),
        )
        expect(result).toBeInstanceOf(Uint8Array)
        expect(calls).toEqual([["config-blob", "dark"]])
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withPdfPrint({
            printResume: (config, theme) =>
              Effect.as(
                Effect.sync(() => calls.push([config, theme])),
                new Uint8Array([0x25]),
              ),
          }),
        )),
      )
    })
  })

  describe("error cases", () => {
    it.effect("maps PdfPrintError to InternalServerError", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumePrint(printArgs()))
        assert(
          result instanceof ApiErrors.InternalServerError,
          `Expected InternalServerError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withPdfPrint({
            printResume: () =>
              new Services.PdfPrintService.PdfPrintError({
                message: "chrome exploded",
                error: null,
              }),
          }),
        )),
      ))
  })
})
