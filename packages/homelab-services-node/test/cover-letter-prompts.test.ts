import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Services } from "homelab-services"
import { ResumeContent } from "shared"
import { buildContentDigest } from "../src/layers/cover-letter/digest.js"
import { COVER_LETTER_EXEMPLARS } from "../src/layers/cover-letter/exemplars.js"
import { CoverLetterPromptConfigServiceLive } from "../src/layers/cover-letter-prompt-config-service.js"

const fixtureContent: ResumeContent.ContentState = {
  ...ResumeContent.INITIAL_CONTENT_STATE,
  experience: [
    {
      id: "acme",
      company: "Acme Corp",
      location: "Remote",
      roles: [{ title: "Senior Engineer", date: "2020 — present" }],
      description: "Platform work",
      bulletPoints: [
        { id: "acme__b0", text: "Visible bullet about Kubernetes", visible: true },
        { id: "acme__b1", text: "HIDDEN-BULLET-SENTINEL", visible: false },
      ],
      tags: ["TypeScript"],
    },
  ],
}

describe("cover letter prompt config service", () => {
  const runTest = <A>(
    f: (
      service: Services.CoverLetterPromptConfigService.CoverLetterPromptConfigServiceDef,
    ) => A,
  ) =>
    Effect.gen(function*() {
      const service = yield* Services.CoverLetterPromptConfigService.CoverLetterPromptConfigService
      return f(service)
    }).pipe(Effect.provide(CoverLetterPromptConfigServiceLive))

  describe("version properties", () => {
    it.effect("exposes version and schemaVersion", () =>
      runTest((service) => {
        expect(service.version).toBe("cl-v1-2026-11")
        expect(service.schemaVersion).toBe("cl-v1")
      }))
  })

  describe("buildGenerationResponseFormat", () => {
    it.effect("returns a strict json_schema format named CoverLetterGeneration", () =>
      runTest((service) => {
        const format = service.buildGenerationResponseFormat()
        expect(format.type).toBe("json_schema")
        expect(format.json_schema.name).toBe("CoverLetterGeneration")
        expect(format.json_schema.strict).toBe(true)
        const schema = format.json_schema.schema as any
        expect(schema.type).toBe("object")
        expect(schema.required).toContain("subject")
        expect(schema.required).toContain("paragraphs")
        expect(schema.properties.paragraphs.type).toBe("array")
        expect(schema.properties.paragraphs.items.type).toBe("string")
      }))

    it.effect("emits strict-mode-safe JSON schema (no pattern/length/items constraints)", () =>
      runTest((service) => {
        const schemaStr = JSON.stringify(service.buildGenerationResponseFormat().json_schema.schema)
        expect(schemaStr).not.toContain("\"pattern\"")
        expect(schemaStr).not.toContain("\"minLength\"")
        expect(schemaStr).not.toContain("\"maxLength\"")
        expect(schemaStr).not.toContain("\"maxItems\"")
        expect(schemaStr).not.toMatch(/"minItems"\s*:\s*[1-9]/)
      }))
  })

  describe("buildGenerationMessages", () => {
    const messages = () => {
      let built!: ReadonlyArray<Services.OpenRouterClientService.ChatMessage>
      return runTest((service) => {
        built = service.buildGenerationMessages({
          cleanedListing: "Cleaned listing text",
          jobTitle: "Senior DevOps Engineer",
          company: "SailPoint",
          content: fixtureContent,
        })
      }).pipe(Effect.andThen(Effect.sync(() => built)))
    }

    it.effect("system message comes first and embeds the exemplar(s)", () =>
      Effect.gen(function*() {
        const built = yield* messages()
        expect(built[0]!.role).toBe("system")
        expect(built[0]!.content).toContain("Rae Hill")
        // The SailPoint seed (CL-D3) is embedded verbatim-ish as the tone contract.
        expect(built[0]!.content).toContain("cryptographic sense")
        expect(built[0]!.content).toContain("<exemplar name=\"sailpoint-2026\">")
        // Injection + fabrication hard rules are present.
        expect(built[0]!.content).toContain("NO INJECTION")
        expect(built[0]!.content).toContain("NO FABRICATION")
      }))

    it.effect("user message wraps the listing in a nonce-delimited block", () =>
      Effect.gen(function*() {
        const built = yield* messages()
        const user = built[1]!
        expect(user.role).toBe("user")
        const match = user.content.match(/<listing id="([0-9a-f-]{36})">/)
        expect(match, "expected nonce-delimited listing block").not.toBeNull()
        expect(user.content).toContain("Cleaned listing text")
        expect(user.content).toContain("Job title: Senior DevOps Engineer")
        expect(user.content).toContain("Company: SailPoint")
      }))

    it.effect("every exemplar from the module appears in the system prompt", () =>
      Effect.gen(function*() {
        const built = yield* messages()
        for (const exemplar of COVER_LETTER_EXEMPLARS) {
          expect(built[0]!.content).toContain(exemplar.name)
          expect(built[0]!.content).toContain(exemplar.text.slice(0, 80))
        }
      }))
  })

  describe("buildContentDigest", () => {
    it("includes employers, roles, visible bullets, tags, and skills", () => {
      const digest = buildContentDigest(fixtureContent)
      expect(digest).toContain("Acme Corp")
      expect(digest).toContain("Senior Engineer")
      expect(digest).toContain("Visible bullet about Kubernetes")
      expect(digest).toContain("TypeScript")
    })

    it("excludes hidden bullets and entry ids", () => {
      const digest = buildContentDigest(fixtureContent)
      expect(digest).not.toContain("HIDDEN-BULLET-SENTINEL")
      expect(digest).not.toContain("acme__b0")
      expect(digest).not.toContain("\"acme\"")
    })
  })
})
