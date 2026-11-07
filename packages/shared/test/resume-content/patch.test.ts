import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ResumeContent } from "../../src/index.js"

const { ContentPatchBase64, ContentDiffer, INITIAL_CONTENT_STATE, ContentState } = ResumeContent

describe("patch codec", () => {
  describe("roundtrip", () => {
    it("should encode and decode a modified ContentState", () => {
      const modified: ResumeContent.ContentState = {
        ...INITIAL_CONTENT_STATE,
        blurb: "Custom blurb for testing",
        experience: INITIAL_CONTENT_STATE.experience.map((exp, i) =>
          i === 0
            ? {
              ...exp,
              bulletPoints: exp.bulletPoints.map((bp, j) =>
                j === 0 ? { ...bp, text: "Modified first bullet point" } : bp
              ),
            }
            : exp
        ),
      }

      const encoded = Schema.encodeSync(ContentPatchBase64)(modified)
      expect(typeof encoded).toBe("string")
      expect(encoded.length).toBeGreaterThan(0)

      const decoded = Schema.decodeSync(ContentPatchBase64)(encoded)
      expect(decoded).toEqual(modified)
    })

    it("should produce an empty patch for INITIAL_CONTENT_STATE", () => {
      const encoded = Schema.encodeSync(ContentPatchBase64)(INITIAL_CONTENT_STATE)

      // Decode the base64 to verify it's an empty patch
      const jsonString = Schema.decodeSync(Schema.StringFromBase64)(encoded)
      const patch = JSON.parse(jsonString)

      expect(Array.isArray(patch)).toBe(true)
      expect(patch).toHaveLength(0)
    })

    it("should decode an empty patch to INITIAL_CONTENT_STATE", () => {
      const emptyPatchJson = JSON.stringify([])
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(emptyPatchJson)

      const decoded = Schema.decodeSync(ContentPatchBase64)(encoded)
      expect(decoded).toEqual(INITIAL_CONTENT_STATE)
    })
  })

  describe("hand-crafted patches", () => {
    it("should decode a replace operation on blurb", () => {
      const patch = [
        {
          op: "replace",
          path: "/blurb",
          value: "Hand-crafted blurb replacement",
        },
      ]
      const patchJson = JSON.stringify(patch)
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(patchJson)

      const decoded = Schema.decodeSync(ContentPatchBase64)(encoded)

      expect(decoded.blurb).toBe("Hand-crafted blurb replacement")
      expect(decoded.aboutMe).toBe(INITIAL_CONTENT_STATE.aboutMe)
      expect(decoded.experience).toEqual(INITIAL_CONTENT_STATE.experience)
      expect(decoded.projects).toEqual(INITIAL_CONTENT_STATE.projects)
      expect(decoded.skills).toEqual(INITIAL_CONTENT_STATE.skills)
    })

    it("should decode multiple operations", () => {
      const patch = [
        {
          op: "replace",
          path: "/skills/0",
          value: "ModifiedSkill",
        },
        {
          op: "add",
          path: "/skills/-",
          value: "NewSkill",
        },
      ]
      const patchJson = JSON.stringify(patch)
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(patchJson)

      const decoded = Schema.decodeSync(ContentPatchBase64)(encoded)

      expect(decoded.skills[0]).toBe("ModifiedSkill")
      expect(decoded.skills).toContain("NewSkill")
    })
  })

  describe("malformed patches", () => {
    it("should fail on invalid base64", () => {
      const result = Schema.decodeUnknownResult(ContentPatchBase64)("not-valid-base64!!!")
      expect(result._tag).toBe("Failure")
    })

    it("should fail on invalid JSON", () => {
      const invalidJson = "not json at all"
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(invalidJson)

      const result = Schema.decodeUnknownResult(ContentPatchBase64)(encoded)
      expect(result._tag).toBe("Failure")
    })

    it("should fail on non-array JSON", () => {
      const notArray = { op: "replace", path: "/blurb", value: "x" }
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(JSON.stringify(notArray))

      const result = Schema.decodeUnknownResult(ContentPatchBase64)(encoded)
      expect(result._tag).toBe("Failure")
    })

    it("should fail on invalid operation structure", () => {
      const invalidOp = [{ operation: "replace", location: "/blurb" }]
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(JSON.stringify(invalidOp))

      const result = Schema.decodeUnknownResult(ContentPatchBase64)(encoded)
      expect(result._tag).toBe("Failure")
    })

    it("should fail on out-of-bounds array index", () => {
      const patch = [
        {
          op: "replace",
          path: "/experience/999/company",
          value: "Nonexistent",
        },
      ]
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(JSON.stringify(patch))

      const result = Schema.decodeUnknownResult(ContentPatchBase64)(encoded)
      expect(result._tag).toBe("Failure")
    })

    it("should fail on non-existent path", () => {
      const patch = [
        {
          op: "replace",
          path: "/nonexistent/path",
          value: "value",
        },
      ]
      const encoded = Schema.encodeSync(Schema.StringFromBase64)(JSON.stringify(patch))

      const result = Schema.decodeUnknownResult(ContentPatchBase64)(encoded)
      expect(result._tag).toBe("Failure")
    })
  })

  describe("determinism", () => {
    it("should produce identical base64 for identical inputs", () => {
      const modified: ResumeContent.ContentState = {
        ...INITIAL_CONTENT_STATE,
        blurb: "Deterministic test blurb",
      }

      const encoded1 = Schema.encodeSync(ContentPatchBase64)(modified)
      const encoded2 = Schema.encodeSync(ContentPatchBase64)(modified)

      expect(encoded1).toBe(encoded2)
    })

    it("should produce stable diffs via ContentDiffer", () => {
      const modified1: ResumeContent.ContentState = {
        ...INITIAL_CONTENT_STATE,
        blurb: "First blurb",
      }
      const modified2: ResumeContent.ContentState = {
        ...INITIAL_CONTENT_STATE,
        blurb: "First blurb",
      }

      const diff1 = ContentDiffer.diff(INITIAL_CONTENT_STATE, modified1)
      const diff2 = ContentDiffer.diff(INITIAL_CONTENT_STATE, modified2)

      expect(diff1).toEqual(diff2)
    })
  })

  describe("pointer escaping", () => {
    it("should handle special characters in text content", () => {
      const modified: ResumeContent.ContentState = {
        ...INITIAL_CONTENT_STATE,
        experience: INITIAL_CONTENT_STATE.experience.map((exp, i) =>
          i === 0
            ? {
              ...exp,
              bulletPoints: exp.bulletPoints.map((bp, j) =>
                j === 0
                  ? {
                    ...bp,
                    text: "Text with / slash and ~ tilde",
                  }
                  : bp
              ),
            }
            : exp
        ),
      }

      const encoded = Schema.encodeSync(ContentPatchBase64)(modified)
      const decoded = Schema.decodeSync(ContentPatchBase64)(encoded)

      expect(decoded).toEqual(modified)
      expect(decoded.experience[0].bulletPoints[0].text).toBe("Text with / slash and ~ tilde")
    })
  })
})
