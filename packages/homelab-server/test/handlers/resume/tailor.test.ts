import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware, Schemas, Services, Utils } from "homelab-services"
import { Layers } from "homelab-services-node"
import { ResumeContent } from "shared"
import { handleResumeTailor } from "../../../src/handlers/resume/tailor.js"
import { HandlerTestLayer, TestSerialNumberConfig } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) => Layer.succeed(Middleware.CurrentIdentity, identity)

/** A stub TailorService layer; override `tailorResume` per test where needed. */
const withTailor = (
  impl: Partial<Services.TailorService.TailorServiceDef> = {},
) =>
  Layer.succeed(Services.TailorService.TailorService, {
    tailorResume: () => Effect.succeed(sampleTailorResponse),
    ...impl,
  })

const sampleTailorContent = ResumeContent.INITIAL_CONTENT_STATE

/** Fully populated stub response respecting the doc-01 wire shapes (nullable stages OK). */
const sampleTailorResponse: Services.TailorService.TailorResult = {
  jobTitle: "Senior Software Engineer",
  company: "Acme Corp",
  content: sampleTailorContent,
  baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
  fit: {
    verdict: "partial",
    summary: "Strong TypeScript overlap; cloud experience only partially covered.",
    tips: [],
    keywordCoverage: {
      required: ["TypeScript", "Kubernetes"],
      matched: ["TypeScript"],
      missing: ["Kubernetes"],
    },
  },
  meta: {
    stage1: null,
    stage2: null,
    degraded: false,
    cacheHit: false,
    contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
    listingHash: "1111111111111111111111111111111111111111111111111111111111111111",
    promptVersion: "v1",
    schemaVersion: "v1",
  },
  changes: [
    {
      patch: {
        op: "replace" as const,
        path: "/blurb",
        value: "Tailored blurb",
      },
      previous: "Original blurb",
    },
  ],
}

const tailorArgs = (overrides?: {
  listing?: string
  content?: ResumeContent.ContentState
  baseVersion?: string
  policy?: Schemas.ResumeTailor.TailorValidationPolicy
}): Homelab.ResumeEndpoints.Tailor.ResumeTailorHandlerArgs => ({
  request: {} as any,
  endpoint: {} as any,
  group: {} as any,
  headers: {},
  payload: {
    listing: overrides?.listing ?? "Senior engineer with TypeScript experience wanted.",
    content: overrides?.content ?? sampleTailorContent,
    baseVersion: overrides?.baseVersion ?? ResumeContent.CONTENT_DEFAULTS_VERSION,
    policy: overrides?.policy ?? {
      enabled: false,
      requireTagsGloballyAvailable: true,
      rejectFabricatedMetrics: true,
      groundTipsInListing: true,
    },
  },
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["Resume_Tailor"]),
)

/**
 * Real authorization chain with every feature flag forced off. HandlerTestLayer pins
 * `FEATURE_FLAGS=*`, so the only way to exercise the flag step is to override the
 * FeatureFlagService feeding AuthorizationService (mirrors the services-node TestLayer).
 */
const flagOffAuth = Layers.AuthorizationService.AuthorizationServiceLive.pipe(
  Layer.provideMerge(Layers.FineGrainedAuthorizationService.FineGrainedAuthorizationServiceLive),
  Layer.provideMerge(TestSerialNumberConfig),
  Layer.provide(Layer.succeed(Services.FeatureFlagService.FeatureFlagService, { enabled: () => false })),
)

