import { Context, Data, Effect } from "effect"

export const CoverLetterTemplateServiceId = "homelab-api/services/cover-letter/CoverLetterTemplateService"

/** Raised when the letter content cannot be assembled into a Typst render request. */
export class CoverLetterTemplateError extends Data.TaggedError("CoverLetterTemplateError")<{
  readonly message: string
  readonly error: unknown
}> {}

/** Workspace-relative path of the letterloom-based template inside the Typst assets dir. */
export const LETTER_TEMPLATE_PATH = "templates/letter.typ"

/**
 * Workspace-relative shadow key for the generated letter data. The template reads it with
 * `json("letter.json")`; string values joined into content are LITERAL Typst text, so
 * model-generated markup characters are inert (CL-D10 — verified by smoke render).
 */
export const LETTER_DATA_PATH = "templates/letter.json"

/** Validated generation output + stage-1 metadata needed by the template. */
export interface CoverLetterInput {
  readonly subject: string
  readonly paragraphs: ReadonlyArray<string>
  readonly company: string | null
}

/** A fully-specified Typst render request (consumed by DocumentRenderingServiceTypst). */
export interface CoverLetterDocument {
  /** Workspace-relative main file path. */
  readonly mainFilePath: string
  /** Workspace-relative shadow paths → bytes. */
  readonly shadows: Readonly<Record<string, Uint8Array>>
}

export interface CoverLetterTemplateServiceDef {
  /**
   * Assemble the render request: the on-disk template as main file + the generated letter
   * as a shadow-mapped JSON data file (`/letter.json` never touches Typst syntax —
   * JSON.stringify is the escaping layer).
   */
  readonly buildLetter: (input: CoverLetterInput) => Effect.Effect<CoverLetterDocument, CoverLetterTemplateError>
}

export class CoverLetterTemplateService
  extends Context.Service<CoverLetterTemplateService, CoverLetterTemplateServiceDef>()(
    CoverLetterTemplateServiceId,
  )
{}

/** {@inheritDoc CoverLetterTemplateServiceDef.buildLetter} */
export const buildLetter = Effect.fn("CoverLetterTemplateService.buildLetter")(function*(
  ...params: Parameters<CoverLetterTemplateServiceDef["buildLetter"]>
): Effect.fn.Return<CoverLetterDocument, CoverLetterTemplateError, CoverLetterTemplateService> {
  const svc = yield* CoverLetterTemplateService
  return yield* svc.buildLetter(...params)
})
