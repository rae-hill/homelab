import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ApiErrors } from "homelab-services"
import { PrintConfig } from "shared"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeApiClient,
  TEST_API_KEY,
  TEST_LIMITED_API_KEY,
} from "../../test-utils/index.js"

const ENDPOINT_URL = new URL(`${BASE_URL}/resume/print`)

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
            query: { theme: "light" },
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
            query: { theme: "light" },
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )
        // The exact client-side error type for schema rejections varies (declared
        // BadRequest vs. transport-level schema error); the contract we care about is
        // that the request never succeeds. Strict codec behavior is unit-tested in
        // packages/shared/test/print-config.test.ts.
        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    /**
     * Server environment requirements for this test (see .env-local of the dev server):
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
            query: { theme: "light" },
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
  })
})
