import { Config, ConfigProvider } from "effect"

export const AstroConfigProvider = ConfigProvider.fromUnknown({
  PUBLIC_API_BASE_URL: import.meta.env.PUBLIC_API_BASE_URL ?? "",
  ...(import.meta.env.PUBLIC_OIDC_WELL_KNOWN_URL != null &&
    { PUBLIC_OIDC_WELL_KNOWN_URL: import.meta.env.PUBLIC_OIDC_WELL_KNOWN_URL }),
  ...(import.meta.env.PUBLIC_OIDC_CLIENT_ID != null &&
    { PUBLIC_OIDC_CLIENT_ID: import.meta.env.PUBLIC_OIDC_CLIENT_ID }),
  ...(import.meta.env.PUBLIC_UPGRADE_STATUS_URL != null &&
    { PUBLIC_UPGRADE_STATUS_URL: import.meta.env.PUBLIC_UPGRADE_STATUS_URL }),
  ...(import.meta.env.PUBLIC_UPGRADE_TARGET_ORIGIN != null &&
    { PUBLIC_UPGRADE_TARGET_ORIGIN: import.meta.env.PUBLIC_UPGRADE_TARGET_ORIGIN }),
})

export const API_BASE_URL = Config.String("PUBLIC_API_BASE_URL")
export const OIDC_WELL_KNOWN_URL = Config.String("PUBLIC_OIDC_WELL_KNOWN_URL")
export const OIDC_CLIENT_ID = Config.String("PUBLIC_OIDC_CLIENT_ID")
export const UPGRADE_STATUS_URL = Config.String("PUBLIC_UPGRADE_STATUS_URL")
export const UPGRADE_TARGET_ORIGIN = Config.String("PUBLIC_UPGRADE_TARGET_ORIGIN")

/** Base path without trailing slash (e.g. "" or "/ui") */
const raw = import.meta.env.BASE_URL ?? "/"
export const BASE_PATH = raw.endsWith("/") ? raw.slice(0, -1) : raw

/** Build an app-relative path accounting for base path */
export const appPath = (path: string) => `${BASE_PATH}${path}`

/** Check if a pathname matches an app route (handles trailing slashes) */
export const isAppPath = (pathname: string, route: string) => {
  const strip = (s: string) => s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s
  return strip(pathname) === strip(`${BASE_PATH}${route}`)
}
