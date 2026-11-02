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

/** Production confetti config (from the old `NODE_ENV === 'production'` branch). */
const CONFETTI_CODE_PROD =
  "U2FsdGVkX1+vnmtj2m1JEhUewbPGpNTkx5w6ADUdrNKS9DCZQnQCUh0Q9gN+6+XyJx6wbD8ZrUcedDQuN53gpxaIVQ3PU1CN5tUYsK8+jB9bM3i50d7/sPUz/asn34kvhcFEqe/wqwSrIS4VvnyUdBa0dlRIFQ4l+76bAXv3rs/tQva+i0WqhCqA+TJs2FWpOJlcRxRrntKtUXknc6VGSKeb+omg+ODfX2xpneldW3DufIQOp8RDXsaOR2mP1hbfyA53keSSap/AR/pMJxPglpOK/DW/LQ34LSOHlaMkN6mjwmQ3CL4TimBaAQHaj13Mtz9S2DeqDcslHXFV+Rj5+GRqUV5JDs5c/x5Iy3wFLL3EWa0TTDs0DyTHZLgHa0qmXK6wSuoF1L0Jo9Hz8sg/hL5xd0qThzJHNJ4tdym1AtlsaHo4Qj9oZy6tm4Ej3Dw8QDZM8wutHWSYQFHAdsOUpon5C9hzIA6v6hmcq/FjHY6KHhjbRo3/pzCt/JfbkpXbDvCGU7aYdoMOW+HHEUBSWxQoGaiS2ARimMTMAVlhZ7r6zjO8cQJ+/PfMGDY5uyQYDjqFyz+/otFAg3QJD6MLnF8j7DsQUBdohEBwNowCLSOmcfTmG19P1ASNk2/2XLDqKBgF4jRthlTrycneQaZvVNQV4FQKmzOldKfFwmwVBWeZLSoJUPqluxJNo2RkJ+B7HsTxaqoxN2TYDssRSzkeX61zKemsUpc/RE/jJuKkXow="

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

  // Inject the confetti vendor script (both environments, with the per-env code).
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
