import { Effect, Layer } from "effect"
import { type Schemas, Services } from "homelab-services"
import type { ResumeContent } from "shared"
import type { TailorEdits } from "../schemas/Tailoring.js"

/**
 * Validation service implementation: policy-driven semantic validation of model edits.
 *
 * Policy semantics (doc 07 §B.1):
 * - enabled=false (default) → skip fabrication/evidence/tag checks entirely
 * - enabled=true → v1 behaviors with modifications:
 *   - fabrication check iff rejectFabricatedMetrics
 *   - evidence downgrade iff groundTipsInListing
 *   - tag vocabulary check iff requireTagsGloballyAvailable
 *   - tag rule: every tag in merged entry groups must exist in BASE CONTENT's tag vocabulary
 *   - v1's length-invariance rule is dropped
 * - Unknown-ID edits ALWAYS dropped (merge mechanics, not policy)
 */
export const makeResumeTailorValidationService = () =>
  Layer.succeed(Services.ResumeTailorValidationService.ResumeTailorValidationService, {
    validateEdits: Effect.fn("ResumeTailorValidationService.validateEdits")((args: {
      content: ResumeContent.ContentState
      edits: TailorEdits
      cleanedListing: string
      policy: Schemas.ResumeTailor.TailorValidationPolicy
    }) =>
      Effect.sync(() => {
        let edits = args.edits
        const dropped: Array<{ reason: string; detail: unknown }> = []

        // Always: ID resolution (merge mechanics, not policy)
        const idResolution = resolveIds(edits, args.content)
        edits = idResolution.edits
        for (const id of idResolution.dropped) {
          dropped.push({ reason: "unknown-id", detail: id })
        }

        // Policy-gated checks
        if (args.policy.enabled) {
          // Fabrication guard (iff rejectFabricatedMetrics)
          if (args.policy.rejectFabricatedMetrics) {
            const fabricationCheck = checkFabrication(edits, args.content, args.cleanedListing)
            edits = fabricationCheck.edits
            for (const detail of fabricationCheck.dropped) {
              dropped.push({ reason: "fabricated-content", detail })
            }
          }

          // Evidence guard (iff groundTipsInListing)
          if (args.policy.groundTipsInListing) {
            edits = checkEvidence(edits, args.cleanedListing)
          }

          // Tag vocabulary check (iff requireTagsGloballyAvailable)
          if (args.policy.requireTagsGloballyAvailable) {
            const tagCheck = checkTagVocabulary(edits, args.content)
            edits = tagCheck.edits
            for (const detail of tagCheck.rejected) {
              dropped.push({ reason: "tag-not-in-vocabulary", detail })
            }
          }
        }

        return { edits, dropped }
      })
    ),

    computeKeywordCoverage: Effect.fn("ResumeTailorValidationService.computeKeywordCoverage")((args: {
      merged: ResumeContent.ContentState
      required: ReadonlyArray<string>
    }) =>
      Effect.sync(() => {
        const contentJson = JSON.stringify(args.merged).toLowerCase()
        const matched: Array<string> = []
        const missing: Array<string> = []

        for (const keyword of args.required) {
          if (contentJson.includes(keyword.toLowerCase())) {
            matched.push(keyword)
          } else {
            missing.push(keyword)
          }
        }

        return { matched, missing }
      })
    ),
  })

// ─── ID Resolution ──────────────────────────────────────────────────────────

const resolveIds = (
  edits: TailorEdits,
  content: ResumeContent.ContentState,
): { edits: TailorEdits; dropped: ReadonlyArray<string> } => {
  const dropped: Array<string> = []

  // Build lookup maps
  const entryIds = new Set<string>()
  const bulletIdsByEntry = new Map<string, Set<string>>()

  for (const exp of content.experience) {
    entryIds.add(exp.id)
    const bulletIds = new Set(exp.bulletPoints.map((bp) => bp.id))
    bulletIdsByEntry.set(exp.id, bulletIds)
  }
  for (const proj of content.projects) {
    entryIds.add(proj.id)
    bulletIdsByEntry.set(proj.id, new Set()) // projects don't have bullets
  }

  // Filter bullets
  const validBullets = edits.bullets.filter((b) => {
    const entryExists = entryIds.has(b.entryId)
    const bulletExists = bulletIdsByEntry.get(b.entryId)?.has(b.bulletId)
    if (!entryExists || !bulletExists) {
      dropped.push(`${b.entryId}/${b.bulletId}`)
      return false
    }
    return true
  })

  // Filter entryDescriptions
  const validDescriptions = edits.entryDescriptions.filter((d) => {
    const exists = entryIds.has(d.entryId)
    if (!exists) {
      dropped.push(d.entryId)
      return false
    }
    return true
  })

  // Filter hiddenBullets
  const validHidden = edits.hiddenBullets.filter((h) => {
    const entryExists = entryIds.has(h.entryId)
    const bulletExists = bulletIdsByEntry.get(h.entryId)?.has(h.bulletId)
    if (!entryExists || !bulletExists) {
      dropped.push(`${h.entryId}/${h.bulletId}`)
      return false
    }
    return true
  })

  // Filter addedBullets
  const validAdded = edits.addedBullets.filter((a) => {
    const exists = entryIds.has(a.entryId)
    if (!exists) {
      dropped.push(a.entryId)
      return false
    }
    return true
  })

  // Filter tagGroups
  const validTags = edits.tagGroups.filter((t) => {
    const exists = entryIds.has(t.entryId)
    if (!exists) {
      dropped.push(t.entryId)
      return false
    }
    return true
  })

  return {
    edits: {
      ...edits,
      bullets: validBullets,
      entryDescriptions: validDescriptions,
      hiddenBullets: validHidden,
      addedBullets: validAdded,
      tagGroups: validTags,
    },
    dropped,
  }
}

