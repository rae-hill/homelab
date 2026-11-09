/**
 * Environment side effects that the Docusaurus config used to inject via `scripts` /
 * `headTags`. Imported once from the entry point.
 *
 * The confetti vendor script is injected in BOTH dev and production (matching the old
 * config, which had a dev branch and a prod branch) — each environment uses its own
 * `data-confetticode` (the encoded config that also carries the unlock secret). Only the
 * no-console-logs behavior is production-only.
 */

const CONFETTI_SRC = "https://run.confettipage.com/here.js"

/**
 * Hostnames where the confetti vendor is allowed to run. The `data-confetticode`
 * configs below are domain-bound (issued for the public site / local dev); on
 * any other origin (e.g. the tailnet print mirror resume.plato-splunk.media)
 * the vendor errors and shows "wrong domain" popups — so don't inject there.
 * The server-side print flow additionally DNS-blocks the vendor host.
 */
const CONFETTI_ALLOWED_HOSTNAMES = new Set(["resume.rae-hill.dev", "localhost", "127.0.0.1"])

/** Production confetti config (from the old `NODE_ENV === 'production'` branch). */
const CONFETTI_CODE_PROD =
  "U2FsdGVkX19e1ZCylxErKWAmZ2rtoOHJVXfhwqvCZodwh3rhFg+h9KoZwpe5aUqdDZiJ9rSUStVBObqr2fzYC0Gb9fBAMFdM/CleSL7EvRIiBkMcxAdOPR4TA/c1P2RNRGIh0BxpC/zE8AbOhK8SJGMIQ5P6twz+3i3gqcipQ09mrhes6w36tcAJDFC7h16pwWv5eiUbl/aGielAqRxTb/7GstQk3BYNgEbDCeFRjJdRPP2zy6GKGesOnouywtXKfHhHsTwwzsK80O4tvrQax9KBlobIQvwRWGjemS3qwi/wKv3cz/mhmWmj1bip/ftNTDgNZDgHrGnnPG25I0ECh+9NNWrYNnKsGL3YHFDWE5x1Aiz9rSAlpdTnSJ0E/QxEBW6WJhaYNG4bxfAJbFOmKH8bw8FovAeWob3wcNFIERZgM0q7KEW43lT3ghg5asRcIzUNJXMfwSq1u4k6Qr5DUSIrNavuhBVq1Dbrfm3TGp5g7Itv82g2JYhMxVx6Ej1Crxf8lQbIcDyzHI1PSs/x/VtiMb7qD0mtMYy0DpIK7T8P+7unERQPqFGyQX9w0mTgB3J0Fj2OPogyqygN7Nh03eSSEUV7SSVi75Q5WHAdHEi3ts4+a93Fl9Z+zBnIDbpbAiVne8GBQ6T3Dih1iyCvgVQr4EyrcWtrSS0xTxTDvpmBUqU9nGF/ssdx8nM2kZ9QO+X+X2rHj+BobI7cTulohIOpGcN6jpawjda/zQPsIEFpo6ZxujJsgB6WJwRUzkl7"

/** Development confetti config (from the old dev branch; carries the unlock secret). */
const CONFETTI_CODE_DEV =
  "U2FsdGVkX19xWnt/747Sah+L5btTbcuKPXcDmnfL0axm+7RTEjQ0DbW2xRW7TUSU/AbNX3gp43rEKXK8aZPogfhmqbkkB9arA6ESoO4lJt0qhvxxBXc2R1Ulyap4VpxBQ8LyHVSNW3xj/BMFuRPDy1prGEg1eVOnBMZX0yB13Gzqd1Il28I3R4NyeZQiPEoOxtYbiIXlUTKW09eA0Vp3wu71MAQrC5KpvmQPbKpOTbfdSRSrHAV9fj03XqUPF80uA1BLCwrFNNyARWnW5nw0WEwVyGAVegXU/fXPPbzJKaej+V6PGk4QoEw92vKpiAoD4E41zfdfjAh2looHJ8N+5hjBr2diTM7SfV6N3aXQqS4CxNbvB0xoy+I5dS8u5QKYr3IAub8BKcWEoTpxyEAqFZ4gt1GsL7mNBEOztcg6wj2K2uefEOe88VFw6ARe+dubIO+2qnAgPi5PvPv2aizWTyB7VHH+iB7S2fQf+EQxQsNFwnl6bVz2VU2a3n5bvWI5OSm3KQAggKBhU6kn1XGb24erWR+8x/cQfwmxlIu4MxijB8YcXFzLIaLWelZi4F5YHZ7yCZXea60W/bGkSHmi117UdoTWOSdsnYuoa6Y6qrQLxUEA6Np7sGM3Kf4VaIjK6j1+rfnfF0NMYvs+KdH2NRHCBG1Jzk4Pv/XshEYyPzy4yQHvep09hF6an0seWkMK"

export function setupEnvironmentSideEffects(): void {
  if (typeof document === "undefined") {
    return
  }

  // No console logs in production.
  if (import.meta.env.PROD) {
    globalThis.console.log = function noLogsInProductionPlease() {}
  }

  // Inject the confetti vendor script (both environments, with the per-env code) —
  // only on domains its code is issued for (see CONFETTI_ALLOWED_HOSTNAMES).
  if (!CONFETTI_ALLOWED_HOSTNAMES.has(window.location.hostname)) {
    return
  }

  const script = document.createElement("script")
  script.src = CONFETTI_SRC
  script.async = true
  script.setAttribute("fetchpriority", "low")
  script.setAttribute(
    "data-confetticode",
    import.meta.env.PROD ? CONFETTI_CODE_PROD : CONFETTI_CODE_DEV,
  )
  document.body.appendChild(script)
}
