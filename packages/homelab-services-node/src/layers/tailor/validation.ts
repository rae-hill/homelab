import type { ResumeContent } from "shared"
import type { TailorEdits } from "./wire-schema.js"

/**
 * Validation pipeline for stage 2 output.
 *
 * Pure functions implementing the guards from doc 02 §G:
 * 1. Decode (handled by caller via schemaBodyJson)
 * 2. ID resolution — drop edits referencing unknown entryId/bulletId
 * 3. Tag length-invariance + membership — reject groups that change length/members
 * 4. Fabrication guard — drop edits with numbers/percentages/proper nouns absent from content+listing
 * 5. Evidence guard — fail → severity "info" + evidence ""
 * 6. Merge — apply validated edits to deep copy of content
 * 7. Keyword coverage — compute matched/missing server-side
 * 8. Merge-delta assertion — assert delta is replace-only
 * 9. Degraded fallback — any hard failure → no-op content + surviving tips
 */

// ─── 2. ID Resolution ──────────────────────────────────────────────────────────

/**
 * Drop edits referencing unknown entryId or bulletId.
 * Returns validated edits + list of dropped IDs (for logging).
 */
export const resolveIds = (
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
    const bulletIds = new Set(proj.tags.map((_, i) => `tag-${i}`)) // projects don't have bullets
    bulletIdsByEntry.set(proj.id, bulletIds)
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
      tagGroups: validTags,
    },
    dropped,
  }
}

// ─── 3. Tag Length-Invariance + Membership ─────────────────────────────────────

/**
 * Reject tag groups that change length or membership.
 * Returns validated edits + list of rejected entryIds (for logging).
 */
export const checkTagInvariance = (
  edits: TailorEdits,
  content: ResumeContent.ContentState,
): { edits: TailorEdits; rejected: ReadonlyArray<string> } => {
  const rejected: Array<string> = []

  // Build tag lookup
  const tagSetsByEntry = new Map<string, Set<string>>()
  for (const exp of content.experience) {
    tagSetsByEntry.set(exp.id, new Set(exp.tags))
  }
  for (const proj of content.projects) {
    tagSetsByEntry.set(proj.id, new Set(proj.tags))
  }

  const validTags = edits.tagGroups.filter((tg) => {
    const currentTags = tagSetsByEntry.get(tg.entryId)
    if (!currentTags) {
      rejected.push(tg.entryId)
      return false
    }

    const newTags = new Set(tg.tags)

    // Check length invariance
    if (newTags.size !== currentTags.size) {
      rejected.push(tg.entryId)
      return false
    }

    // Check membership
    for (const tag of newTags) {
      if (!currentTags.has(tag)) {
        rejected.push(tg.entryId)
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

// ─── 4. Fabrication Guard ──────────────────────────────────────────────────────

/**
 * Drop edits with numbers/percentages/capitalized proper nouns absent from content+listing.
 * Pragmatic ~20-40 lines.
 */
export const checkFabrication = (
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

  return {
    edits: {
      ...edits,
      bullets: validBullets,
      entryDescriptions: validDescriptions,
    },
    dropped,
  }
}

// ─── 5. Evidence Guard ─────────────────────────────────────────────────────────

/**
 * Normalize whitespace+case, substring-test against CLEANED listing.
 * Failures → downgrade to info/empty or drop.
 */
export const checkEvidence = (
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

// ─── 6. Merge ──────────────────────────────────────────────────────────────────

/**
 * Apply validated edits to a deep copy of content via pure domain mutation.
 * Returns new ContentState.
 */
export const mergeEdits = (
  content: ResumeContent.ContentState,
  edits: TailorEdits,
): ResumeContent.ContentState => {
  // Deep copy to avoid mutation
  const merged = JSON.parse(JSON.stringify(content)) as ResumeContent.ContentState

  // Apply headline → blurb
  const newBlurb = edits.headline !== null ? edits.headline : merged.blurb

  // Apply summary → aboutMe
  const newAboutMe = edits.summary !== null ? edits.summary : merged.aboutMe

  // Apply bullet edits
  const newExperience = merged.experience.map((exp) => {
    let newExp = { ...exp }

    // Apply entry description edits
    const descEdit = edits.entryDescriptions.find((d) => d.entryId === exp.id)
    if (descEdit) {
      newExp = { ...newExp, description: descEdit.description }
    }

    // Apply bullet edits
    let newBullets = newExp.bulletPoints
    for (const bulletEdit of edits.bullets) {
      if (bulletEdit.entryId === exp.id) {
        newBullets = newBullets.map((bp) => bp.id === bulletEdit.bulletId ? { ...bp, text: bulletEdit.text } : bp)
      }
    }

    // Apply hidden bullets (set visible = false)
    for (const hidden of edits.hiddenBullets) {
      if (hidden.entryId === exp.id) {
        newBullets = newBullets.map((bp) => bp.id === hidden.bulletId ? { ...bp, visible: false } : bp)
      }
    }

    newExp = { ...newExp, bulletPoints: newBullets }

    // Apply tag group reordering
    const tagEdit = edits.tagGroups.find((t) => t.entryId === exp.id)
    if (tagEdit) {
      newExp = { ...newExp, tags: [...tagEdit.tags] }
    }

    return newExp
  })

  // Apply to projects as well
  const newProjects = merged.projects.map((proj) => {
    let newProj = { ...proj }

    // Apply entry description edits
    const descEdit = edits.entryDescriptions.find((d) => d.entryId === proj.id)
    if (descEdit) {
      newProj = { ...newProj, description: descEdit.description }
    }

    // Apply tag group reordering
    const tagEdit = edits.tagGroups.find((t) => t.entryId === proj.id)
    if (tagEdit) {
      newProj = { ...newProj, tags: [...tagEdit.tags] }
    }

    return newProj
  })

  return {
    ...merged,
    blurb: newBlurb,
    aboutMe: newAboutMe,
    experience: newExperience,
    projects: newProjects,
  }
}

// ─── 7. Keyword Coverage ───────────────────────────────────────────────────────

/**
 * Compute matched/missing server-side against merged content (normalized comparison).
 */
export const computeKeywordCoverage = (
  required: ReadonlyArray<string>,
  mergedContent: ResumeContent.ContentState,
): { matched: ReadonlyArray<string>; missing: ReadonlyArray<string> } => {
  const contentJson = JSON.stringify(mergedContent).toLowerCase()
  const matched: Array<string> = []
  const missing: Array<string> = []

  for (const keyword of required) {
    if (contentJson.includes(keyword.toLowerCase())) {
      matched.push(keyword)
    } else {
      missing.push(keyword)
    }
  }

  return { matched, missing }
}
