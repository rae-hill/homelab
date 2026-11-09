import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Services } from "homelab-services"
import { ResumePromptConfigServiceLive } from "../src/layers/resume-prompt-config-service.js"

describe("resume prompt config service", () => {
  const runTest = <E, A>(
    effect: Effect.Effect<A, E, Services.ResumePromptConfigService.ResumePromptConfigService>,
  ) => effect.pipe(Effect.provide(ResumePromptConfigServiceLive))

  describe("version properties", () => {
    it.effect("exposes version (the former promptVersion constant)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        expect(service.version).toBe("v2-2026-11")
      })))

    it.effect("exposes schemaVersion", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        expect(service.schemaVersion).toBe("v2")
      })))
  })

  describe("buildCleanupResponseFormat", () => {
    it.effect("returns a valid response format", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildCleanupResponseFormat()
        expect(format.type).toBe("json_schema")
        expect(format.json_schema.name).toBe("CleanupResponse")
        expect(format.json_schema.strict).toBe(true)
        expect(format.json_schema.schema).toBeDefined()
      })))

    it.effect("emits JSON schema without pattern constraints", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildCleanupResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        // Should not contain pattern constraints (strict mode incompatible)
        expect(schemaStr).not.toContain("\"pattern\"")
      })))

    it.effect("emits JSON schema without minLength constraints", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildCleanupResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        // Should not contain minLength constraints (strict mode incompatible)
        expect(schemaStr).not.toContain("\"minLength\"")
      })))

    it.effect("emits JSON schema with all required fields", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildCleanupResponseFormat()
        const schema = format.json_schema.schema as any
        expect(schema.type).toBe("object")
        expect(schema.required).toContain("cleanedListing")
        expect(schema.required).toContain("jobTitle")
        expect(schema.required).toContain("company")
      })))

    it.effect("marks all fields as required (no optional fields)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildCleanupResponseFormat()
        const schema = format.json_schema.schema as any
        // All three fields should be in required array
        expect(schema.required).toHaveLength(3)
      })))
  })

  describe("buildTailorResponseFormat", () => {
    it.effect("returns a valid response format", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        expect(format.type).toBe("json_schema")
        expect(format.json_schema.name).toBe("TailorEdits")
        expect(format.json_schema.strict).toBe(true)
        expect(format.json_schema.schema).toBeDefined()
      })))

    it.effect("emits JSON schema without pattern constraints", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        expect(schemaStr).not.toContain("\"pattern\"")
      })))

    it.effect("emits JSON schema without minLength constraints", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        expect(schemaStr).not.toContain("\"minLength\"")
      })))

    it.effect("emits JSON schema without minItems > 1", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        // Should not have minItems > 1 (arrays should be allowed to be empty)
        expect(schemaStr).not.toMatch(/"minItems"\s*:\s*[2-9]/)
      })))

    it.effect("emits JSON schema without maxItems constraints", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schemaStr = JSON.stringify(format.json_schema.schema)
        expect(schemaStr).not.toContain("\"maxItems\"")
      })))

    it.effect("emits JSON schema with all required top-level fields", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        expect(schema.type).toBe("object")
        expect(schema.required).toContain("headline")
        expect(schema.required).toContain("summary")
        expect(schema.required).toContain("bullets")
        expect(schema.required).toContain("entryDescriptions")
        expect(schema.required).toContain("hiddenBullets")
        expect(schema.required).toContain("addedBullets")
        expect(schema.required).toContain("tagGroups")
        expect(schema.required).toContain("fit")
      })))

    it.effect("emits JSON schema for bullets array", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        expect(schema.properties.bullets.type).toBe("array")
        expect(schema.properties.bullets.items.type).toBe("object")
        expect(schema.properties.bullets.items.required).toContain("entryId")
        expect(schema.properties.bullets.items.required).toContain("bulletId")
        expect(schema.properties.bullets.items.required).toContain("text")
        expect(schema.properties.bullets.items.required).toContain("rationale")
      })))

    it.effect("emits JSON schema for addedBullets array", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        expect(schema.properties.addedBullets.type).toBe("array")
        expect(schema.properties.addedBullets.items.type).toBe("object")
        expect(schema.properties.addedBullets.items.required).toContain("entryId")
        expect(schema.properties.addedBullets.items.required).toContain("text")
        expect(schema.properties.addedBullets.items.required).toContain("rationale")
      })))

    it.effect("emits JSON schema for fit report", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        expect(schema.properties.fit.type).toBe("object")
        expect(schema.properties.fit.required).toContain("verdict")
        expect(schema.properties.fit.required).toContain("summary")
        expect(schema.properties.fit.required).toContain("tips")
        expect(schema.properties.fit.required).toContain("keywordCoverage")
      })))

    it.effect("emits JSON schema for verdict with correct literals", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        const verdictSchema = schema.properties.fit.properties.verdict
        expect(verdictSchema.enum).toContain("strong")
        expect(verdictSchema.enum).toContain("partial")
        expect(verdictSchema.enum).toContain("weak")
      })))

    it.effect("emits JSON schema for tip categories", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumePromptConfigService.ResumePromptConfigService
        const format = service.buildTailorResponseFormat()
        const schema = format.json_schema.schema as any
        const tipCategorySchema = schema.properties.fit.properties.tips.items.properties.category
        expect(tipCategorySchema.enum).toContain("requirements-inflation")
        expect(tipCategorySchema.enum).toContain("buried-hard-gate")
        expect(tipCategorySchema.enum).toContain("title-scope-mismatch")
        expect(tipCategorySchema.enum).toContain("logistics")
        expect(tipCategorySchema.enum).toContain("employment-form")
        expect(tipCategorySchema.enum).toContain("compensation")
        expect(tipCategorySchema.enum).toContain("screening-risk")
        expect(tipCategorySchema.enum).toContain("process")
        expect(tipCategorySchema.enum).toContain("listing-quality")
      })))
  })
})
