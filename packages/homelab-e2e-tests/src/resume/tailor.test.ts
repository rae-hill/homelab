import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpBody, HttpClient } from "effect/http"
import { ApiErrors } from "homelab-services"
import { ResumeContent } from "shared"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeAccessTokenDPoP,
  makeApiClient,
  TEST_API_KEY,
  TEST_LIMITED_API_KEY,
} from "../../test-utils/index.js"

/**
 * The success test spends real provider money (OpenRouter), so it only runs on explicit
 * opt-in (`RUN_TAILOR_LIVE=1`); CI always skips it. The server needs the OpenRouter key
 * in its env (doc 05) when enabled.
 */
const describeLive = process.env.RUN_TAILOR_LIVE ? describe : describe.skip

const ENDPOINT_URL = new URL(`${BASE_URL}/resume/tailor`)

/**
 * A minimal-but-complete content state, typed against the SHARED schema — the typed
 * client encodes it to the base64 JSON Patch on the wire automatically (D3), so this
 * fixture can never drift from what the backend accepts.
 */
const fixtureContent: ResumeContent.ContentState = {
  blurb: "Agentic developer seeking a software engineering role.",
  aboutMe: "Dedicated to the craft of principled engineering.",
  experience: [
    {
      id: "acme",
      company: "Acme Corp",
      location: "Denver, CO",
      roles: [{ title: "Software Engineer", date: "2020 – 2024" }],
      description: "Built things.",
      bulletPoints: [{ id: "acme__b0", text: "Shipped features", visible: true }],
      tags: ["TypeScript", "Effect"],
    },
  ],
  projects: [
    {
      id: "proj",
      title: "A Project",
      description: "Does things",
      githubLink: "https://github.com/acme/proj",
      tags: ["Vite"],
    },
  ],
  skills: ["TypeScript", "Effect", "Nix"],
}

const fixtureListing = "Senior Software Engineer. TypeScript, Effect, Nix. 5+ years experience."

describe("POST /resume/tailor", () => {
  describe("authorization", () => {
    it.live("rejects a token without the Resume_Tailor role", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)
        const dpopProof = yield* createToken({
          htu: ENDPOINT_URL,
          htm: "POST",
          nonce,
          accessToken: access_token,
        })
        const result = yield* Effect.flip(
          client.resume.tailor({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
              policy: {
                enabled: false,
                requireTagsGloballyAvailable: true,
                rejectFabricatedMetrics: true,
                groundTipsInListing: true,
              },
            },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("rejects an unauthenticated (guest) request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const result = yield* Effect.flip(
          client.resume.tailor({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
              policy: {
                enabled: false,
                requireTagsGloballyAvailable: true,
                rejectFabricatedMetrics: true,
                groundTipsInListing: true,
              },
            },
            headers: {},
          }),
        )
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("validation", () => {
    it.live("rejects a stale baseVersion with BadRequest and the mismatch reason", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* createToken({
          htu: ENDPOINT_URL,
          htm: "POST",
          nonce,
          accessToken: access_token,
        })
        const result = yield* Effect.flip(
          client.resume.tailor({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: "v0-bogus",
              policy: {
                enabled: false,
                requireTagsGloballyAvailable: true,
                rejectFabricatedMetrics: true,
                groundTipsInListing: true,
              },
            },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )
        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${result._tag ?? result}`,
        )
        expect(result.reason).toBe("resume-tailor-base-version-mismatch")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("server-side rejects content that is not valid patch-base64", () =>
      Effect.gen(function*() {
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* makeAccessTokenDPoP(access_token, nonce, ENDPOINT_URL, "POST")
        // Not decodable base64 — the typed client would refuse to encode this, so go
        // raw to exercise the server's edge decode (ContentPatchBase64).
        const response = yield* HttpClient.post(`${BASE_URL}/resume/tailor`, {
          headers: {
            authorization: `${token_type} ${access_token}`,
            dpop: dpopProof,
          },
          body: HttpBody.jsonUnsafe({
            listing: fixtureListing,
            content: "@@@not-base64@@@",
            baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
          }),
        })
        expect(response.status).toBe(400)
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describeLive("success — live AI", () => {
    /**
     * Server environment requirements (doc 05): OPENROUTER_API_KEY (or the nix-managed
     * equivalent env) so the two-stage pipeline can reach OpenRouter.
     */
    it.live(
      "tailors content for an authorized DPoP token",
      () =>
        Effect.gen(function*() {
          const client = yield* makeApiClient
          const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
          const dpopProof = yield* createToken({
            htu: ENDPOINT_URL,
            htm: "POST",
            nonce,
            accessToken: access_token,
          })
          const result = yield* client.resume.tailor({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
              policy: {
                enabled: false,
                requireTagsGloballyAvailable: true,
                rejectFabricatedMetrics: true,
                groundTipsInListing: true,
              },
            },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(result.jobTitle.length).toBeGreaterThan(0)
          expect(result.baseVersion).toBe(ResumeContent.CONTENT_DEFAULTS_VERSION)
          // content roundtrips through the client codec back to a full ContentState
          expect(Array.isArray(result.content.experience)).toBe(true)
          expect(Array.isArray(result.content.projects)).toBe(true)
          expect(result.content.skills.length).toBeGreaterThan(0)
          expect(result.fit).toBeDefined()
          expect(result.meta).toBeDefined()
          expect(Array.isArray(result.changes)).toBe(true)
        }).pipe(Effect.provide(E2ETestLayer)),
      180_000, // 2x60s stage budgets + margin
    )
  })
})
