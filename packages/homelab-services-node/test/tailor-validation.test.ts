import { describe, expect, it } from "@effect/vitest"
import { ResumeContent } from "shared"
import {
  checkEvidence,
  checkFabrication,
  checkTagInvariance,
  computeKeywordCoverage,
  mergeEdits,
  resolveIds,
} from "../src/layers/tailor/validation.js"
import type { TailorEdits } from "../src/layers/tailor/wire-schema.js"

const sampleContent = {
  ...ResumeContent.INITIAL_CONTENT_STATE,
  experience: [
    {
      id: "exp1",
      company: "Acme Corp",
      location: "SF",
      dateRange: "2020-2023",
      title: "Engineer",
      bulletPoints: [
        { id: "bp1", text: "Built thing 1", visible: true },
        { id: "bp2", text: "Built thing 2", visible: true },
        { id: "bp3", text: "Built thing 3", visible: true },
      ],
      tags: ["TypeScript", "React", "Node"],
    },
  ],
  projects: [
    {
      id: "proj1",
      title: "Project A",
      description: "A cool project",
      githubUrl: "https://github.com/test/proj-a",
      tags: ["Python", "Django"],
    },
  ],
}

const sampleEdits: TailorEdits = {
  headline: "Senior Engineer",
  summary: "Experienced engineer",
  bullets: [
    {
      entryId: "exp1",
      bulletId: "bp1",
      text: "Built amazing thing 1",
      rationale: "More impactful",
    },
  ],
  entryDescriptions: [
    {
      entryId: "exp1",
      description: "Led engineering team",
    },
  ],
  hiddenBullets: [
    {
      entryId: "exp1",
      bulletId: "bp3",
      rationale: "Less relevant",
    },
  ],
  tagGroups: [
    {
      entryId: "exp1",
      tags: ["TypeScript", "Node", "React"], // reordered
    },
  ],
  fit: {
    verdict: "strong",
    summary: "Great fit",
    tips: [],
    keywordCoverage: {
      required: ["TypeScript", "React"],
    },
  },
}

