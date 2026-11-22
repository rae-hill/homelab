import { Effect, Layer } from "effect"
import { Services, Utils } from "homelab-services"

/**
 * Cover-letter template service (doc 02 §D): content assembly ("what"), split from
 * compilation ("how" — DocumentRenderingServiceTypst).
 *
 * The generated letter travels as a JSON data file that the template reads with `json()`
 * and joins as strings — JSON.stringify IS the escaping layer, so no hand-rolled Typst
 * escaping exists anywhere (CL-D10; injection-safety verified by smoke render).
 *
 * Pure: no FileSystem reads — the compiler resolves the template + signature image from
 * its workspace (the Typst assets dir) on disk.
 */
export const makeCoverLetterTemplateService = () =>
  Layer.succeed(Services.CoverLetterTemplateService.CoverLetterTemplateService, {
    buildLetter: Effect.fn("CoverLetterTemplateService.buildLetter")(
      function*(
        input: Services.CoverLetterTemplateService.CoverLetterInput,
      ): Effect.fn.Return<
        Services.CoverLetterTemplateService.CoverLetterDocument,
        Services.CoverLetterTemplateService.CoverLetterTemplateError
      > {
        const company = input.company?.trim()
        const payload = {
          toName: company !== undefined && company.length > 0 ? company : "Hiring Team",
          subject: input.subject,
          paragraphs: [...input.paragraphs],
        }
        const json = yield* Effect.try({
          try: () => JSON.stringify(payload),
          catch: (error) =>
            new Services.CoverLetterTemplateService.CoverLetterTemplateError({
              message: "cover-letter data serialization failed",
              error: Utils.errorToJson(error),
            }),
        })
        return {
          mainFilePath: Services.CoverLetterTemplateService.LETTER_TEMPLATE_PATH,
          shadows: {
            [Services.CoverLetterTemplateService.LETTER_DATA_PATH]: new TextEncoder().encode(json),
          },
        }
      },
    ),
  })

export const CoverLetterTemplateServiceLive = makeCoverLetterTemplateService()
