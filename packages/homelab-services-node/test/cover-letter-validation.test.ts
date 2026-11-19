import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  defaultCoverLetterLimits,
  scrubGeneratedText,
  validateCoverLetterGeneration,
} from "../src/layers/cover-letter/validation.js"

const paragraph = (filler: string, len = 100): string => filler.padEnd(len, "x")

const validGeneration = {
  subject: "Senior DevOps Engineer Position",
  paragraphs: [paragraph("First paragraph. "), paragraph("Second paragraph. ")],
}

describe("cover letter validation", () => {
  it.effect("accepts a well-formed generation and trims it", () =>
    Effect.sync(() => {
      const result = validateCoverLetterGeneration({
        subject: "  Senior DevOps Engineer Position  ",
        paragraphs: [`  ${paragraph("First. ")}  `, paragraph("Second. ")],
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.subject).toBe("Senior DevOps Engineer Position")
        expect(result.paragraphs[0]!.startsWith("First.")).toBe(true)
      }
    }))

  it.effect("rejects an empty subject", () =>
    Effect.sync(() => {
      const result = validateCoverLetterGeneration({ ...validGeneration, subject: "   " })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.violations.join("; ")).toContain("subject is empty")
      }
    }))

  it.effect("rejects an over-long subject", () =>
    Effect.sync(() => {
      const result = validateCoverLetterGeneration({
        ...validGeneration,
        subject: "s".repeat(defaultCoverLetterLimits.maxSubjectChars + 1),
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.violations.join("; ")).toContain("subject exceeds")
      }
    }))

  it.effect("enforces paragraph count bounds", () =>
    Effect.sync(() => {
      const tooFew = validateCoverLetterGeneration({
        subject: "Role",
        paragraphs: [paragraph("Only one. ")],
      })
      expect(tooFew.ok).toBe(false)
      if (!tooFew.ok) {
        expect(tooFew.violations.join("; ")).toContain("fewer than")
      }

      const tooMany = validateCoverLetterGeneration({
        subject: "Role",
        paragraphs: Array.from({ length: defaultCoverLetterLimits.maxParagraphs + 1 }, (_, i) =>
          paragraph(`Paragraph ${i}. `)
        ),
      })
      expect(tooMany.ok).toBe(false)
      if (!tooMany.ok) {
        expect(tooMany.violations.join("; ")).toContain("more than")
      }
    }))

  it.effect("enforces per-paragraph and total size bounds", () =>
    Effect.sync(() => {
      const tooShort = validateCoverLetterGeneration({
        subject: "Role",
        paragraphs: ["tiny", paragraph("Second. ")],
      })
      expect(tooShort.ok).toBe(false)
      if (!tooShort.ok) {
        expect(tooShort.violations.join("; ")).toContain("shorter than")
      }

      const tooLong = validateCoverLetterGeneration({
        subject: "Role",
        paragraphs: [
          "y".repeat(defaultCoverLetterLimits.maxParagraphChars + 1),
          paragraph("Second. "),
        ],
      })
      expect(tooLong.ok).toBe(false)
      if (!tooLong.ok) {
        expect(tooLong.violations.join("; ")).toContain("exceeds")
      }
    }))

  it.effect("scrub removes zero-width, bidi, and control characters", () =>
    Effect.sync(() => {
      const dirty = "a\u200Bb\u202Ec\uFEFFd\u0000e\u001Ff"
      expect(scrubGeneratedText(dirty)).toBe("abcdef")
    }))

  it.effect("scrub feeds validation (invisible chars cannot sneak through)", () =>
    Effect.sync(() => {
      const result = validateCoverLetterGeneration({
        subject: "Role",
        paragraphs: [
          `\u200B${paragraph("First. ")}`,
          `${paragraph("Second. ")}\u200F`,
        ],
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        for (const p of result.paragraphs) {
          expect(p).not.toMatch(/[\u200B-\u200F\uFEFF]/)
        }
      }
    }))
})
