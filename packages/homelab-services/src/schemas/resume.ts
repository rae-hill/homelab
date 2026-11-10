import { Schema } from "effect"
import { PrintConfig } from "shared"
import { OptionalWithDefault } from "./optionals.js"

/**
 * Schemas for the `/resume` group — server-side PDF rendering of the resume site
 * (https://resume.rae-hill.dev) via headless chrome.
 */

/** Color mode the resume page is rendered in before printing. */
export const PrintTheme = Schema.Literals(["light", "dark"])

export type PrintTheme = typeof PrintTheme.Type

/** Output document format for the rendered resume. */
export const PrintOutputFormat = Schema.Literals(["pdf", "docx"])

export type PrintOutputFormat = typeof PrintOutputFormat.Type

/**
 * POST /resume/print request body. The base64 blob is validated against the persisted
 * print-config schema (from `shared`) but stays a `string` on the wire so the handler
 * can forward it verbatim into the resume URL's `importPrintSettings` query param.
 */
export const ResumePrintRequest = Schema.Struct({
  config: PrintConfig.ConfigBase64String,
})

export type ResumePrintRequest = typeof ResumePrintRequest.Type

/**
 * POST /resume/print query params; `theme` defaults to `"light"` and
 * `outputFormat` to `"pdf"` when absent. Both keys stay optional on the wire
 * (decoding defaults), so older deployed SPA builds keep working.
 */
export const ResumePrintQuery = Schema.Struct({
  theme: OptionalWithDefault(PrintTheme, () => "light" as const),
  outputFormat: OptionalWithDefault(PrintOutputFormat, () => "pdf" as const),
})

export type ResumePrintQuery = typeof ResumePrintQuery.Type
