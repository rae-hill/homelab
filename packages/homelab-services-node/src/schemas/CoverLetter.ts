import { Schema } from "effect"

/**
 * Model-facing wire schema for cover-letter generation (stage 2 of the cover-letter
 * pipeline — docs/cover-letter-generator/01 §B).
 *
 * Strict-mode rules identical to Tailoring.ts: every object fully required,
 * additionalProperties:false, no refinements/transforms/pattern/length constraints.
 * Length and count bounds are enforced SERVER-SIDE in layers/cover-letter/validation.ts,
 * never in the schema (refinements break provider strict mode).
 *
 * Exposed as Schemas.CoverLetter.* from homelab-services-node.
 */
export const CoverLetterGeneration = Schema.Struct({
  /** Role-focused subject line; the template prepends "Regarding the". */
  subject: Schema.String,
  /** Body paragraphs in document order (3–5 expected; bounds enforced server-side). */
  paragraphs: Schema.Array(Schema.String),
})

export type CoverLetterGeneration = Schema.Schema.Type<typeof CoverLetterGeneration>
