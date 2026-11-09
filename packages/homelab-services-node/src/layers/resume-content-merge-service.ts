import { Effect, Layer, Schema } from "effect"
import { Schemas, Services } from "homelab-services"
import { ResumeContent } from "shared"
import type { ResumeContent as ResumeContentType } from "shared"
import type { TailorEdits } from "./tailor/wire-schema.js"

/**
 * Merge service implementation: mechanical merge + structural guard over ContentDiffer delta.
 *
 * Merge mechanics: ID-addressed domain mutation via structuredClone (M4-adjacent).
 * Structural guard (policy-driven, doc 07 §B.5):
 * - merged output must decode as ContentState
 * - replace: always allowed
 * - add: allowed iff !policy.enabled
 * - remove: ALWAYS rejected in v2
 * - enabled=true → replace-only (exact v1 strictness)
 *
 * Changes enrichment: for each delta op, look up previous at its path in the REQUEST content.
 */
export const makeResumeContentMergeService = () =>
  Layer.succeed(Services.ResumeContentMergeService.ResumeContentMergeService, {
    merge: Effect.fn("ResumeContentMergeService.merge")(function*(args: {
      content: ResumeContentType.ContentState
      edits: TailorEdits
      policy: Schemas.ResumeTailor.TailorValidationPolicy
    }) {
      // Deep copy via structuredClone (replaces JSON.parse/stringify idiom)
      const merged = structuredClone(args.content)

      // Apply headline → blurb
      const newBlurb = args.edits.headline !== null ? args.edits.headline : merged.blurb

      // Apply summary → aboutMe
      const newAboutMe = args.edits.summary !== null ? args.edits.summary : merged.aboutMe

      // Apply bullet edits
      const newExperience = merged.experience.map((exp) => {
        let newExp = { ...exp }

        // Apply entry description edits
        const descEdit = args.edits.entryDescriptions.find((d) => d.entryId === exp.id)
        if (descEdit) {
          newExp = { ...newExp, description: descEdit.description }
        }

        // Apply bullet edits
        let newBullets = newExp.bulletPoints
        for (const bulletEdit of args.edits.bullets) {
          if (bulletEdit.entryId === exp.id) {
            newBullets = newBullets.map((bp) => bp.id === bulletEdit.bulletId ? { ...bp, text: bulletEdit.text } : bp)
          }
        }

        // Apply hidden bullets (set visible = false)
        for (const hidden of args.edits.hiddenBullets) {
          if (hidden.entryId === exp.id) {
            newBullets = newBullets.map((bp) => bp.id === hidden.bulletId ? { ...bp, visible: false } : bp)
          }
        }

        newExp = { ...newExp, bulletPoints: newBullets }

        // Apply tag group reordering
        const tagEdit = args.edits.tagGroups.find((t) => t.entryId === exp.id)
        if (tagEdit) {
          newExp = { ...newExp, tags: [...tagEdit.tags] }
        }

        return newExp
      })

      // Apply to projects as well
      const newProjects = merged.projects.map((proj) => {
        let newProj = { ...proj }

        // Apply entry description edits
        const descEdit = args.edits.entryDescriptions.find((d) => d.entryId === proj.id)
        if (descEdit) {
          newProj = { ...newProj, description: descEdit.description }
        }

        // Apply tag group reordering
        const tagEdit = args.edits.tagGroups.find((t) => t.entryId === proj.id)
        if (tagEdit) {
          newProj = { ...newProj, tags: [...tagEdit.tags] }
        }

        return newProj
      })

      const mergedContent: ResumeContentType.ContentState = {
        ...merged,
        blurb: newBlurb,
        aboutMe: newAboutMe,
        experience: newExperience,
        projects: newProjects,
      }

      // Compute delta via ContentDiffer
      const delta = ResumeContent.ContentDiffer.diff(args.content, mergedContent)

      // Structural guard over delta ops
      for (const op of delta) {
        if (op.op === "remove") {
          // ALWAYS rejected in v2
          return yield* Effect.fail(
            new Services.ResumeContentMergeService.ContentMergeError({
              message: `Merge-delta guard: model produced 'remove' op at path ${op.path}, which is rejected in v2`,
              error: { op, path: op.path },
            }),
          )
        }

        if (op.op === "add" && args.policy.enabled) {
          // add only allowed when policy is disabled (permissive)
          return yield* Effect.fail(
            new Services.ResumeContentMergeService.ContentMergeError({
              message: `Merge-delta guard: policy.enabled=true but model produced 'add' op at path ${op.path}`,
              error: { op, path: op.path, policyEnabled: true },
            }),
          )
        }
      }

      // Schema-decode merged output to ensure it's valid ContentState
      const decoded = yield* Effect.try({
        try: () => Schema.decodeSync(ResumeContent.Schema.ContentState)(mergedContent),
        catch: (error) =>
          new Services.ResumeContentMergeService.ContentMergeError({
            message: "Merge output failed ContentState schema decode",
            error,
          }),
      })

      // Enrich delta with previous values
      const changes = yield* Effect.try({
        try: () =>
          delta.map((op) => {
            const previous = resolvePrevious(args.content, op.path)
            return {
              patch: op,
              previous,
            }
          }),
        catch: (error) =>
          new Services.ResumeContentMergeService.ContentMergeError({
            message: "Failed to enrich delta with previous values",
            error,
          }),
      })

      return {
        merged: decoded,
        delta,
        changes,
      }
    }),
  })

/**
 * Resolve the previous value at a JSON pointer path in the content.
 * Returns null for add ops or unresolvable paths.
 */
const resolvePrevious = (content: ResumeContentType.ContentState, path: string): unknown => {
  // add ops carry previous: null
  if (path.endsWith("/-") || path.includes("/-")) {
    return null
  }

  // Walk the path segments
  const segments = path.split("/").filter((s) => s !== "")
  let current: any = content

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return null
    }

    // Handle array indices
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10)
      if (isNaN(index) || index >= current.length) {
        return null
      }
      current = current[index]
    } else if (typeof current === "object") {
      if (!(segment in current)) {
        return null
      }
      current = current[segment]
    } else {
      return null
    }
  }

  return current
}

export const ResumeContentMergeServiceLive = makeResumeContentMergeService()
