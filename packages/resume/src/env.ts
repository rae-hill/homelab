/**
 * Build/runtime environment values that were previously injected by the Docusaurus config
 * as global `<script>` variables. Now sourced from Vite env (`import.meta.env`).
 *
 * - `VITE_COMMIT_HASH` is set in CI (`${{ github.sha }}`); empty in local dev.
 * - `todaysDate` is simply the current date at load (matches the old behavior of a value
 *   stamped at build/serve time).
 */

const commitHash = import.meta.env.VITE_COMMIT_HASH ?? ""

/** Short ` (rev: abc1234)` suffix for the print footer, or empty when no hash is set. */
export const printFooterRevision = commitHash !== "" ? ` (rev: ${commitHash.substring(0, 7)})` : ""

/** Localized date string shown in the print footer / resume metadata. */
export const todaysDate = new Date().toLocaleDateString()

/* ---- Homelab integration -------------------------------------------------------------- */

const homelabApiUrl = (import.meta.env.VITE_HOMELAB_API_URL ?? "") as string
const oidcAuthority = (import.meta.env.VITE_OIDC_AUTHORITY ?? "") as string
const oidcClientId = (import.meta.env.VITE_OIDC_CLIENT_ID ?? "homelab") as string

/**
 * Build-time homelab config (all values public — they ship in the bundle). When the
 * build didn't bake these in, `enabled` is false and the whole homelab integration
 * (reachability probe, login, remote printing) stays dark.
 */
export const homelabEnv = {
  /** Base URL of the tailscale-only homelab API (e.g. https://homelab-api.plato-splunk.media). */
  apiUrl: homelabApiUrl,
  /** Kanidm client-scoped OIDC discovery base (…/oauth2/openid/homelab). */
  oidcAuthority,
  oidcClientId,
  enabled: homelabApiUrl !== "" && oidcAuthority !== "",
} as const

/**
 * Mirror these onto globals so modules that read them loosely (e.g. the Chakra theme's
 * `getTodaysDate` / `getPrintFooterRevision`, which look at `window`/`globalThis`) keep
 * working without importing this module directly.
 */
if (typeof globalThis !== "undefined") {
  ;(globalThis as Record<string, unknown>).todaysDate = todaysDate
  ;(globalThis as Record<string, unknown>).printFooterRevision = printFooterRevision
}
