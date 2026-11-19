import type { CoverLetterGeneration } from "../../schemas/CoverLetter.js"

/**
 * Light validation guards for generated cover letters (doc 01 §D — v1 policy).
 *
 * Hard failures (violations) are 500s via CoverLetterError — NO silent trimming.
 * The deferred fabrication guard (numbers/proper nouns ⊆ content+listing) is README OQ3;
 * the human review control is the downloaded PDF itself.
 */

export interface CoverLetterValidationLimits {
  readonly minParagraphs: number
  readonly maxParagraphs: number
  readonly minParagraphChars: number
  readonly maxParagraphChars: number
  readonly maxTotalChars: number
  readonly maxSubjectChars: number
}

export const defaultCoverLetterLimits: CoverLetterValidationLimits = {
  minParagraphs: 2,
  maxParagraphs: 6,
  minParagraphChars: 40,
  maxParagraphChars: 1500,
  maxTotalChars: 6000,
  maxSubjectChars: 120,
}

/**
 * Zero-width + bidi-override + control chars — the output-side sibling of input
 * hygienization. Bidi overrides (\u202A-\u202E, \u2066-\u2069) are spoofing vectors in
 * rendered PDFs, so they are stripped too.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g

/** Strip invisible/control characters from generated text (never changes visible content). */
export const scrubGeneratedText = (text: string): string => text.replace(INVISIBLE_CHARS, "")

/**
 * Validate + scrub one generation. Returns the scrubbed letter on success, or the list of
 * violations (empty array = valid). Pure — trivially unit-testable.
 */
export const validateCoverLetterGeneration = (
  generation: CoverLetterGeneration,
  limits: CoverLetterValidationLimits = defaultCoverLetterLimits,
): { readonly ok: true; readonly subject: string; readonly paragraphs: ReadonlyArray<string> } | {
  readonly ok: false
  readonly violations: ReadonlyArray<string>
} => {
  const violations: string[] = []
  const subject = scrubGeneratedText(generation.subject).trim()
  const paragraphs = generation.paragraphs.map((p) => scrubGeneratedText(p).trim())

  if (subject.length === 0) {
    violations.push("subject is empty")
  } else if (subject.length > limits.maxSubjectChars) {
    violations.push(`subject exceeds ${limits.maxSubjectChars} chars (${subject.length})`)
  } else if (subject.includes("\n")) {
    violations.push("subject must be a single line")
  }

  if (paragraphs.length < limits.minParagraphs) {
    violations.push(`fewer than ${limits.minParagraphs} paragraphs (${paragraphs.length})`)
  } else if (paragraphs.length > limits.maxParagraphs) {
    violations.push(`more than ${limits.maxParagraphs} paragraphs (${paragraphs.length})`)
  }

  const total = paragraphs.reduce((sum, p) => sum + p.length, 0)
  if (total > limits.maxTotalChars) {
    violations.push(`letter body exceeds ${limits.maxTotalChars} chars (${total})`)
  }

  paragraphs.forEach((paragraph, index) => {
    if (paragraph.length < limits.minParagraphChars) {
      violations.push(`paragraph ${index} is shorter than ${limits.minParagraphChars} chars (${paragraph.length})`)
    } else if (paragraph.length > limits.maxParagraphChars) {
      violations.push(`paragraph ${index} exceeds ${limits.maxParagraphChars} chars (${paragraph.length})`)
    }
  })

  if (violations.length > 0) {
    return { ok: false, violations }
  }
  return { ok: true, subject, paragraphs }
}
