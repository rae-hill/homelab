/**
 * The localStorage key under which the resume SPA persists its print config
 * (defined in `packages/resume` as `concat(constantPrefix, "__print-config")`,
 * re-exported there from this constant so both sides share one source).
 *
 * This is part of the remote-print wire contract: `PdfPrintService` seeds the
 * print config into the site's localStorage under this key (via
 * `page.evaluateOnNewDocument`) BEFORE navigating, instead of embedding it as
 * an `importPrintSettings` query param — real-world configs exceed GitHub
 * Pages' request-line limit (HTTP 414, observed on augustus). The SPA's
 * `PrintConfigProvider` hydrates from this key on boot, so a bare URL plus a
 * seeded localStorage is equivalent to the param flow.
 */
export const PRINT_CONFIG_LOCAL_STORAGE_KEY = "https://resume.rae-hill.dev__print-config"