describe("tailor validation", () => {
  describe("resolveIds", () => {
    it("keeps edits with valid IDs", () => {
      const result = resolveIds(sampleEdits, sampleContent as any)
      expect(result.edits.bullets).toHaveLength(1)
      expect(result.edits.entryDescriptions).toHaveLength(1)
      expect(result.edits.hiddenBullets).toHaveLength(1)
      expect(result.edits.tagGroups).toHaveLength(1)
      expect(result.dropped).toHaveLength(0)
    })

    it("drops edits with unknown entryId", () => {
      const badEdits = {
        ...sampleEdits,
        bullets: [
          ...sampleEdits.bullets,
          {
            entryId: "unknown-exp",
            bulletId: "bp1",
            text: "Bad bullet",
            rationale: "Unknown entry",
          },
        ],
      }
      const result = resolveIds(badEdits, sampleContent as any)
      expect(result.edits.bullets).toHaveLength(1) // original kept
      expect(result.dropped).toHaveLength(1)
      expect(result.dropped[0]).toContain("unknown-exp")
    })

    it("drops edits with unknown bulletId", () => {
      const badEdits = {
        ...sampleEdits,
        bullets: [
          ...sampleEdits.bullets,
          {
            entryId: "exp1",
            bulletId: "unknown-bp",
            text: "Bad bullet",
            rationale: "Unknown bullet",
          },
        ],
      }
      const result = resolveIds(badEdits, sampleContent as any)
      expect(result.edits.bullets).toHaveLength(1) // original kept
      expect(result.dropped).toHaveLength(1)
      expect(result.dropped[0]).toContain("unknown-bp")
    })
  })

  describe("checkTagInvariance", () => {
    it("keeps tag groups with same length and membership", () => {
      const result = checkTagInvariance(sampleEdits, sampleContent as any)
      expect(result.edits.tagGroups).toHaveLength(1)
      expect(result.rejected).toHaveLength(0)
    })

    it("rejects tag groups with different length", () => {
      const badEdits = {
        ...sampleEdits,
        tagGroups: [
          {
            entryId: "exp1",
            tags: ["TypeScript", "React"], // missing Node
          },
        ],
      }
      const result = checkTagInvariance(badEdits, sampleContent as any)
      expect(result.edits.tagGroups).toHaveLength(0)
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]).toBe("exp1")
    })

    it("rejects tag groups with different membership", () => {
      const badEdits = {
        ...sampleEdits,
        tagGroups: [
          {
            entryId: "exp1",
            tags: ["TypeScript", "React", "Python"], // Python not in original
          },
        ],
      }
      const result = checkTagInvariance(badEdits, sampleContent as any)
      expect(result.edits.tagGroups).toHaveLength(0)
      expect(result.rejected).toHaveLength(1)
    })
  })

  describe("checkFabrication", () => {
    it("keeps edits with grounded content", () => {
      const listing = "Looking for TypeScript and React experience"
      const result = checkFabrication(sampleEdits, sampleContent as any, listing)
      expect(result.edits.bullets).toHaveLength(1)
      expect(result.dropped).toHaveLength(0)
    })

    it("drops edits with fabricated numbers", () => {
      const badEdits = {
        ...sampleEdits,
        bullets: [
          {
            entryId: "exp1",
            bulletId: "bp1",
            text: "Increased performance by 500%",
            rationale: "Added metric",
          },
        ],
      }
      const listing = "Looking for engineers"
      const result = checkFabrication(badEdits, sampleContent as any, listing)
      expect(result.edits.bullets).toHaveLength(0)
      expect(result.dropped).toHaveLength(1)
    })

    it("drops edits with fabricated percentages", () => {
      const badEdits = {
        ...sampleEdits,
        bullets: [
          {
            entryId: "exp1",
            bulletId: "bp1",
            text: "Improved efficiency by 95%",
            rationale: "Added metric",
          },
        ],
      }
      const listing = "Looking for engineers"
      const result = checkFabrication(badEdits, sampleContent as any, listing)
      expect(result.edits.bullets).toHaveLength(0)
      expect(result.dropped).toHaveLength(1)
    })

    it("keeps edits with numbers present in source", () => {
      const goodEdits = {
        ...sampleEdits,
        bullets: [
          {
            entryId: "exp1",
            bulletId: "bp1",
            text: "Worked in 2020 on project with 3 team members",
            rationale: "Added context",
          },
        ],
      }
      const listing = "Worked in 2020 with 3 team members"
      const result = checkFabrication(goodEdits, sampleContent as any, listing)
      expect(result.edits.bullets).toHaveLength(1)
      expect(result.dropped).toHaveLength(0)
    })
  })

  describe("checkEvidence", () => {
    it("keeps tips with valid evidence", () => {
      const editsWithEvidence = {
        ...sampleEdits,
        fit: {
          ...sampleEdits.fit,
          tips: [
            {
              category: "requirements-inflation" as const,
              severity: "info" as const,
              title: "Requirement note",
              detail: "Listing mentions TypeScript",
              evidence: "TypeScript experience required",
            },
          ],
        },
      }
      const cleanedListing = "TypeScript experience required for this role"
      const result = checkEvidence(editsWithEvidence, cleanedListing)
      expect(result.fit.tips[0].evidence).toBe("TypeScript experience required")
      expect(result.fit.tips[0].severity).toBe("info")
    })

    it("downgrades tips with invalid evidence", () => {
      const editsWithEvidence = {
        ...sampleEdits,
        fit: {
          ...sampleEdits.fit,
          tips: [
            {
              category: "requirements-inflation" as const,
              severity: "caution" as const,
              title: "Requirement note",
              detail: "Listing mentions something",
              evidence: "This quote is not in the listing",
            },
          ],
        },
      }
      const cleanedListing = "We require TypeScript experience"
      const result = checkEvidence(editsWithEvidence, cleanedListing)
      expect(result.fit.tips[0].evidence).toBe("")
      expect(result.fit.tips[0].severity).toBe("info") // downgraded
    })

    it("keeps empty evidence as-is", () => {
      const editsWithEmptyEvidence = {
        ...sampleEdits,
        fit: {
          ...sampleEdits.fit,
          tips: [
            {
              category: "process" as const,
              severity: "info" as const,
              title: "Process note",
              detail: "Apply online",
              evidence: "",
            },
          ],
        },
      }
      const result = checkEvidence(editsWithEmptyEvidence, "any listing")
      expect(result.fit.tips[0].evidence).toBe("")
    })
  })

  describe("mergeEdits", () => {
    it("applies headline to blurb", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      expect(result.blurb).toBe("Senior Engineer")
    })

    it("applies summary to aboutMe", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      expect(result.aboutMe).toBe("Experienced engineer")
    })

    it("applies bullet edits", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      const bullet = result.experience[0].bulletPoints.find((bp) => bp.id === "bp1")
      expect(bullet?.text).toBe("Built amazing thing 1")
    })

    it("applies entry description edits", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      expect(result.experience[0].description).toBe("Led engineering team")
    })

    it("applies hidden bullets", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      const bullet = result.experience[0].bulletPoints.find((bp) => bp.id === "bp3")
      expect(bullet?.visible).toBe(false)
    })

    it("applies tag reordering", () => {
      const result = mergeEdits(sampleContent as any, sampleEdits)
      expect(result.experience[0].tags).toEqual(["TypeScript", "Node", "React"])
    })

    it("does not mutate original content", () => {
      const original = JSON.parse(JSON.stringify(sampleContent))
      mergeEdits(sampleContent as any, sampleEdits)
      expect(sampleContent).toEqual(original)
    })
  })

  describe("computeKeywordCoverage", () => {
    it("computes matched keywords", () => {
      const result = computeKeywordCoverage(
        ["TypeScript", "React", "Python"],
        sampleContent as any,
      )
      expect(result.matched).toContain("TypeScript")
      expect(result.matched).toContain("React")
      expect(result.matched).toContain("Python")
    })

    it("computes missing keywords", () => {
      const result = computeKeywordCoverage(
        ["TypeScript", "Kubernetes", "AWS"],
        sampleContent as any,
      )
      expect(result.matched).toContain("TypeScript")
      expect(result.missing).toContain("Kubernetes")
      expect(result.missing).toContain("AWS")
    })

    it("is case-insensitive", () => {
      const result = computeKeywordCoverage(
        ["typescript", "REACT"],
        sampleContent as any,
      )
      expect(result.matched).toContain("typescript")
      expect(result.matched).toContain("REACT")
    })
  })
})
