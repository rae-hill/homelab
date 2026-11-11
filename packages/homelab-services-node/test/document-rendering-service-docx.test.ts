import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Services } from "homelab-services"
import {
  DocumentRenderingServiceDocxLive,
  type HtmlToDocxLike,
  makeDocumentRenderingServiceDocx,
} from "../src/layers/document-rendering-service-docx.js"

/** A fake converter that captures the library-shaped options the adapter produced. */
function capturingFake(result: () => Promise<unknown>) {
  const captured: Array<Record<string, unknown>> = []
  const fake: HtmlToDocxLike = (_html, _header, options, _footer) => {
    captured.push(options)
    return result()
  }
  return { captured, layer: makeDocumentRenderingServiceDocx(fake) }
}

const DOCX_MAGIC = [0x50, 0x4b, 0x03, 0x04]

describe("DocumentRenderingServiceDocx", () => {
  it.effect("maps platform-neutral options onto the library shape", () => {
    const { captured, layer } = capturingFake(() => Promise.resolve(Buffer.from("PK")))
    return Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      yield* svc.formatHtml("<p>x</p>", {
        orientation: "landscape",
        margins: { top: 720, right: 360, bottom: 720, left: 360 },
        font: "Calibri",
        fontSizePt: 11,
        title: "Resume",
        subject: "Sub",
        creator: "Rae",
        pageNumber: true,
      })

      expect(captured).toHaveLength(1)
      const options = captured[0]!
      expect(options.orientation).toBe("landscape")
      expect(options.margins).toEqual({ top: 720, right: 360, bottom: 720, left: 360 })
      expect(options.font).toBe("Calibri")
      // points → half-points conversion lives in the adapter
      expect(options.fontSize).toBe(22)
      expect(options.title).toBe("Resume")
      expect(options.subject).toBe("Sub")
      expect(options.creator).toBe("Rae")
      expect(options.pageNumber).toBe(true)
      expect(options.imageProcessing).toEqual({ svgHandling: "convert" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("omits unset options and always forces SVG conversion", () => {
    const { captured, layer } = capturingFake(() => Promise.resolve(Buffer.alloc(0)))
    return Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      yield* svc.formatHtml("<p>x</p>")

      expect(captured).toEqual([{ imageProcessing: { svgHandling: "convert" } }])
    }).pipe(Effect.provide(layer))
  })

  it.effect("returns a platform-neutral Uint8Array copy of the conversion result", () => {
    const payload = Buffer.from(DOCX_MAGIC.concat([0x01, 0x02]))
    const { layer } = capturingFake(() => Promise.resolve(payload))
    return Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      const bytes = yield* svc.formatHtml("<p>x</p>")

      expect(bytes).toBeInstanceOf(Uint8Array)
      // NOT the Node Buffer instance itself (platform neutrality, doc 08 N7)
      expect(Buffer.isBuffer(bytes)).toBe(false)
      expect(Array.from(bytes)).toEqual(Array.from(payload))
    }).pipe(Effect.provide(layer))
  })

  it.effect("wraps conversion failures in DocumentRenderingServiceError", () => {
    const { layer } = capturingFake(() => Promise.reject(new Error("boom")))
    return Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      const failure = yield* svc.formatHtml("<p>x</p>").pipe(Effect.flip)

      expect(failure._tag).toBe("DocumentRenderingServiceError")
      if (failure._tag === "DocumentRenderingServiceError") {
        expect(failure.message).toBe("html-to-docx conversion failed")
      }
    }).pipe(Effect.provide(layer))
  })

  it.effect("wraps unsupported result types (e.g. Blob) in DocumentRenderingServiceError", () => {
    const { layer } = capturingFake(() => Promise.resolve("not-bytes"))
    return Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      const failure = yield* svc.formatHtml("<p>x</p>").pipe(Effect.flip)

      expect(failure._tag).toBe("DocumentRenderingServiceError")
    }).pipe(Effect.provide(layer))
  })

  it.effect("live layer converts real HTML into a DOCX (zip) container", () =>
    Effect.gen(function*() {
      const svc = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

      const bytes = yield* svc.formatHtml("<h1>Rae Hill</h1><p>Software engineer</p>")

      // DOCX = ZIP container: PK\x03\x04 local-file-header magic
      expect(Array.from(bytes.slice(0, 4))).toEqual(DOCX_MAGIC)
      expect(bytes.length).toBeGreaterThan(1_000)
    }).pipe(Effect.provide(DocumentRenderingServiceDocxLive)))
})
