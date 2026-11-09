import { Schema } from "effect"

/**
 * Model-facing wire schemas for the two-stage AI pipeline.
 *
 * Stage 1 (cleanup): extractive-only deletion + title/company extraction
 * Stage 2 (tailor): constrained ID-addressed edits + fit report
 *
 * Strict-mode rules: every object fully required, additionalProperties:false,
 * NullOr not optional, no refinements/transforms/pattern/length constraints.
 *
 * Now exposed as Schemas.Tailoring.* from homelab-services-node.
 */

// ─── Stage 1: Cleanup ─────────────────────────────────────────────────────────

export const CleanupResponse = Schema.Struct({
  cleanedListing: Schema.String,
  jobTitle: Schema.String,
  company: Schema.NullOr(Schema.String),
})

export type CleanupResponse = Schema.Schema.Type<typeof CleanupResponse>

// ─── Stage 2: Tailor ──────────────────────────────────────────────────────────

const TailorBullet = Schema.Struct({
  entryId: Schema.String,
  bulletId: Schema.String,
  text: Schema.String,
  rationale: Schema.String,
})

const TailorEntryDescription = Schema.Struct({
  entryId: Schema.String,
  description: Schema.String,
})

const TailorHiddenBullet = Schema.Struct({
  entryId: Schema.String,
  bulletId: Schema.String,
  rationale: Schema.String,
})

const TailorAddedBullet = Schema.Struct({
  entryId: Schema.String,
  text: Schema.String,
  rationale: Schema.String,
})

const TailorTagGroup = Schema.Struct({
  entryId: Schema.String,
  tags: Schema.Array(Schema.String),
})

const FitTip = Schema.Struct({
  category: Schema.Literals([
    "requirements-inflation",
    "buried-hard-gate",
    "title-scope-mismatch",
    "logistics",
    "employment-form",
    "compensation",
    "screening-risk",
    "process",
    "listing-quality",
  ]),
  severity: Schema.Literals(["info", "caution", "blocker"]),
  title: Schema.String,
  detail: Schema.String,
  evidence: Schema.String,
})

const FitReport = Schema.Struct({
  verdict: Schema.Literals(["strong", "partial", "weak"]),
  summary: Schema.String,
  tips: Schema.Array(FitTip),
  keywordCoverage: Schema.Struct({
    required: Schema.Array(Schema.String),
  }),
})

export const TailorEdits = Schema.Struct({
  headline: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  bullets: Schema.Array(TailorBullet),
  entryDescriptions: Schema.Array(TailorEntryDescription),
  hiddenBullets: Schema.Array(TailorHiddenBullet),
  addedBullets: Schema.Array(TailorAddedBullet),
  tagGroups: Schema.Array(TailorTagGroup),
  fit: FitReport,
})

export type TailorEdits = Schema.Schema.Type<typeof TailorEdits>
