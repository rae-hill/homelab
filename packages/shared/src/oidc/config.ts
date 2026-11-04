import { Schema } from "effect"

/** The default OIDC scope set used by the homelab kanidm client. */
export const DEFAULT_OIDC_SCOPE = "openid profile email"

/**
 * Configuration for a browser OIDC (PKCE) client talking to kanidm. All values are
 * public — they get baked into the SPA bundle at build time.
 */
export const OidcClientConfig = Schema.Struct({
  /**
   * The IdP's client-scoped discovery base URL, e.g.
   * `https://idm.plato-splunk.media/oauth2/openid/homelab` (kanidm serves
   * `/.well-known/openid-configuration` beneath it).
   */
  authority: Schema.String,
  /** The kanidm OAuth2 client id (e.g. `"homelab"`). */
  clientId: Schema.String,
  /** Absolute redirect URI registered with kanidm (e.g. the SPA's `/oauth/callback`). */
  redirectUri: Schema.String,
  /** Space-separated scopes (defaults to {@link DEFAULT_OIDC_SCOPE} at the call site). */
  scope: Schema.String,
  /** Optional post-logout landing URI (must also be registered with the IdP). */
  postLogoutRedirectUri: Schema.String.pipe(Schema.optionalKey),
})

export type OidcClientConfig = typeof OidcClientConfig.Type
