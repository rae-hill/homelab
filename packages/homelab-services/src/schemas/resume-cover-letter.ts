/**
 * Wire contract schema for the cover-letter endpoint (POST /resume/cover-letter).
 *
 * Mirrors ResumeTailorRequest (CL-D2): the client sends the raw listing plus the ENTRY's
 * tailored content as a base64 JSON Patch against the frozen shared defaults; the patch
 * decodes to a ContentState at the HttpApi edge. The response is raw PDF bytes — declared
 * on the endpoint definition (homelab-api), not here (print.ts precedent).
 */

import { Schema } from "effect"
import { ResumeContent } from "shared"

/**
 * POST /resume/cover-letter request body.
 *
 * - listing: raw pasted job listing text (abuse bounds identical to tailor: 1–200,000
 *   chars; server-side hygiene + middle-truncation is the CoverLetterService's job)
 * - content: the tailored resume content for this listing, as a base64 JSON Patch vs
 *   the frozen defaults (decodes to ContentState at the edge)
 * - baseVersion: CONTENT_DEFAULTS_VERSION from shared (server rejects mismatches with 400)
 */
export const ResumeCoverLetterRequest = Schema.Struct({
  listing: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200_000)),
  content: ResumeContent.ContentPatchBase64,
  baseVersion: Schema.String,
})

export type ResumeCoverLetterRequest = Schema.Schema.Type<typeof ResumeCoverLetterRequest>
