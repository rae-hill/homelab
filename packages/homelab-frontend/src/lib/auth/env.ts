import { Config } from "effect"

export const OIDC_CLIENT_ID = Config.String("PUBLIC_OIDC_CLIENT_ID")
export const OIDC_WELL_KNOWN_URL = Config.String("PUBLIC_OIDC_WELL_KNOWN_URL")
export const OIDC_REDIRECT_PATH = "/oauth/callback"

export const oidcEnabled: boolean = typeof import.meta.env.PUBLIC_OIDC_CLIENT_ID === "string"
  && import.meta.env.PUBLIC_OIDC_CLIENT_ID.length > 0
  && typeof import.meta.env.PUBLIC_OIDC_WELL_KNOWN_URL === "string"
  && import.meta.env.PUBLIC_OIDC_WELL_KNOWN_URL.length > 0
