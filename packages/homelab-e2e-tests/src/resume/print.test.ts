import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { Headers, HttpBody, HttpClient } from "effect/http"
import { ApiErrors } from "homelab-services"
import { writeFileSync } from "node:fs"
import { PrintConfig } from "shared"
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
 * The success test launches headless chrome (server-side) and renders the LIVE
 * resume site, so it only runs where CHROME_EXECUTABLE is set — the devshell
 * provides it (and scripts/e2e.sh mirrors a value from .env-serve-test);
 * CI runners don't, so the test skips there and puppeteer never launches.
 */
const describeWithChrome = (process.env.CHROME_EXECUTABLE ?? "").length > 0 ? describe : describe.skip

const ENDPOINT_URL = new URL(`${BASE_URL}/resume/print`)

/** OOXML word-processing document (DOCX) media type. */
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * A minimal-but-complete valid persisted print config, built against the SHARED schema
 * types and encoded with the SHARED codec — the same wire format the resume SPA's
 * download FAB produces. This is the payoff of extracting the print-config schemas into
 * `shared`: the e2e fixture can never drift from what the frontend/backend accept.
 */
const fixtureConfig: PrintConfig.PersistedConfig = {
  toggles: {
    skills: true,
    experience: true,
    projects: true,
    positionDescription: true,
    positionResponsibilities: true,
    tagCloud: true,
    positionTags: true,
    projectTags: true,
    certification: true,
    education: true,
    address: true,
    phone: true,
    email: true,
    websiteLink: true,
    githubLink: true,
    linkedinLink: true,
  },
  featuredMode: "Inline",
  sections: {
    experience: {
      layout: { kind: "Stacked", order: "TagsBelow" },
      descriptionTextAlign: "left",
      responsibilitiesTextAlign: "left",
      descriptionAlign: { vertical: "center", horizontal: "start" },
      tagAlign: { vertical: "center", horizontal: "center" },
      gap: 3,
      tagDisplay: "Tags",
    },
    projects: {
      layout: { kind: "Stacked", order: "TagsBelow" },
      descriptionTextAlign: "left",
      responsibilitiesTextAlign: "left",
      descriptionAlign: { vertical: "center", horizontal: "start" },
      tagAlign: { vertical: "center", horizontal: "center" },
      gap: 3,
      tagDisplay: "Tags",
    },
  },
  heading: {
    iconTextSize: "md",
    gap: 3,
    contactGap: 3,
    skillListGap: 1,
    nameAlign: { vertical: "center", horizontal: "center" },
    contactAlign: { vertical: "center", horizontal: "center" },
    description: { kind: "Blurb", textAlign: "center" },
  },
  content: {
    blurb: "Agentic developer seeking a software engineering or DevOps role.",
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
  },
}

const fixtureBase64 = PrintConfig.encodePersistedBase64(fixtureConfig)

