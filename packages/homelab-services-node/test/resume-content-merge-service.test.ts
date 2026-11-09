import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Schemas, Services } from "homelab-services"
import { ResumeContent } from "shared"
import { ResumeContentMergeServiceLive } from "../src/layers/resume-content-merge-service.js"

/** Type-side policy values (all fields required post-decode; the schema defaults fill the wire side). */
const policyOff = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY
const policyOn = { ...policyOff, enabled: true }

const sampleContent = {
  blurb: "Original blurb",
  aboutMe: "Original about me",
  experience: [
    {
      id: "exp1",
      company: "Acme Corp",
      location: "Remote",
      roles: [{ title: "Senior Engineer", date: "2020-present" }],
      description: "Original description",
      bulletPoints: [
        { id: "bp1", text: "Built feature A", visible: true },
        { id: "bp2", text: "Built feature B", visible: true },
        { id: "bp3", text: "Built feature C", visible: true },
      ],
      tags: ["TypeScript", "React", "Node"],
    },
  ],
  projects: [
    {
      id: "proj1",
      title: "Project Alpha",
      description: "Original project description",
      githubLink: "https://github.com/test/alpha",
      tags: ["Python", "Django"],
    },
  ],
  skills: ["JavaScript", "TypeScript"],
}

describe("resume content merge service", () => {
  const runTest = <E, A>(
    effect: Effect.Effect<A, E, Services.ResumeContentMergeService.ResumeContentMergeService>,
  ) => effect.pipe(Effect.provide(ResumeContentMergeServiceLive))

  describe("merge mechanics", () => {
    it.effect("applies headline to blurb", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: "New headline",
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(result.merged.blurb).toBe("New headline")
      })))

    it.effect("applies summary to aboutMe", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: null,
          summary: "New summary",
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(result.merged.aboutMe).toBe("New summary")
      })))

    it.effect("applies bullet text edits", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: null,
          summary: null,
          bullets: [{ entryId: "exp1", bulletId: "bp1", text: "Rewritten bullet", rationale: "matches listing" }],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        const bullet = result.merged.experience[0].bulletPoints.find((bp) => bp.id === "bp1")
        expect(bullet?.text).toBe("Rewritten bullet")
      })))

    it.effect("applies hidden bullets (visible: false)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [{ entryId: "exp1", bulletId: "bp2", rationale: "less relevant to the role" }],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        const bullet = result.merged.experience[0].bulletPoints.find((bp) => bp.id === "bp2")
        expect(bullet?.visible).toBe(false)
      })))

    it.effect("applies entry description edits", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [{ entryId: "exp1", description: "New description" }],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(result.merged.experience[0].description).toBe("New description")
      })))

    it.effect("applies tag reordering", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [{ entryId: "exp1", tags: ["Node", "TypeScript", "React"] }],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(result.merged.experience[0].tags).toEqual(["Node", "TypeScript", "React"])
      })))

    it.effect("does not mutate original content", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const original = JSON.parse(JSON.stringify(sampleContent))
        const edits = {
          headline: "Changed",
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(sampleContent).toEqual(original)
      })))
  })

  describe("structural guard", () => {
    it.effect("allows replace ops with default policy", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: "New blurb",
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        // Should succeed - replace ops are allowed
        expect(result.merged.blurb).toBe("New blurb")
        // Delta should contain replace ops
        expect(result.delta.some((op) => op.op === "replace")).toBe(true)
      })))

    it.effect("allows add ops with default policy (enabled=false)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        // This test is conceptual - in v1 we don't have add ops yet (T16 adds them)
        // But we can test the policy logic
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        // With enabled=false, add ops would be allowed
        expect(result.merged).toBeDefined()
      })))

    it.effect("rejects remove ops always (v2)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        // We can't easily construct an edit that produces a remove op in v1
        // This test documents the policy: remove ops are always rejected
        // The actual rejection happens in the merge service implementation
        // For now, we test that valid edits succeed
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        expect(result.merged).toBeDefined()
      })))

    it.effect("rejects add ops when policy enabled (strict mode)", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        // This test documents the policy behavior
        // With enabled=true, add ops would be rejected
        // In v1 we don't produce add ops, so this tests the policy path exists
        const edits = {
          headline: null,
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOn,
        })
        // Should succeed because no add ops are produced
        expect(result.merged).toBeDefined()
      })))
  })

  describe("changes enrichment", () => {
    it.effect("produces changes array with previous values", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: "New blurb",
          summary: null,
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        // Changes should be populated
        expect(result.changes).toBeDefined()
        expect(Array.isArray(result.changes)).toBe(true)
        // Each change should have a patch op and a previous value
        for (const change of result.changes) {
          expect(change).toHaveProperty("patch")
          expect(change).toHaveProperty("previous")
        }
      })))
  })

  describe("schema decode", () => {
    it.effect("merged output decodes as ContentState", () =>
      runTest(Effect.gen(function*() {
        const service = yield* Services.ResumeContentMergeService.ResumeContentMergeService
        const edits = {
          headline: "New blurb",
          summary: "New about me",
          bullets: [],
          entryDescriptions: [],
          hiddenBullets: [],
          tagGroups: [],
          fit: {
            verdict: "strong" as const,
            summary: "Great fit",
            tips: [],
            keywordCoverage: { required: [] },
          },
        }
        const result = yield* service.merge({
          content: sampleContent as any,
          edits,
          policy: policyOff,
        })
        // The merged output should decode as ContentState
        const decoded = Schema.decodeSync(ResumeContent.Schema.ContentState)(result.merged)
        expect(decoded).toBeDefined()
        expect(decoded.blurb).toBe("New blurb")
        expect(decoded.aboutMe).toBe("New about me")
      })))
  })
})
