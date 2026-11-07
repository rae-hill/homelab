import { Result, Schema } from "effect"
import { ResumeContent } from "shared"
import { describe, expect, it } from "vitest"
import { ResumeTailor } from "./index.js"

const { ResumeTailorRequest, ResumeTailorResponse } = ResumeTailor

describe("resume-tailor schemas", () => {
  describe("ResumeTailorRequest", () => {
    it("should decode a valid request", () => {
      const fixture = {
        listing: "Software Engineer at Acme Corp",
        content: ResumeContent.INITIAL_CONTENT_STATE,
        baseVersion: "v1",
      }

      const encoded = Schema.encodeSync(ResumeTailorRequest)(fixture)
      const decoded = Schema.decodeSync(ResumeTailorRequest)(encoded)

      expect(decoded.listing).toBe(fixture.listing)
      expect(decoded.content).toEqual(fixture.content)
      expect(decoded.baseVersion).toBe(fixture.baseVersion)
    })

    it("should reject an empty listing", () => {
      const fixture = {
        listing: "",
        content: ResumeContent.INITIAL_CONTENT_STATE,
        baseVersion: "v1",
      }

      const result = Schema.decodeUnknownResult(ResumeTailorRequest)(fixture)
      expect(Result.isFailure(result)).toBe(true)
    })

    it("should reject a listing exceeding maxLength", () => {
      const fixture = {
        listing: "x".repeat(200_001),
        content: ResumeContent.INITIAL_CONTENT_STATE,
        baseVersion: "v1",
      }

      const result = Schema.decodeUnknownResult(ResumeTailorRequest)(fixture)
      expect(Result.isFailure(result)).toBe(true)
    })
  })

  describe("ResumeTailorResponse", () => {
    it("should decode a valid response fixture", () => {
      const fixture = {
        jobTitle: "Senior Software Engineer",
        company: "Acme Corp",
        content: ResumeContent.INITIAL_CONTENT_STATE,
        baseVersion: "v1",
        fit: {
          verdict: "strong" as const,
          summary: "Excellent match for the role",
          tips: [
            {
              category: "requirements-inflation" as const,
              severity: "info" as const,
              title: "Experience requirement",
              detail: "The listing requires 5+ years, you have 7",
              evidence: "5+ years of experience required",
            },
          ],
          keywordCoverage: {
            required: ["TypeScript", "React", "Node.js"],
            matched: ["TypeScript", "React"],
            missing: ["Node.js"],
          },
        },
        meta: {
          stage1: {
            model: "gpt-4o-mini",
            tokens: { input: 1500, output: 300 },
            latencyMs: 450,
          },
          stage2: {
            model: "gpt-4o",
            tokens: { input: 3000, output: 1200 },
            latencyMs: 2100,
          },
          degraded: false,
          cacheHit: false,
          contentHash: "sha256-abc123",
          listingHash: "sha256-def456",
          promptVersion: "v1",
          schemaVersion: "v1",
        },
      }

      const encoded = Schema.encodeSync(ResumeTailorResponse)(fixture)
      const decoded = Schema.decodeSync(ResumeTailorResponse)(encoded)

      expect(decoded.jobTitle).toBe(fixture.jobTitle)
      expect(decoded.company).toBe(fixture.company)
      expect(decoded.content).toEqual(fixture.content)
      expect(decoded.baseVersion).toBe(fixture.baseVersion)
      expect(decoded.fit.verdict).toBe("strong")
      expect(decoded.fit.tips).toHaveLength(1)
      expect(decoded.fit.keywordCoverage.required).toEqual(["TypeScript", "React", "Node.js"])
      expect(decoded.meta.stage1?.model).toBe("gpt-4o-mini")
      expect(decoded.meta.stage2?.model).toBe("gpt-4o")
      expect(decoded.meta.degraded).toBe(false)
      expect(decoded.meta.cacheHit).toBe(false)
    })

    it("should handle null company", () => {
      const fixture = {
        jobTitle: "Software Engineer",
        company: null,
        content: ResumeContent.INITIAL_CONTENT_STATE,
        baseVersion: "v1",
        fit: {
          verdict: "partial" as const,
          summary: "Partial match",
          tips: [],
          keywordCoverage: {
            required: [],
            matched: [],
            missing: [],
          },
        },
        meta: {
          stage1: null,
          stage2: {
            model: "gpt-4o",
            tokens: { input: 2000, output: 800 },
            latencyMs: 1500,
          },
          degraded: true,
          cacheHit: false,
          contentHash: "sha256-abc123",
          listingHash: "sha256-def456",
          promptVersion: "v1",
          schemaVersion: "v1",
        },
      }

      const encoded = Schema.encodeSync(ResumeTailorResponse)(fixture)
      const decoded = Schema.decodeSync(ResumeTailorResponse)(encoded)

      expect(decoded.company).toBeNull()
      expect(decoded.meta.stage1).toBeNull()
      expect(decoded.meta.degraded).toBe(true)
    })

    it("should roundtrip content through the patch codec", () => {
      const modifiedContent = {
        ...ResumeContent.INITIAL_CONTENT_STATE,
        blurb: "Tailored blurb for Acme Corp",
      }

      const fixture = {
        jobTitle: "Software Engineer",
        company: "Acme Corp",
        content: modifiedContent,
        baseVersion: "v1",
        fit: {
          verdict: "strong" as const,
          summary: "Great fit",
          tips: [],
          keywordCoverage: {
            required: [],
            matched: [],
            missing: [],
          },
        },
        meta: {
          stage1: null,
          stage2: null,
          degraded: false,
          cacheHit: false,
          contentHash: "sha256-abc123",
          listingHash: "sha256-def456",
          promptVersion: "v1",
          schemaVersion: "v1",
        },
      }

      const encoded = Schema.encodeSync(ResumeTailorResponse)(fixture)
      const decoded = Schema.decodeSync(ResumeTailorResponse)(encoded)

      // The content should be the full ContentState, not the base64 patch
      expect(decoded.content).toEqual(modifiedContent)
      expect(decoded.content.blurb).toBe("Tailored blurb for Acme Corp")
    })
  })

  describe("FitReport", () => {
    it("should accept all verdict values", () => {
      const makeFixture = (verdict: "strong" | "partial" | "weak") => ({
        verdict,
        summary: "Summary",
        tips: [],
        keywordCoverage: {
          required: [],
          matched: [],
          missing: [],
        },
      })

      for (const verdict of ["strong", "partial", "weak"] as const) {
        const fixture = makeFixture(verdict)
        const decoded = Schema.decodeUnknownSync(ResumeTailor.FitReport)(fixture)
        expect(decoded.verdict).toBe(verdict)
      }
    })

    it("should accept all tip categories", () => {
      const categories = [
        "requirements-inflation",
        "buried-hard-gate",
        "title-scope-mismatch",
        "logistics",
        "employment-form",
        "compensation",
        "screening-risk",
        "process",
        "listing-quality",
      ] as const

      for (const category of categories) {
        const fixture = {
          verdict: "strong" as const,
          summary: "Summary",
          tips: [
            {
              category,
              severity: "info" as const,
              title: "Title",
              detail: "Detail",
              evidence: "",
            },
          ],
          keywordCoverage: {
            required: [],
            matched: [],
            missing: [],
          },
        }
        const decoded = Schema.decodeUnknownSync(ResumeTailor.FitReport)(fixture)
        expect(decoded.tips[0].category).toBe(category)
      }
    })

    it("should accept all severity values", () => {
      for (const severity of ["info", "caution", "blocker"] as const) {
        const fixture = {
          verdict: "strong" as const,
          summary: "Summary",
          tips: [
            {
              category: "logistics" as const,
              severity,
              title: "Title",
              detail: "Detail",
              evidence: "",
            },
          ],
          keywordCoverage: {
            required: [],
            matched: [],
            missing: [],
          },
        }
        const decoded = Schema.decodeUnknownSync(ResumeTailor.FitReport)(fixture)
        expect(decoded.tips[0].severity).toBe(severity)
      }
    })
  })
})
