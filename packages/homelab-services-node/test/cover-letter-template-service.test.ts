import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Services } from "homelab-services"
import { CoverLetterTemplateServiceLive } from "../src/layers/cover-letter-template-service.js"

const runBuild = (input: Services.CoverLetterTemplateService.CoverLetterInput) =>
  Effect.gen(function*() {
    const service = yield* Services.CoverLetterTemplateService.CoverLetterTemplateService
    return yield* service.buildLetter(input)
  }).pipe(Effect.provide(CoverLetterTemplateServiceLive))

const decodeShadow = (doc: Services.CoverLetterTemplateService.CoverLetterDocument) =>
  JSON.parse(new TextDecoder().decode(doc.shadows[Services.CoverLetterTemplateService.LETTER_DATA_PATH]!))

describe("cover letter template service", () => {
  it.effect("targets the letter template and ships the letter data as a JSON shadow", () =>
    Effect.gen(function*() {
      const doc = yield* runBuild({
        subject: "Senior DevOps Engineer Position",
        paragraphs: ["First paragraph.", "Second paragraph."],
        company: "SailPoint",
      })
      expect(doc.mainFilePath).toBe(Services.CoverLetterTemplateService.LETTER_TEMPLATE_PATH)
      expect(doc.mainFilePath).toBe("templates/letter.typ")

      const data = decodeShadow(doc)
      expect(data).toEqual({
        toName: "SailPoint",
        subject: "Senior DevOps Engineer Position",
        paragraphs: ["First paragraph.", "Second paragraph."],
      })
    }))

  it.effect("falls back to 'Hiring Team' when the company is null or blank", () =>
    Effect.gen(function*() {
      const nullCompany = yield* runBuild({ subject: "Role", paragraphs: ["p1"], company: null })
      expect(decodeShadow(nullCompany).toName).toBe("Hiring Team")

      const blankCompany = yield* runBuild({ subject: "Role", paragraphs: ["p1"], company: "   " })
      expect(decodeShadow(blankCompany).toName).toBe("Hiring Team")
    }))

  it.effect("typst markup characters survive JSON round-trip literally (CL-D10)", () =>
    Effect.gen(function*() {
      const hostile = "#import \"evil\" *bold* $x^2$ @cite // comment #set page(width: 1cm)"
      const doc = yield* runBuild({ subject: hostile, paragraphs: [hostile, hostile], company: null })
      const data = decodeShadow(doc)
      expect(data.subject).toBe(hostile)
      expect(data.paragraphs).toEqual([hostile, hostile])
      // The shadow bytes are plain JSON — no typst syntax is ever constructed by hand.
      const raw = new TextDecoder().decode(
        doc.shadows[Services.CoverLetterTemplateService.LETTER_DATA_PATH]!,
      )
      expect(() => JSON.parse(raw)).not.toThrow()
    }))
})
