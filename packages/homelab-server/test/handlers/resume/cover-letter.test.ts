import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware, Services } from "homelab-services"
import { Layers } from "homelab-services-node"
import { ResumeContent } from "shared"
import { handleResumeCoverLetter } from "../../../src/handlers/resume/cover-letter.js"
import { HandlerTestLayer, TestSerialNumberConfig } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

/** A stub CoverLetterService layer; override `generateCoverLetter` per test where needed. */
const withCoverLetter = (
  impl: Partial<Services.CoverLetterService.CoverLetterServiceDef> = {},
) =>
  Layer.succeed(Services.CoverLetterService.CoverLetterService, {
    generateCoverLetter: () => Effect.succeed(PDF_BYTES),
    ...impl,
  })

const coverLetterArgs = (overrides?: {
  listing?: string
  content?: ResumeContent.ContentState
  baseVersion?: string
}): Homelab.ResumeEndpoints.CoverLetter.ResumeCoverLetterHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
  payload: {
    listing: overrides?.listing ?? "Senior engineer with TypeScript experience wanted.",
    content: overrides?.content ?? ResumeContent.INITIAL_CONTENT_STATE,
    baseVersion: overrides?.baseVersion ?? ResumeContent.CONTENT_DEFAULTS_VERSION,
  },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Resume_CoverLetter"]),
)

/**
 * Real authorization chain with every feature flag forced off. HandlerTestLayer pins
 * `FEATURE_FLAGS=*`, so the only way to exercise the flag step is to override the
 * FeatureFlagService feeding AuthorizationService (tailor.test.ts precedent).
 */
const flagOffAuth = Layers.AuthorizationService.AuthorizationServiceLive.pipe(
  Layer.provideMerge(Layers.FineGrainedAuthorizationService.FineGrainedAuthorizationServiceLive),
  Layer.provideMerge(TestSerialNumberConfig),
  Layer.provide(Layer.succeed(Services.FeatureFlagService.FeatureFlagService, { enabled: () => false })),
)

describe("handleResumeCoverLetter", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Resume_CoverLetter permission", () => {
      const unauthorized = new Identity.OIDCIdentity("user@example.com", HashSet.empty())
      return Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeCoverLetter(coverLetterArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(unauthorized),
          HandlerTestLayer,
          withCoverLetter(),
        )),
      )
    })

    it.effect("rejects guest identity", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeCoverLetter(coverLetterArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
          withCoverLetter(),
        )),
      ))

    it.effect("rejects when the Resume_CoverLetter feature flag is off", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeCoverLetter(coverLetterArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          Layer.provideMerge(HandlerTestLayer, flagOffAuth),
          withCoverLetter(),
        )),
      ))
  })

  describe("validation", () => {
    it.effect("rejects a stale baseVersion with a BadRequest", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(
          handleResumeCoverLetter(coverLetterArgs({ baseVersion: "v0-stale" })),
        )
        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
        expect(result.reason).toBe("resume-cover-letter-base-version-mismatch")
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withCoverLetter(),
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("returns the PDF bytes from the cover-letter service", () =>
      Effect.gen(function*() {
        const result = yield* handleResumeCoverLetter(coverLetterArgs())
        expect(result).toBeInstanceOf(Uint8Array)
        expect(Array.from(result.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withCoverLetter(),
        )),
      ))

    it.effect("forwards the identity, listing, decoded content, and baseVersion to the service", () => {
      const calls: Array<[string, string, string]> = []
      return Effect.gen(function*() {
        const result = yield* handleResumeCoverLetter(
          coverLetterArgs({ listing: "A specific listing", baseVersion: "v1" }),
        )
        expect(result).toBeInstanceOf(Uint8Array)
        expect(calls).toEqual([["user@example.com", "A specific listing", "v1"]])
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withCoverLetter({
            generateCoverLetter: (subject, listing, _content, baseVersion) =>
              Effect.as(
                Effect.sync(() => calls.push([subject, listing, baseVersion])),
                PDF_BYTES,
              ),
          }),
        )),
      )
    })
  })

  describe("error mapping", () => {
    it.effect("maps TailorQuotaExceeded to a BadRequest with the quota reason", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeCoverLetter(coverLetterArgs()))
        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
        expect(result.reason).toBe("resume-cover-letter-quota-exceeded")
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withCoverLetter({
            generateCoverLetter: () =>
              Effect.fail(new Services.TailorService.TailorQuotaExceeded({ retryAfterSeconds: 1234 })),
          }),
        )),
      ))

    it.effect("maps CoverLetterError to InternalServerError with the raw nested cause", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeCoverLetter(coverLetterArgs()))
        assert(
          result instanceof ApiErrors.InternalServerError,
          `Expected InternalServerError, got ${result._tag ?? result}`,
        )
        expect(result.message).toContain("Stage 2 (generation) failed")
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withCoverLetter({
            generateCoverLetter: () =>
              Effect.fail(
                new Services.CoverLetterService.CoverLetterError({
                  message: "Stage 2 (generation) failed",
                  error: { nested: "cause" },
                }),
              ),
          }),
        )),
      ))
  })
})
