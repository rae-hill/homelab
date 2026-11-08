import { describe, expect, it } from "@effect/vitest"
import { buildCleanupResponseFormat, buildTailorResponseFormat } from "../src/layers/tailor/prompts.js"
import { promptVersion, schemaVersion } from "../src/layers/tailor/wire-schema.js"

describe("tailor prompts", () => {
  describe("prompt version constants", () => {
    it("exports promptVersion", () => {
      expect(promptVersion).toBe("v1-2026-11")
    })

    it("exports schemaVersion", () => {
      expect(schemaVersion).toBe("v1")
    })
  })

  describe("buildCleanupResponseFormat", () => {
    it("returns a valid response format", () => {
      const format = buildCleanupResponseFormat()
      expect(format.type).toBe("json_schema")
      expect(format.json_schema.name).toBe("CleanupResponse")
      expect(format.json_schema.strict).toBe(true)
      expect(format.json_schema.schema).toBeDefined()
    })

    it("emits JSON schema without pattern constraints", () => {
      const format = buildCleanupResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      // Should not contain pattern constraints (strict mode incompatible)
      expect(schemaStr).not.toContain("\"pattern\"")
    })

    it("emits JSON schema without minLength constraints", () => {
      const format = buildCleanupResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      // Should not contain minLength constraints (strict mode incompatible)
      expect(schemaStr).not.toContain("\"minLength\"")
    })

    it("emits JSON schema with all required fields", () => {
      const format = buildCleanupResponseFormat()
      const schema = format.json_schema.schema as any
      expect(schema.type).toBe("object")
      expect(schema.required).toContain("cleanedListing")
      expect(schema.required).toContain("jobTitle")
      expect(schema.required).toContain("company")
    })

    it("marks all fields as required (no optional fields)", () => {
      const format = buildCleanupResponseFormat()
      const schema = format.json_schema.schema as any
      // All three fields should be in required array
      expect(schema.required).toHaveLength(3)
    })
  })

  describe("buildTailorResponseFormat", () => {
    it("returns a valid response format", () => {
      const format = buildTailorResponseFormat()
      expect(format.type).toBe("json_schema")
      expect(format.json_schema.name).toBe("TailorEdits")
      expect(format.json_schema.strict).toBe(true)
      expect(format.json_schema.schema).toBeDefined()
    })

    it("emits JSON schema without pattern constraints", () => {
      const format = buildTailorResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      expect(schemaStr).not.toContain("\"pattern\"")
    })

    it("emits JSON schema without minLength constraints", () => {
      const format = buildTailorResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      expect(schemaStr).not.toContain("\"minLength\"")
    })

    it("emits JSON schema without minItems > 1", () => {
      const format = buildTailorResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      // Should not have minItems > 1 (arrays should be allowed to be empty)
      expect(schemaStr).not.toMatch(/"minItems"\s*:\s*[2-9]/)
    })

    it("emits JSON schema without maxItems constraints", () => {
      const format = buildTailorResponseFormat()
      const schemaStr = JSON.stringify(format.json_schema.schema)
      expect(schemaStr).not.toContain("\"maxItems\"")
    })

    it("emits JSON schema with all required top-level fields", () => {
      const format = buildTailorResponseFormat()
      const schema = format.json_schema.schema as any
      expect(schema.type).toBe("object")
      expect(schema.required).toContain("headline")
      expect(schema.required).toContain("summary")
      expect(schema.required).toContain("bullets")
      expect(schema.required).toContain("entryDescriptions")
      expect(schema.required).toContain("hiddenBullets")
      expect(schema.required).toContain("tagGroups")
      expect(schema.required).toContain("fit")
    })

    it("emits JSON schema for bullets array", () => {
      const format = buildTailorResponseFormat()
      const schema = format.json_schema.schema as any
      expect(schema.properties.bullets.type).toBe("array")
      expect(schema.properties.bullets.items.type).toBe("object")
      expect(schema.properties.bullets.items.required).toContain("entryId")
      expect(schema.properties.bullets.items.required).toContain("bulletId")
      expect(schema.properties.bullets.items.required).toContain("text")
      expect(schema.properties.bullets.items.required).toContain("rationale")
    })

    it("emits JSON schema for fit report", () => {
      const format = buildTailorResponseFormat()
      const schema = format.json_schema.schema as any
      expect(schema.properties.fit.type).toBe("object")
      expect(schema.properties.fit.required).toContain("verdict")
      expect(schema.properties.fit.required).toContain("summary")
      expect(schema.properties.fit.required).toContain("tips")
      expect(schema.properties.fit.required).toContain("keywordCoverage")
    })

    it("emits JSON schema for verdict with correct literals", () => {
      const format = buildTailorResponseFormat()
      const schema = format.json_schema.schema as any
      const verdictSchema = schema.properties.fit.properties.verdict
      expect(verdictSchema.enum).toContain("strong")
      expect(verdictSchema.enum).toContain("partial")
      expect(verdictSchema.enum).toContain("weak")
    })

    it("emits JSON schema for tip categories", () => {
      const format = buildTailorResponseFormat()
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
    })
  })
})
