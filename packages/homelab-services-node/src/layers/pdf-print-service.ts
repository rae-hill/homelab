import { Effect, Layer } from "effect"
import { Config, type Schemas, Services } from "homelab-services"
import puppeteer from "puppeteer-core"

/**
 * Puppeteer-backed PDF renderer for the resume site.
 *
 * The chrome executable comes from `CHROME_EXECUTABLE` (the nix derivation points it at
 * the store path of `google-chrome`); the site URL from `RESUME_SITE_URL` (defaults to
 * the production GitHub Pages origin). A browser is launched per request and closed in a
 * `finally` — simple, isolated, and crash-proof at resume-printing volume.
 *
 * Launch args are chosen for the hardened homelab-api systemd unit: `--no-sandbox`
 * (NoNewPrivileges + RestrictNamespaces forbid chrome's sandboxes) and
 * `--disable-dev-shm-usage` (PrivateDevices means no /dev/shm).
 */
export const PdfPrintServiceLive = Layer.effect(
  Services.PdfPrintService.PdfPrintService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env

    return new PdfPrintServiceImpl(env)
  }),
)

class PdfPrintServiceImpl implements Services.PdfPrintService.PdfPrintServiceDef {
  constructor(private readonly env: typeof Config.Env.Env.Service) {}

  printResume(configBase64: string, theme: Schemas.Resume.PrintTheme) {
    return Effect.gen({ self: this }, function*() {
      const executablePath = yield* Effect.fromOption(
        this.env.chromeExecutable,
        () =>
          new Services.PdfPrintService.PdfPrintError({
            message: "CHROME_EXECUTABLE is not set; PDF printing is unavailable on this deployment",
            error: null,
          }),
      )

      const url = new URL(this.env.resumeSiteUrl)
      url.searchParams.set("importPrintSettings", configBase64)
      url.searchParams.set("theme", theme)

      return yield* Effect.tryPromise({
        try: async () => {
          const browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
            ],
          })
          try {
            const page = await browser.newPage()
            await page.goto(url.toString(), { waitUntil: "networkidle2", timeout: 60_000 })
            // The resume app sets `data-print-ready` on <html> once the imported config
            // and theme are applied to the redux store and the DOM has re-rendered.
            await page.waitForSelector("html[data-print-ready]", { timeout: 30_000 })
            const pdf = await page.pdf({
              printBackground: true,
              preferCSSPageSize: true,
            })
            return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf)
          } finally {
            await browser.close()
          }
        },
        catch: (error) =>
          new Services.PdfPrintService.PdfPrintError({
            message: `Headless chrome failed to render the resume PDF for ${url.origin}`,
            error,
          }),
      })
    })
  }
}
