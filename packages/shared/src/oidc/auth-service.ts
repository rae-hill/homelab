import { Context, Data, Effect, Layer, Option } from "effect"
import { type User, UserManager, type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts"

import { type OidcClientConfig } from "./config.js"
import {
  isDefinitiveRefreshFailure,
  refreshLockName,
  SESSION_STORAGE_KEY_PREFIX,
  shouldRefresh,
  withRefreshLock,
} from "./refresh.js"

export const AuthServiceId = "shared/oidc/AuthService"

/** Any failure of the underlying oidc-client-ts operations, tagged by phase. */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: "config" | "login" | "callback" | "user" | "refresh" | "signout"
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

  /**
   * A usable stored session, or `None` when signed out or storage is unreadable.
   *
   * Expired (or near-expiry) sessions carrying a refresh token are silently renewed
   * first — kanidm rotates refresh tokens on every use, so the renew runs under a
   * same-origin Web Lock with a freshness re-check to keep concurrent tabs from
   * replaying a stale token (which would destroy the session server-side). A
   * definitive renew failure (`invalid_grant`) clears the dead session and yields
   * `None`; transient failures keep the session for a later retry.
   */
  readonly getUser: () => Effect.Effect<Option.Option<OidcUser>, AuthError>

  /**
   * Force a refresh-token grant (tab-serialized, freshness re-checked) and return the
   * renewed session. Fails with `reason: "refresh"` when nothing refreshable is stored
   * or the grant is rejected; a definitive rejection also clears the stored session.
   */
  readonly refresh: () => Effect.Effect<OidcUser, AuthError>

  /**
   * Subscribe to session changes: renewals (including background auto-renew and
   * refreshes performed by *other* tabs, via same-origin `storage` events), sign-ins,
   * and sign-outs/clears. Returns an unsubscribe function.
   */
  readonly onUserChanged: (
    callback: (user: Option.Option<OidcUser>) => void,
  ) => Effect.Effect<() => void>

  /** Clear the local session (web storage). Does NOT redirect to the IdP. */
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
 * Build the {@link AuthService} layer for a config. Touches `window`/web storage at
 * layer construction — only build it in the browser.
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
          // Renewal is self-managed below: the built-in automaticSilentRenew calls
          // signinSilent() directly, without the cross-tab lock + freshness re-check
          // that kanidm's refresh-token rotation requires.
          automaticSilentRenew: false,
          loadUserInfo: false,
          userStore: new WebStorageStateStore({
            store: config.storage === "session" ? globalThis.sessionStorage : globalThis.localStorage,
          }),
          ...(config.postLogoutRedirectUri !== undefined ?
            { post_logout_redirect_uri: config.postLogoutRedirectUri }
            : {}),
        }
        const service = new AuthServiceImpl(new UserManager(settings), refreshLockName(config.clientId))
        service.startAutomaticRenew()
        return service
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
  constructor(
    private readonly userManager: UserManager,
    private readonly lockName: string,
  ) {}

  /**
   * Background renewal for long-lived tabs: fires shortly before the access token
   * expires (oidc-client-ts's expiring/expired events, 60s margin) — e.g. a dashboard
   * left open, or a timer elapsing after the laptop wakes from sleep. The expiry timers
   * arm whenever a session is loaded (the app bootstrap's `getUser()` — which itself
   * renews an already-expired session — and every refresh), and every renew goes through
   * the tab-serialized lock with a freshness re-check, so simultaneous expirations across
   * tabs collapse into a single refresh grant.
   */
  startAutomaticRenew(): void {
    const renew = (): void => {
      void Effect.runPromise(Effect.ignore(this.refresh())).catch(() => {})
    }
    this.userManager.events.addAccessTokenExpiring(renew)
    this.userManager.events.addAccessTokenExpired(renew)
  }

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
      Effect.flatMap((user) => {
        if (user === null) {
          return Effect.succeed(Option.none())
        }
        if (!shouldRefresh(user)) {
          // Fresh session — or expired without a refresh token, which only an
          // interactive login can fix.
          return Effect.succeed(user.expired === true ? Option.none() : Option.some(toOidcUser(user)))
        }
        return this.refresh().pipe(
          Effect.map(Option.some),
          // A failed renew is not a storage error. If the stored token is merely
          // near-expiry, it is still briefly usable — hand it over; a truly expired
          // session reports "signed out" so callers show the login affordance instead
          // of an error toast.
          Effect.catch(() =>
            Effect.succeed(
              user.expired === true ? Option.none() : Option.some(toOidcUser(user)),
            )
          ),
        )
      }),
    )
  }

  refresh() {
    return Effect.tryPromise({
      try: () =>
        withRefreshLock(this.lockName, async () => {
          const user = await this.userManager.getUser()
          if (shouldRefresh(user)) {
            return await this.userManager.signinSilent()
          }
          // Re-check *inside* the lock: another tab may have rotated the token while we
          // waited — replaying the stale one would destroy the kanidm session.
          if (user !== null && user.expired !== true) {
            return user
          }
          return null
        }),
      catch: (error) =>
        new AuthError({
          reason: "refresh",
          message: "Failed to refresh the OIDC session",
          error,
        }),
    }).pipe(
      Effect.flatMap((user) =>
        user === null ?
          Effect.fail(
            new AuthError({
              reason: "refresh",
              message: "No refreshable OIDC session is stored",
              error: null,
            }),
          )
          : Effect.succeed(toOidcUser(user))
      ),
      // A definitive grant failure (expired/revoked/replayed refresh token) means the
      // stored session is dead — clear it so the UI prompts for interactive login.
      // Transient failures (offline) keep the session for a later retry.
      Effect.catch((error) =>
        isDefinitiveRefreshFailure(error.error) ?
          Effect.tryPromise(() => this.userManager.removeUser()).pipe(
            Effect.ignore,
            Effect.flatMap(() => Effect.fail(error)),
          )
          : Effect.fail(error)
      ),
    )
  }

  onUserChanged(callback: (user: Option.Option<OidcUser>) => void) {
    return Effect.sync(() => {
      const offLoaded = this.userManager.events.addUserLoaded((user) => {
        callback(Option.some(toOidcUser(user)))
      })
      const offUnloaded = this.userManager.events.addUserUnloaded(() => {
        callback(Option.none())
      })
      // Same-origin storage events cover the *other* tabs: kanidm rotates the refresh
      // token on every use, so each tab must converge on the newest stored user instead
      // of holding a stale — replay-poisoned — copy. A null key (storage.clear()) also
      // triggers a reload.
      const onStorage = (event: StorageEvent): void => {
        if (event.key !== null && !event.key.startsWith(SESSION_STORAGE_KEY_PREFIX)) {
          return
        }
        void Effect.runPromise(
          Effect.tryPromise(() => this.userManager.getUser()).pipe(
            Effect.orElseSucceed(() => null),
            Effect.map((user) => user === null ? Option.none() : Option.some(toOidcUser(user))),
            Effect.tap((user) => Effect.sync(() => callback(user))),
          ),
        ).catch(() => {})
      }
      globalThis.window.addEventListener("storage", onStorage)
      return () => {
        offLoaded()
        offUnloaded()
        globalThis.window.removeEventListener("storage", onStorage)
      }
    })
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
