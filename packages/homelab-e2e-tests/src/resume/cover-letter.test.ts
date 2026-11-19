import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpBody, HttpClient } from "effect/http"
import { ApiErrors } from "homelab-services"
import { ResumeContent } from "shared"
import { writeFileSync } from "node:fs"
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
 * opt-in (`RUN_COVER_LETTER_LIVE=1`); CI always skips it. The server needs the OpenRouter key
 * and TYPST_ASSETS_DIR in its env (doc 05) when enabled.
 */
const describeLive = process.env.RUN_COVER_LETTER_LIVE ? describe : describe.skip

const ENDPOINT_URL = new URL(`${BASE_URL}/resume/cover-letter`)

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

describe("POST /resume/cover-letter", () => {
  describe("authorization", () => {
    it.live("rejects a token without the Resume_CoverLetter role", () =>
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
          client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
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
          client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
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
          client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: "v0-bogus",
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
        expect(result.reason).toBe("resume-cover-letter-base-version-mismatch")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("server-side rejects content that is not valid base64", () =>
      Effect.gen(function*() {
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* makeAccessTokenDPoP(access_token, nonce, ENDPOINT_URL, "POST")
        // Not decodable base64 — the typed client would refuse to encode this, so go
        // raw to exercise the server's edge decode (ContentPatchBase64).
        const response = yield* HttpClient.post(`${BASE_URL}/resume/cover-letter`, {
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

  describeLive("success — live AI + typst", () => {
    /**
     * Server environment requirements (doc 05): OPENROUTER_API_KEY (or the nix-managed
     * equivalent env) + TYPST_ASSETS_DIR so the cover-letter pipeline can reach OpenRouter
     * and render PDFs via typst.ts.
     */
    it.live(
      "renders a PDF cover letter for an authorized DPoP token",
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
          const pdf = yield* client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
            },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(pdf).toBeInstanceOf(Uint8Array)
          // "%PDF" magic bytes
          expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
          expect(pdf.length).toBeGreaterThan(1000)

          // Optional artifact for the owner fidelity gate (doc 03 §G):
          //   COVER_LETTER_SAMPLE_PATH=/tmp/opencode/cover-letter-sample.pdf e2e src/resume/cover-letter
          const samplePath = process.env.COVER_LETTER_SAMPLE_PATH
          if (typeof samplePath === "string" && samplePath.length > 0) {
            writeFileSync(samplePath, pdf)
          }
        }).pipe(Effect.provide(E2ETestLayer)),
      240_000, // AI generation + typst render
    )

    it.live(
      "exercises the listing cleanup cache on repeated calls with the same listing",
      () =>
        Effect.gen(function*() {
          const client = yield* makeApiClient
          const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

          // First call
          const dpopProof1 = yield* createToken({
            htu: ENDPOINT_URL,
            htm: "POST",
            nonce,
            accessToken: access_token,
          })
          const pdf1 = yield* client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
            },
            headers: {
              dpop: dpopProof1,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(pdf1).toBeInstanceOf(Uint8Array)
          expect(Array.from(pdf1.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])

          // Second call with the SAME listing — exercises the cleanup cache
          // (second request should succeed; exact cache behavior is unit-tested elsewhere)
          const dpopProof2 = yield* createToken({
            htu: ENDPOINT_URL,
            htm: "POST",
            nonce,
            accessToken: access_token,
          })
          const pdf2 = yield* client.resume["cover-letter"]({
            payload: {
              listing: fixtureListing,
              content: fixtureContent,
              baseVersion: ResumeContent.CONTENT_DEFAULTS_VERSION,
            },
            headers: {
              dpop: dpopProof2,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(pdf2).toBeInstanceOf(Uint8Array)
          expect(Array.from(pdf2.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
          expect(pdf2.length).toBeGreaterThan(1000)
        }).pipe(Effect.provide(E2ETestLayer)),
      240_000, // Two full AI generations + typst renders
    )
  })
})
