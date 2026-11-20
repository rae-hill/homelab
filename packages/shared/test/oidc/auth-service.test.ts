import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { ErrorResponse } from "oidc-client-ts"
import { afterEach, beforeEach, vi } from "vitest"

import { AuthService, type AuthServiceDef, layer } from "../../src/oidc/auth-service.js"

/**
 * Mocked oidc-client-ts surface: the tests drive the AuthService glue (refresh-aware
 * getUser, locked refresh with freshness re-check, definitive-failure cleanup, change
 * subscriptions) without a real IdP. `ErrorResponse` is re-implemented here so
 * `isDefinitiveRefreshFailure`'s instanceof check resolves against the mocked module.
 */
const mocks = vi.hoisted(() => {
  const unsubs = { loaded: vi.fn(), unloaded: vi.fn() }
  return {
    getUser: vi.fn(),
    signinSilent: vi.fn(),
    removeUser: vi.fn(),
    events: {
      addAccessTokenExpiring: vi.fn(() => vi.fn()),
      addAccessTokenExpired: vi.fn(() => vi.fn()),
      addUserLoaded: vi.fn(() => unsubs.loaded),
      addUserUnloaded: vi.fn(() => unsubs.unloaded),
    },
    unsubs,
  }
})

vi.mock("oidc-client-ts", () => {
  class ErrorResponse extends Error {
    readonly error: string | null
    constructor(args: { error?: string | null }) {
      super(args?.error ?? "")
      this.error = args?.error ?? null
    }
  }
  class WebStorageStateStore {
    constructor(_args?: unknown) {}
  }
  class UserManager {
    readonly events = mocks.events
    readonly getUser = mocks.getUser
    readonly signinSilent = mocks.signinSilent
    readonly removeUser = mocks.removeUser
  }
  return { ErrorResponse, UserManager, WebStorageStateStore }
})

const testConfig = {
  authority: "https://idm.test/oauth2/openid/homelab",
  clientId: "homelab",
  redirectUri: "https://app.test/oauth-callback",
  scope: "openid profile email",
}

/** A stored session that is comfortably fresh (15-minute kanidm access token). */
const freshUser = () => ({
  access_token: "at-new",
  id_token: "idt-new",
  refresh_token: "rt-new",
  expired: false,
  expires_in: 900,
  expires_at: Math.floor(Date.now() / 1000) + 900,
  profile: { email: "rae@test", name: "Rae", roles: ["Resume_Print"] },
})

/** A stored session whose access token has expired but carries a refresh token. */
const expiredUser = () => ({
  access_token: "at-old",
  id_token: "idt-old",
  refresh_token: "rt-old",
  expired: true,
  expires_in: -10,
  expires_at: Math.floor(Date.now() / 1000) - 10,
  profile: { email: "rae@test", name: "Rae", roles: ["Resume_Print"] },
})

/** Run an effect against a freshly built AuthService layer. */
function withAuth<A, E>(
  f: (auth: AuthServiceDef) => Effect.Effect<A, E, never>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function*() {
      const auth = yield* AuthService
      return yield* f(auth)
    }).pipe(Effect.provide(layer(testConfig))),
  )
}

