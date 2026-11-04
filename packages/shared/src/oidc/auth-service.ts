import { Context, Data, Effect, Layer, Option } from "effect"
import { type User, UserManager, type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts"

import { type OidcClientConfig } from "./config.js"

export const AuthServiceId = "shared/oidc/AuthService"

/** Any failure of the underlying oidc-client-ts operations, tagged by phase. */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: "config" | "login" | "callback" | "user" | "signout"
  readonly message: string
  readonly error: unknown
}> {}

/**
 * A decoded, framework-agnostic view of an authenticated OIDC session.
 *
 * The homelab-server `AuthMiddleware` verifies kanidm-issued tokens with
 * `aud: "homelab"` + required `email`/`roles` claims and skips DPoP for remote issuers —
 * those claims live on the **id_token**, so that is what callers should send as the
 * Bearer credential (matching homelab-frontend's behavior).
 */
export interface OidcUser {
  /** The kanidm id_token — the Bearer credential for homelab-server requests. */
  readonly idToken: string
  readonly accessToken: string
  readonly email: Option.Option<string>
  readonly name: Option.Option<string>
  /** `roles` claim values from the kanidm claim-map (e.g. `"Resume_Print"`). */
  readonly roles: ReadonlyArray<string>
  /** Unix seconds at which the session expires, when the IdP provided one. */
  readonly expiresAt: Option.Option<number>
}

export interface AuthServiceDef {
  /**
   * Begin the PKCE authorization-code redirect flow. Navigates the page away; the
   * returned effect completes only if the redirect itself fails. `state` round-trips
   * through the IdP and is available on the callback user.
   */
  readonly login: (state?: unknown) => Effect.Effect<void, AuthError>

  /**
   * Complete the redirect flow on the callback route (validates state + PKCE verifier,
   * exchanges the code, stores the session). Fails when the URL is not a valid
   * OIDC callback or the exchange fails.
   */
  readonly handleRedirectCallback: () => Effect.Effect<OidcUser, AuthError>

  /** The stored session, or `None` when signed out / expired / storage unreadable. */
  readonly getUser: () => Effect.Effect<Option.Option<OidcUser>, AuthError>

  /** Clear the local session (session storage). Does NOT redirect to the IdP. */
  readonly signout: () => Effect.Effect<void, AuthError>
}

export class AuthService extends Context.Service<AuthService, AuthServiceDef>()(AuthServiceId) {
}

/** Map an oidc-client-ts `User` onto the framework-agnostic {@link OidcUser}. */
function toOidcUser(user: User): OidcUser {
  const profile = user.profile as Record<string, unknown>
  const email = profile["email"]
  const name = profile["name"]
  const roles = profile["roles"]
  return {
    idToken: user.id_token ?? "",
    accessToken: user.access_token,
    email: typeof email === "string" ? Option.some(email) : Option.none(),
    name: typeof name === "string" ? Option.some(name) : Option.none(),
    roles: Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [],
    expiresAt: Option.fromNullishOr(user.expires_at),
  }
}

/**
 * Build the {@link AuthService} layer for a config. Touches `window`/`sessionStorage`
 * at layer construction — only build it in the browser.
 */
export const layer = (config: OidcClientConfig): Layer.Layer<AuthService, AuthError> =>
  Layer.effect(
    AuthService,
    Effect.try({
      try: () => {
        const settings: UserManagerSettings = {
          authority: config.authority,
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          scope: config.scope,
          response_type: "code",
          automaticSilentRenew: false,
          loadUserInfo: false,
          userStore: new WebStorageStateStore({ store: globalThis.sessionStorage }),
          ...(config.postLogoutRedirectUri !== undefined ?
            { post_logout_redirect_uri: config.postLogoutRedirectUri }
            : {}),
        }
        return new AuthServiceImpl(new UserManager(settings))
      },
      catch: (error) =>
        new AuthError({
          reason: "config",
          message: "Failed to construct the OIDC UserManager",
          error,
        }),
    }),
  )

class AuthServiceImpl implements AuthServiceDef {
  constructor(private readonly userManager: UserManager) {}

  login(state?: unknown) {
    return Effect.tryPromise({
      try: () =>
        this.userManager.signinRedirect(
          state === undefined ? undefined : { state },
        ),
      catch: (error) =>
        new AuthError({
          reason: "login",
          message: "Failed to start the OIDC login redirect",
          error,
        }),
    })
  }

  handleRedirectCallback() {
    return Effect.tryPromise({
      try: () => this.userManager.signinCallback(),
      catch: (error) =>
        new AuthError({
          reason: "callback",
          message: "Failed to complete the OIDC redirect callback",
          error,
        }),
    }).pipe(
      Effect.flatMap((user) =>
        user === undefined ?
          Effect.fail(
            new AuthError({
              reason: "callback",
              message: "The current URL is not an OIDC callback response",
              error: null,
            }),
          )
          : Effect.succeed(toOidcUser(user))
      ),
    )
  }

  getUser() {
    return Effect.tryPromise({
      try: () => this.userManager.getUser(),
      catch: (error) =>
        new AuthError({
          reason: "user",
          message: "Failed to read the stored OIDC session",
          error,
        }),
    }).pipe(
      Effect.map((user) => user === null || user.expired === true ? Option.none() : Option.some(toOidcUser(user))),
    )
  }

  signout() {
    return Effect.tryPromise({
      try: () => this.userManager.removeUser(),
      catch: (error) =>
        new AuthError({
          reason: "signout",
          message: "Failed to clear the stored OIDC session",
          error,
        }),
    })
  }
}