describe("POST /resume/print", () => {
  describe("authorization", () => {
    it.live("rejects a token without the Resume_Print role", () =>
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
          client.resume.print({
            payload: { config: fixtureBase64 },
            query: { theme: "light", outputFormat: "pdf" },
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
          client.resume.print({
            payload: { config: fixtureBase64 },
            query: { theme: "light", outputFormat: "pdf" },
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
    it.live("rejects a config blob that is not a valid base64 print config", () =>
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
          client.resume.print({
            payload: { config: "definitely-not-a-print-config" },
            query: { theme: "light", outputFormat: "pdf" },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )
        // The exact client-side error type for schema rejections varies (declared
        // BadRequest vs. transport-level schema error); the contract we care about is
        // that the request never succeeds. Strict codec behavior is unit-tested in
        // packages/shared/test/print-config.test.ts. NOTE: the typed client runs the
        // ConfigBase64String check while ENCODING, so this rejection may happen
        // client-side — the raw test below covers the server-side path.
        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("server-side rejects a base64-valid blob whose JSON does not match the schema", () =>
      Effect.gen(function*() {
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* makeAccessTokenDPoP(access_token, nonce, ENDPOINT_URL, "POST")
        // Valid base64, valid JSON — but NOT a PersistedPrintConfig. The typed client
        // would refuse to encode this, so go raw to exercise the server's decoding.
        const blob = Buffer.from(JSON.stringify({ toggles: {} }), "utf-8").toString("base64")
        const response = yield* HttpClient.post(`${BASE_URL}/resume/print`, {
          urlParams: { theme: "light" },
          headers: {
            authorization: `${token_type} ${access_token}`,
            dpop: dpopProof,
          },
          body: HttpBody.jsonUnsafe({ config: blob }),
        })
        expect(response.status).toBe(400)
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describeWithChrome("success", () => {
    /**
     * Server environment requirements for this test (bootstrapped by scripts/e2e.sh — see scripts/stage-e2e-secrets.mjs):
     * - CHROME_EXECUTABLE: path to a chrome/chromium binary (e.g. `which google-chrome`)
     * - RESUME_SITE_URL: a resume build that supports ?importPrintSettings and sets
     *   html[data-print-ready] — either the local vite dev server
     *   (http://localhost:5173, `yarn workspace resume dev`) or the deployed site once
     *   the remote-printing frontend ships. Defaults to https://resume.rae-hill.dev.
     */
    it.live(
      "renders a PDF for an authorized DPoP token",
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
          const pdf = yield* client.resume.print({
            payload: { config: fixtureBase64 },
            query: { theme: "light", outputFormat: "pdf" },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(pdf).toBeInstanceOf(Uint8Array)
          // "%PDF" magic bytes
          expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
        }).pipe(Effect.provide(E2ETestLayer)),
      120_000, // chrome launch + page load + pdf render
    )

    it.live(
      "renders a DOCX for outputFormat=docx",
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
          const docx = yield* client.resume.print({
            payload: { config: fixtureBase64 },
            query: { theme: "light", outputFormat: "docx" },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          })
          expect(docx).toBeInstanceOf(Uint8Array)
          // "PK\x03\x04" ZIP magic (DOCX container). That the TYPED client
          // decoded this response at all also proves it carried the DOCX
          // content-type: the client dispatches on the response content-type
          // among the endpoint's declared success alternatives (doc 08 §C4).
          expect(Array.from(docx.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])

          // Optional artifact for the owner fidelity gate (doc 08 T22):
          //   DOCX_SAMPLE_PATH=/tmp/opencode/resume-sample.docx e2e src/resume
          const samplePath = process.env.DOCX_SAMPLE_PATH
          if (typeof samplePath === "string" && samplePath.length > 0) {
            writeFileSync(samplePath, docx)
          }
        }).pipe(Effect.provide(E2ETestLayer)),
      180_000, // chrome launch + page load + HTML capture + docx conversion
    )

    it.live(
      "serves the format-appropriate content type (raw HTTP)",
      () =>
        Effect.gen(function*() {
          // Default (no outputFormat) → application/pdf
          {
            const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
            const dpopProof = yield* makeAccessTokenDPoP(access_token, nonce, ENDPOINT_URL, "POST")
            const response = yield* HttpClient.post(`${BASE_URL}/resume/print`, {
              urlParams: { theme: "light" },
              headers: {
                authorization: `${token_type} ${access_token}`,
                dpop: dpopProof,
              },
              body: HttpBody.jsonUnsafe({ config: fixtureBase64 }),
            })
            expect(response.status).toBe(200)
            expect(Option.getOrUndefined(Headers.get(response.headers, "content-type"))).toContain(
              "application/pdf",
            )
          }
          // outputFormat=docx → the OOXML word-processing media type
          {
            const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
            const dpopProof = yield* makeAccessTokenDPoP(access_token, nonce, ENDPOINT_URL, "POST")
            const response = yield* HttpClient.post(`${BASE_URL}/resume/print`, {
              urlParams: { theme: "light", outputFormat: "docx" },
              headers: {
                authorization: `${token_type} ${access_token}`,
                dpop: dpopProof,
              },
              body: HttpBody.jsonUnsafe({ config: fixtureBase64 }),
            })
            expect(response.status).toBe(200)
            expect(Option.getOrUndefined(Headers.get(response.headers, "content-type"))).toContain(
              DOCX_CONTENT_TYPE,
            )
          }
        }).pipe(Effect.provide(E2ETestLayer)),
      240_000, // two full chrome renders
    )
  })
})