// The tests share one hoisted `mocks` singleton and reprogram it per-case, so they must
// not overlap — the repo runs vitest with `sequence.concurrent: true` by default, and
// `{ concurrent: false }` (inherited by nested suites/tests) opts this file out.
describe("oidc/auth-service (mocked oidc-client-ts)", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.removeUser.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("getUser", () => {
    it("returns the stored session when it is fresh", async () => {
      mocks.getUser.mockResolvedValue(freshUser())

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isSome(user)).toBe(true)
      expect(user.value.idToken).toBe("idt-new")
      expect(user.value.roles).toEqual(["Resume_Print"])
      expect(Option.getOrNull(user.value.email)).toBe("rae@test")
      expect(mocks.signinSilent).not.toHaveBeenCalled()
    })

    it("silently renews an expired session via the refresh token", async () => {
      mocks.getUser.mockResolvedValue(expiredUser())
      mocks.signinSilent.mockResolvedValue(freshUser())

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isSome(user)).toBe(true)
      expect(user.value.idToken).toBe("idt-new")
      expect(user.value.accessToken).toBe("at-new")
      expect(mocks.signinSilent).toHaveBeenCalled()
    })

    it("clears the stored session when the refresh is definitively rejected", async () => {
      mocks.getUser.mockResolvedValue(expiredUser())
      mocks.signinSilent.mockRejectedValue(new ErrorResponse({ error: "invalid_grant" }))

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isNone(user)).toBe(true)
      expect(mocks.removeUser).toHaveBeenCalled()
    })

    it("keeps the stored session when the refresh fails transiently", async () => {
      mocks.getUser.mockResolvedValue(expiredUser())
      mocks.signinSilent.mockRejectedValue(new TypeError("Failed to fetch"))

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isNone(user)).toBe(true)
      expect(mocks.removeUser).not.toHaveBeenCalled()
    })

    it("falls back to a near-expiry stored session when the renew fails transiently", async () => {
      const nearExpiry = { ...freshUser(), id_token: "idt-soon", expires_in: 30 }
      mocks.getUser.mockResolvedValue(nearExpiry)
      mocks.signinSilent.mockRejectedValue(new TypeError("Failed to fetch"))

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isSome(user)).toBe(true)
      expect(user.value.idToken).toBe("idt-soon")
      expect(mocks.removeUser).not.toHaveBeenCalled()
    })

    it("yields None for an expired session without a refresh token", async () => {
      mocks.getUser.mockResolvedValue({ ...expiredUser(), refresh_token: undefined })

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isNone(user)).toBe(true)
      expect(mocks.signinSilent).not.toHaveBeenCalled()
    })

    it("yields None when nothing is stored", async () => {
      mocks.getUser.mockResolvedValue(null)

      const user = await withAuth((auth) => auth.getUser())

      expect(Option.isNone(user)).toBe(true)
      expect(mocks.signinSilent).not.toHaveBeenCalled()
    })
  })

  describe("refresh", () => {
    it("renews via signinSilent when the stored session needs it", async () => {
      mocks.getUser.mockResolvedValue(expiredUser())
      mocks.signinSilent.mockResolvedValue(freshUser())

      const user = await withAuth((auth) => auth.refresh())

      expect(user.idToken).toBe("idt-new")
      expect(mocks.signinSilent).toHaveBeenCalled()
    })

    it("returns the stored session without a grant when it is already fresh", async () => {
      // Simulates losing the lock race: another tab rotated the token while we waited,
      // so the in-lock freshness re-check must skip the (replay-poisoned) old token.
      mocks.getUser.mockResolvedValue(freshUser())

      const user = await withAuth((auth) => auth.refresh())

      expect(user.idToken).toBe("idt-new")
      expect(mocks.signinSilent).not.toHaveBeenCalled()
    })

    it("fails when nothing refreshable is stored", async () => {
      mocks.getUser.mockResolvedValue(null)

      const error = await withAuth((auth) => auth.refresh().pipe(Effect.flip))

      expect(error.reason).toBe("refresh")
      expect(error.message).toContain("No refreshable OIDC session")
      expect(mocks.signinSilent).not.toHaveBeenCalled()
    })
  })

  describe("onUserChanged", () => {
    it("notifies on storage events from other tabs and unsubscribes cleanly", async () => {
      const listeners = new Map<string, (event: unknown) => void>()
      const windowStub = {
        addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
          listeners.set(type, cb)
        }),
        removeEventListener: vi.fn((type: string) => {
          listeners.delete(type)
        }),
      }
      vi.stubGlobal("window", windowStub)
      mocks.getUser.mockResolvedValue(null)

      const seen: Array<Option.Option<{ idToken: string }>> = []
      const unsubscribe = await withAuth((auth) =>
        auth.onUserChanged((user) => {
          seen.push(user as Option.Option<{ idToken: string }>)
        })
      )

      // Another tab rotated the session: a storage event on an oidc.* key must surface
      // the newest stored user to this tab's subscriber.
      mocks.getUser.mockResolvedValue(freshUser())
      listeners.get("storage")?.({ key: "oidc.user:https://idm.test:homelab" })
      await vi.waitFor(() => expect(seen.length).toBe(1))
      expect(Option.isSome(seen[0]!)).toBe(true)
      expect(seen[0]!.value.idToken).toBe("idt-new")

      // Keys outside the oidc store prefix are ignored.
      listeners.get("storage")?.({ key: "unrelated" })
      await Promise.resolve()
      expect(seen.length).toBe(1)

      unsubscribe()
      expect(windowStub.removeEventListener).toHaveBeenCalledWith("storage", expect.any(Function))
      expect(mocks.unsubs.loaded).toHaveBeenCalled()
      expect(mocks.unsubs.unloaded).toHaveBeenCalled()
    })
  })

  describe("layer", () => {
    it("wires background renewal without oidc-client-ts's automaticSilentRenew", async () => {
      mocks.getUser.mockResolvedValue(null)

      await withAuth((auth) => Effect.sync(() => expect(auth).toBeDefined()))

      expect(mocks.events.addAccessTokenExpiring).toHaveBeenCalled()
      expect(mocks.events.addAccessTokenExpired).toHaveBeenCalled()
    })
  })
})