// ─── Tag Vocabulary Check (v2: tags must exist in base content) ─────────────

const checkTagVocabulary = (
  edits: TailorEdits,
  content: ResumeContent.ContentState,
): { edits: TailorEdits; rejected: ReadonlyArray<string> } => {
  const rejected: Array<string> = []

  // Build tag vocabulary from base content (union of experience + projects tags)
  const tagVocabulary = new Set<string>()
  for (const exp of content.experience) {
    for (const tag of exp.tags) {
      tagVocabulary.add(tag)
    }
  }
  for (const proj of content.projects) {
    for (const tag of proj.tags) {
      tagVocabulary.add(tag)
    }
  }

  // Check each tag group: every tag must exist in vocabulary
  const validTags = edits.tagGroups.filter((tg) => {
    for (const tag of tg.tags) {
      if (!tagVocabulary.has(tag)) {
        rejected.push(`${tg.entryId}:${tag}`)
        return false
      }
    }
    return true
  })

  return {
    edits: { ...edits, tagGroups: validTags },
    rejected,
  }
}

// ─── Fabrication Guard ──────────────────────────────────────────────────────

const checkFabrication = (
  edits: TailorEdits,
  content: ResumeContent.ContentState,
  listing: string,
): { edits: TailorEdits; dropped: ReadonlyArray<string> } => {
  const dropped: Array<string> = []

  // Combine content + listing for grounding check
  const contentJson = JSON.stringify(content)
  const source = `${contentJson} ${listing}`.toLowerCase()

  // Extract numbers, percentages, capitalized words from text
  const extractSuspectTerms = (text: string): Array<string> => {
    const terms: Array<string> = []

    // Numbers (including decimals)
    const numbers = text.match(/\b\d+(?:\.\d+)?\b/g)
    if (numbers) numbers.forEach((n) => terms.push(n))

    // Percentages
    const percentages = text.match(/\d+(?:\.\d+)?%/g)
    if (percentages) percentages.forEach((p) => terms.push(p))

    // Capitalized words (potential proper nouns) — at least 2 chars
    const capitalized = text.match(/\b[A-Z][a-z]{1,}\b/g)
    if (capitalized) capitalized.forEach((c) => terms.push(c))

    return terms
  }

  // Check bullets
  const validBullets = edits.bullets.filter((b) => {
    const suspectTerms = extractSuspectTerms(b.text)
    for (const term of suspectTerms) {
      if (!source.includes(term.toLowerCase())) {
        dropped.push(`bullet:${b.entryId}/${b.bulletId}`)
        return false
      }
    }
    return true
  })

  // Check entryDescriptions
  const validDescriptions = edits.entryDescriptions.filter((d) => {
    const suspectTerms = extractSuspectTerms(d.description)
    for (const term of suspectTerms) {
      if (!source.includes(term.toLowerCase())) {
        dropped.push(`desc:${d.entryId}`)
        return false
      }
    }
    return true
  })

  // Check addedBullets (new bullets are highest fabrication risk)
  const validAdded = edits.addedBullets.filter((a) => {
    const suspectTerms = extractSuspectTerms(a.text)
    for (const term of suspectTerms) {
      if (!source.includes(term.toLowerCase())) {
        dropped.push(`added:${a.entryId}`)
        return false
      }
    }
    return true
  })

  return {
    edits: {
      ...edits,
      bullets: validBullets,
      entryDescriptions: validDescriptions,
      addedBullets: validAdded,
    },
    dropped,
  }
}

// ─── Evidence Guard ─────────────────────────────────────────────────────────

const checkEvidence = (
  edits: TailorEdits,
  cleanedListing: string,
): TailorEdits => {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
  const normalizedListing = normalize(cleanedListing)

  const validatedTips = edits.fit.tips.map((tip) => {
    if (tip.evidence === "") return tip

    const normalizedEvidence = normalize(tip.evidence)
    if (normalizedListing.includes(normalizedEvidence)) {
      return tip
    }

    // Evidence not found — downgrade to info + empty evidence
    return {
      ...tip,
      severity: "info" as const,
      evidence: "",
    }
  })

  return {
    ...edits,
    fit: {
      ...edits.fit,
      tips: validatedTips,
    },
  }
}

export const ResumeTailorValidationServiceLive = makeResumeTailorValidationService()
