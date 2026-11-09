import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Schemas, Services } from "homelab-services"
import { ResumeContent } from "shared"
import { ResumeTailorValidationServiceLive } from "../src/layers/resume-tailor-validation-service.js"
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

describe("tailor validation service", () => {
  const runTest = <E, A>(
    effect: Effect.Effect<A, E, Services.ResumeTailorValidationService.ResumeTailorValidationService>,
  ) => effect.pipe(Effect.provide(ResumeTailorValidationServiceLive))

  describe("resolveIds (always active, merge mechanics)", () => {
    it.effect("keeps edits with valid IDs", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const policy = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY
        const result = yield* service.validateEdits({
          content: sampleContent as any,
          edits: sampleEdits,
          cleanedListing: "Test listing",
          policy,
        })
        expect(result.edits.bullets).toHaveLength(1)
        expect(result.edits.entryDescriptions).toHaveLength(1)
        expect(result.edits.hiddenBullets).toHaveLength(1)
        expect(result.edits.tagGroups).toHaveLength(1)
        expect(result.dropped).toHaveLength(0)
      })))

    it.effect("drops edits with unknown entryId", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const policy = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY
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
        const result = yield* service.validateEdits({
          content: sampleContent as any,
          edits: badEdits,
          cleanedListing: "Test listing",
          policy,
        })
        expect(result.edits.bullets).toHaveLength(1) // original kept
        expect(result.dropped).toHaveLength(1)
        expect(result.dropped[0].detail).toContain("unknown-exp")
      })))

    it.effect("drops edits with unknown bulletId", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const policy = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY
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
        const result = yield* service.validateEdits({
          content: sampleContent as any,
          edits: badEdits,
          cleanedListing: "Test listing",
          policy,
        })
        expect(result.edits.bullets).toHaveLength(1) // original kept
        expect(result.dropped).toHaveLength(1)
        expect(result.dropped[0].detail).toContain("unknown-bp")
      })))
  })

  describe("policy-driven checks", () => {
    describe("policy disabled (default)", () => {
      it.effect("skips fabrication, evidence, and tag checks", () =>
        runTest(Effect.gen(function*() {
          const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
          const policy = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY // enabled: false
          // Bad edits that would be rejected if policy enabled
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
            tagGroups: [
              {
                entryId: "exp1",
                tags: ["TypeScript", "React", "Rust"], // Rust not in vocabulary (exp: TS/React/Node; proj: Python/Django)
              },
            ],
            fit: {
              ...sampleEdits.fit,
              tips: [
                {
                  category: "requirements-inflation" as const,
                  severity: "caution" as const,
                  title: "Bad tip",
                  detail: "Detail",
                  evidence: "Not in listing",
                },
              ],
            },
          }
          const result = yield* service.validateEdits({
            content: sampleContent as any,
            edits: badEdits,
            cleanedListing: "Looking for engineers",
            policy,
          })
          // All edits should pass through (policy disabled)
          expect(result.dropped).toHaveLength(0)
        })))
    })

    describe("policy enabled", () => {
      it.effect("drops fabricated content", () =>
        runTest(Effect.gen(function*() {
          const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
          const policy = {
            ...Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY,
            enabled: true,
          }
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
          const result = yield* service.validateEdits({
            content: sampleContent as any,
            edits: badEdits,
            cleanedListing: "Looking for engineers",
            policy,
          })
          expect(result.edits.bullets).toHaveLength(0)
          expect(result.dropped).toHaveLength(1)
          expect(result.dropped[0].reason).toBe("fabricated-content")
        })))

      it.effect("downgrades invalid evidence", () =>
        runTest(Effect.gen(function*() {
          const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
          const policy = {
            ...Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY,
            enabled: true,
          }
          const editsWithBadEvidence = {
            ...sampleEdits,
            fit: {
              ...sampleEdits.fit,
              tips: [
                {
                  category: "requirements-inflation" as const,
                  severity: "caution" as const,
                  title: "Bad tip",
                  detail: "Detail",
                  evidence: "Not in listing",
                },
              ],
            },
          }
          const result = yield* service.validateEdits({
            content: sampleContent as any,
            edits: editsWithBadEvidence,
            cleanedListing: "We require TypeScript experience",
            policy,
          })
          expect(result.edits.fit.tips[0].evidence).toBe("")
          expect(result.edits.fit.tips[0].severity).toBe("info")
        })))

      it.effect("rejects tags not in vocabulary", () =>
        runTest(Effect.gen(function*() {
          const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
          const policy = {
            ...Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY,
            enabled: true,
          }
          const badEdits = {
            ...sampleEdits,
            tagGroups: [
              {
                entryId: "exp1",
                tags: ["TypeScript", "React", "Rust"], // Rust not in vocabulary (exp: TS/React/Node; proj: Python/Django)
              },
            ],
          }
          const result = yield* service.validateEdits({
            content: sampleContent as any,
            edits: badEdits,
            cleanedListing: "Test listing",
            policy,
          })
          expect(result.edits.tagGroups).toHaveLength(0)
          expect(result.dropped).toHaveLength(1)
          expect(result.dropped[0].reason).toBe("tag-not-in-vocabulary")
        })))
    })
  })

  describe("computeKeywordCoverage", () => {
    it.effect("computes matched keywords", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const result = yield* service.computeKeywordCoverage({
          merged: sampleContent as any,
          required: ["TypeScript", "React", "Python"],
        })
        expect(result.matched).toContain("TypeScript")
        expect(result.matched).toContain("React")
        expect(result.matched).toContain("Python")
      })))

    it.effect("computes missing keywords", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const result = yield* service.computeKeywordCoverage({
          merged: sampleContent as any,
          required: ["TypeScript", "Kubernetes", "AWS"],
        })
        expect(result.matched).toContain("TypeScript")
        expect(result.missing).toContain("Kubernetes")
        expect(result.missing).toContain("AWS")
      })))

    it.effect("is case-insensitive", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
        const result = yield* service.computeKeywordCoverage({
          merged: sampleContent as any,
          required: ["typescript", "REACT"],
        })
        expect(result.matched).toContain("typescript")
        expect(result.matched).toContain("REACT")
      })))
  })
})
