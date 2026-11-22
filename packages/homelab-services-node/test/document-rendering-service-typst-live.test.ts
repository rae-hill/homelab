import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Config, Services } from "homelab-services"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { DocumentRenderingServiceTypstLive } from "../src/layers/document-rendering-service-typst.js"

/**
 * LIVE render tests — exercise the REAL DocumentRenderingServiceTypstLive (typst.ts
 * native compiler) against the committed assets: template, signature image, and the
 * vendored letterloom template imported BY PATH (gating idiom: CHROME_EXECUTABLE in the
 * e2e suites — here the gate is simply "do the committed assets exist").
 *
 * No XDG_DATA_HOME: letterloom resolves via a relative path import inside
 * templates/letter.typ, so behavior is identical in devshell/tests/nix-store and the
 * test process never pollutes the git-tracked assets dir with XDG data files.
 */
const assetsDir = process.env["TYPST_ASSETS_DIR"] ??
  path.resolve(import.meta.dirname, "..", "assets", "typst")

const describeLive = existsSync(path.join(assetsDir, "templates", "letter.typ"))
  ? describe
  : describe.skip

describeLive("document rendering service (typst) — LIVE render", () => {
  const LiveLayer = DocumentRenderingServiceTypstLive.pipe(
    Layer.provide(Layer.succeed(Config.Env.Env, { typstAssetsDir: Option.some(assetsDir) } as any)),
  )

  const render = (req: Services.DocumentRenderingServiceTypst.TypstRenderRequest) =>
    Effect.gen(function*() {
      const service = yield* Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst
      return yield* service.renderPdf(req)
    }).pipe(Effect.provide(LiveLayer))

  it.effect(
    "compiles the committed letter template with a shadow-mapped letter.json to a real PDF",
    () =>
      Effect.gen(function*() {
        const letterData = JSON.stringify({
          toName: "Live Render Test Co",
          subject: "Staff Test Engineer Position",
          paragraphs: [
            "Hello! This paragraph proves the committed letterloom template, the vendored universe package, and the signature image all resolve offline in this environment.",
            "Markup probes stay literal: #import \"x\" *not bold* $not-math$ @not-a-cite.",
          ],
        })
        const pdf = yield* render({
          mainFilePath: "templates/letter.typ",
          shadows: {
            "templates/letter.json": new TextEncoder().encode(letterData),
          },
        })
        expect(pdf.length).toBeGreaterThan(10_000)
        expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
      }),
    120_000,
  )

  it.effect(
    "surfaces real typst diagnostics for a broken template",
    () =>
      Effect.gen(function*() {
        const error = yield* Effect.flip(
          render({
            mainFilePath: "templates/definitely-missing.typ",
            shadows: {},
          }),
        )
        expect(error._tag).toBe("DocumentRenderingServiceTypstError")
        // The real compiler reports the missing entry file in its diagnostics summary.
        expect(error.message).toContain("typst compilation failed")
      }),
    60_000,
  )
})