describe("handleResumeTailor", () => {
  describe("authorization", () => {
    it.effect("rejects identity without Resume_Tailor permission", () => {
      const unauthorized = new Identity.OIDCIdentity("user@example.com", HashSet.empty())
      return Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(unauthorized),
          HandlerTestLayer,
          withTailor(),
        )),
      )
    })

    it.effect("rejects guest identity", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(new Identity.GuestIdentity()),
          HandlerTestLayer,
          withTailor(),
        )),
      ))

    it.effect("rejects when the Resume_Tailor feature flag is off", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          Layer.provideMerge(HandlerTestLayer, flagOffAuth),
          withTailor(),
        )),
      ))
  })

  describe("happy path", () => {
    it.effect("returns the tailor service response verbatim", () =>
      Effect.gen(function*() {
        const result = yield* handleResumeTailor(tailorArgs())
        expect(result).toEqual(sampleTailorResponse)
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor(),
        )),
      ))

    it.effect("forwards subject, listing, content, baseVersion, and policy to the tailor service", () => {
      const calls: Array<
        [string, string, ResumeContent.ContentState, string, Schemas.ResumeTailor.TailorValidationPolicy]
      > = []
      const listing = "Need a DevOps architect fluent in Nix."
      const policy: Schemas.ResumeTailor.TailorValidationPolicy = {
        enabled: true,
        requireTagsGloballyAvailable: true,
        rejectFabricatedMetrics: true,
        groundTipsInListing: true,
      }
      return Effect.gen(function*() {
        const args = tailorArgs({ listing, policy })
        const result = yield* handleResumeTailor(args)
        expect(result).toEqual(sampleTailorResponse)
        expect(calls).toEqual([[
          "user@example.com",
          listing,
          sampleTailorContent,
          ResumeContent.CONTENT_DEFAULTS_VERSION,
          policy,
        ]])
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor({
            tailorResume: (subject, forwardedListing, content, baseVersion, forwardPolicy) =>
              Effect.as(
                Effect.sync(() => calls.push([subject, forwardedListing, content, baseVersion, forwardPolicy!])),
                sampleTailorResponse,
              ),
          }),
        )),
      )
    })

    // NOTE: The live pipeline no longer produces degraded results (meta.degraded is always false).
    // This test verifies the handler's pass-through semantics for success responses, which remains
    // unchanged — if a service implementation were to return degraded results, the handler would
    // pass them through as 200 OK.
    it.effect("passes degraded results through as successes", () => {
      const degraded = {
        ...sampleTailorResponse,
        meta: { ...sampleTailorResponse.meta, degraded: true },
      }
      return Effect.gen(function*() {
        const result = yield* handleResumeTailor(tailorArgs())
        expect(result).toEqual(degraded)
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor({ tailorResume: () => Effect.succeed(degraded) }),
        )),
      )
    })

    it.effect("maps TailorQuotaExceeded to BadRequest with the quota reason", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs()))
        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
        expect(result.reason).toBe("resume-tailor-quota-exceeded")
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor({
            tailorResume: () =>
              Effect.fail(new Services.TailorService.TailorQuotaExceeded({ retryAfterSeconds: 3600 })),
          }),
        )),
      ))
  })

  describe("error cases", () => {
    it.effect("rejects a stale baseVersion with BadRequest and the mismatch reason", () =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs({ baseVersion: "v0-bogus" })))
        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
        expect(result.reason).toBe("resume-tailor-base-version-mismatch")
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor(),
        )),
      ))

    it.effect("maps TailorError to InternalServerError with raw error in error field", () => {
      const nestedError = new Error("provider connection failed")
      return Effect.gen(function*() {
        const result = yield* Effect.flip(handleResumeTailor(tailorArgs()))
        assert(
          result instanceof ApiErrors.InternalServerError,
          `Expected InternalServerError, got ${result._tag ?? result}`,
        )
        // Message is now short context; the error field carries the nested error JSON
        // (services store `Utils.errorToJson(raw)` — Schema.Defect encode; handler passes through)
        expect(result.message).toContain("Stage 2")
        expect(result.error).toEqual({ name: "Error", message: "provider connection failed" })
      }).pipe(
        Effect.provide(Layer.mergeAll(
          withIdentity(authorizedIdentity),
          HandlerTestLayer,
          withTailor({
            tailorResume: () =>
              Effect.fail(
                new Services.TailorService.TailorError({
                  message: "Stage 2 (tailor) failed",
                  error: Utils.errorToJson(nestedError),
                }),
              ),
          }),
        )),
      )
    })
  })
})
