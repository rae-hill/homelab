/**
 * Wire contract schemas for the resume tailor endpoint (POST /resume/tailor).
 *
 * These schemas define the request/response shapes for AI-assisted resume tailoring.
 * The content field uses ContentPatchBase64 from shared, which encodes ContentState as
 * a base64 JSON Patch against the frozen INITIAL_CONTENT_STATE defaults.
 */

import { Schema } from "effect"
import { ResumeContent } from "shared"
import { OptionalUnknown, OptionalWithDefault } from "./optionals.js"

/* ---- Validation Policy (T13) --------------------------------------------------------------- */

/**
 * Validation policy for the tailor pipeline (doc 07 §B.1). All fields defaulted → the schema
 * alone defines the permissive default policy (enabled=false skips semantic checks entirely).
 * Extensible: new rules = new defaulted fields (old clients keep decoding; T19 adds
 * allowedEditPaths).
 *
 * - enabled: master switch — false (default) → skip fabrication/evidence/tag checks
 * - requireTagsGloballyAvailable: tag vocabulary rule (enabled=true only)
 * - rejectFabricatedMetrics: fabrication guard (enabled=true only)
 * - groundTipsInListing: evidence substring check (enabled=true only)
 */
export const TailorValidationPolicy = Schema.Struct({
  enabled: OptionalWithDefault(Schema.Boolean, () => false),
  requireTagsGloballyAvailable: OptionalWithDefault(Schema.Boolean, () => true),
  rejectFabricatedMetrics: OptionalWithDefault(Schema.Boolean, () => true),
  groundTipsInListing: OptionalWithDefault(Schema.Boolean, () => true),
})

export type TailorValidationPolicy = Schema.Schema.Type<typeof TailorValidationPolicy>

/** Default validation policy (permissive: enabled=false). */
export const DEFAULT_TAILOR_VALIDATION_POLICY: TailorValidationPolicy = Schema.decodeUnknownSync(
  TailorValidationPolicy,
)({})

/**
 * TailorChange: a single content mutation enriched with the previous value at the path (for
 * the Changes tab UI). JsonPatch-native vocabulary (C3/M12). previous=null for add ops or
 * when the path is unresolvable in the request content.
 */
export const TailorChange = Schema.Struct({
  patch: ResumeContent.JsonPatchOperationSchema,
  previous: OptionalUnknown,
})

export type TailorChange = Schema.Schema.Type<typeof TailorChange>

/* ---- Request ------------------------------------------------------------------------------- */

/**
 * POST /resume/tailor request body.
 *
 * - listing: raw pasted job listing text (abuse bounds: 1–200,000 chars; server-side
 *   middle-truncation ~20k chars is the TailorService's job)
 * - content: user's current resume content as a base64 JSON Patch vs defaults
 * - baseVersion: CONTENT_DEFAULTS_VERSION from shared (server rejects mismatches with 4xx)
 */
export const ResumeTailorRequest = Schema.Struct({
  listing: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200_000)),
  content: ResumeContent.ContentPatchBase64,
  baseVersion: Schema.String,
})

export type ResumeTailorRequest = Schema.Schema.Type<typeof ResumeTailorRequest>

/* ---- Response: Fit Report ------------------------------------------------------------------ */

/**
 * Fit report: how well the tailored content matches the job listing.
 *
 * - verdict: overall fit assessment (strong|partial|weak)
 * - summary: one-paragraph summary of the fit
 * - tips: actionable suggestions for the user, each with:
 *   - category: closed list of concern types (requirements-inflation, buried-hard-gate, etc.)
 *   - severity: info|caution|blocker
 *   - title: short title
 *   - detail: detailed explanation
 *   - evidence: verbatim listing quote supporting the tip (or empty string)
 * - keywordCoverage: keyword extraction results
 *   - required: keywords the listing requires
 *   - matched: keywords the tailored content covers
 *   - missing: keywords the tailored content lacks
 */
export const FitReport = Schema.Struct({
  verdict: Schema.Literals(["strong", "partial", "weak"]),
  summary: Schema.String,
  tips: Schema.Array(
    Schema.Struct({
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
    }),
  ),
  keywordCoverage: Schema.Struct({
    required: Schema.Array(Schema.String),
    matched: Schema.Array(Schema.String),
    missing: Schema.Array(Schema.String),
  }),
})

export type FitReport = Schema.Schema.Type<typeof FitReport>

/* ---- Response: Tailor Meta ----------------------------------------------------------------- */

/**
 * Per-stage metadata for the two-stage AI pipeline (stage 1: cheap model cleanup,
 * stage 2: main model tailoring).
 *
 * - model: model slug used
 * - tokens: { input, output } token counts
 * - latencyMs: wall-clock latency in milliseconds
 */
const StageMeta = Schema.Struct({
  model: Schema.String,
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
  }),
  latencyMs: Schema.Number,
})

/**
 * Metadata for the tailor response.
 *
 * - stage1: stage 1 metadata (null if stage 1 failed and fell back to defaults)
 * - stage2: stage 2 metadata (null if stage 2 failed)
 * - degraded: true if the pipeline fell back to defaults or partial results
 * - cacheHit: reserved seam, always false in v1 (no cache until persistence work, D9)
 * - contentHash: sha256 of the encoded request content
 * - listingHash: sha256 of the normalized listing (cache-key ingredient + persistence seam)
 * - promptVersion: version tag for the prompts used
 * - schemaVersion: version tag for the response schema
 */
export const TailorMeta = Schema.Struct({
  stage1: Schema.NullOr(StageMeta),
  stage2: Schema.NullOr(StageMeta),
  degraded: Schema.Boolean,
  cacheHit: Schema.Boolean,
  contentHash: Schema.String,
  listingHash: Schema.String,
  promptVersion: Schema.String,
  schemaVersion: Schema.String,
})

export type TailorMeta = Schema.Schema.Type<typeof TailorMeta>

/* ---- Response ------------------------------------------------------------------------------ */

/**
 * POST /resume/tailor response body.
 *
 * - jobTitle: AI-extracted job title from the listing
 * - company: AI-extracted company name (null if not found)
 * - content: tailored resume content as a base64 JSON Patch vs defaults
 * - baseVersion: CONTENT_DEFAULTS_VERSION (matches request)
 * - fit: fit report (verdict, summary, tips, keyword coverage)
 * - meta: per-stage metadata (tokens, latency, models, degraded flag, hashes, versions)
 */
export const ResumeTailorResponse = Schema.Struct({
  jobTitle: Schema.String,
  company: Schema.NullOr(Schema.String),
  content: ResumeContent.ContentPatchBase64,
  baseVersion: Schema.String,
  fit: FitReport,
  meta: TailorMeta,
})

export type ResumeTailorResponse = Schema.Schema.Type<typeof ResumeTailorResponse>
