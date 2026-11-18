import { describe, expect, it } from "@effect/vitest"
import { ErrorResponse } from "oidc-client-ts"
import { afterEach, vi } from "vitest"

import {
  isDefinitiveRefreshFailure,
  REFRESH_MARGIN_SECONDS,
  refreshLockName,
  shouldRefresh,
  withRefreshLock,
} from "../../src/oidc/refresh.js"

describe("shouldRefresh", () => {
  it("is false when nothing is stored", () => {
    expect(shouldRefresh(null)).toBe(false)
    expect(shouldRefresh(undefined)).toBe(false)
  })

  it("is false without a refresh token, even when expired", () => {
    expect(shouldRefresh({ expired: true, expires_in: -10 })).toBe(false)
    expect(shouldRefresh({ expired: true, refresh_token: "" })).toBe(false)
  })

  it("is true when the access token is expired and a refresh token exists", () => {
    expect(shouldRefresh({ expired: true, refresh_token: "rt" })).toBe(true)
  })

  it("is true when the access token expires within the margin", () => {
    expect(shouldRefresh({ expires_in: REFRESH_MARGIN_SECONDS, refresh_token: "rt" })).toBe(true)
    expect(shouldRefresh({ expires_in: 1, refresh_token: "rt" })).toBe(true)
  })

  it("is false while the access token is comfortably fresh", () => {
    expect(shouldRefresh({ expires_in: REFRESH_MARGIN_SECONDS + 1, refresh_token: "rt" })).toBe(false)
    expect(shouldRefresh({ expired: false, expires_in: 900, refresh_token: "rt" })).toBe(false)
  })

  it("is false when no expiry information is available", () => {
    expect(shouldRefresh({ refresh_token: "rt" })).toBe(false)
  })
})

describe("refreshLockName", () => {
  it("is namespaced per client id", () => {
    expect(refreshLockName("homelab")).toBe("shared/oidc/refresh:homelab")
    expect(refreshLockName("a")).not.toBe(refreshLockName("b"))
  })
})

// Stubs `navigator` per-test — must not overlap with itself under the repo-wide
// `sequence.concurrent: true` default.
describe("withRefreshLock", { concurrent: false }, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls through directly when the Web Locks API is unavailable", async () => {
    vi.stubGlobal("navigator", {})
    const result = await withRefreshLock("k", async () => "ran")
    expect(result).toBe("ran")
  })

  it("serializes concurrent refreshes under a same-name lock", async () => {
    // A minimal FIFO stand-in for navigator.locks: each request chains onto the
    // previous one's settlement.
    let tail: Promise<unknown> = Promise.resolve()
    const locks = {
      request(_name: string, callback: (lock: unknown) => unknown): Promise<unknown> {
        const result = tail.then(() => callback(null))
        tail = result.then(() => undefined, () => undefined)
        return result
      },
    }
    vi.stubGlobal("navigator", { locks })

    const order: Array<string> = []
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const slow = withRefreshLock("k", async () => {
      order.push("slow:start")
      await sleep(10)
      order.push("slow:end")
      return "slow"
    })
    const fast = withRefreshLock("k", async () => {
      order.push("fast")
      return "fast"
    })

    const results = await Promise.all([slow, fast])
    expect(results).toEqual(["slow", "fast"])
    // "fast" only runs after "slow" fully released the lock — never interleaved.
    expect(order).toEqual(["slow:start", "slow:end", "fast"])
  })

  it("propagates failures from the locked function", async () => {
    let tail: Promise<unknown> = Promise.resolve()
    const locks = {
      request(_name: string, callback: (lock: unknown) => unknown): Promise<unknown> {
        const result = tail.then(() => callback(null))
        tail = result.then(() => undefined, () => undefined)
        return result
      },
    }
    vi.stubGlobal("navigator", { locks })

    await expect(withRefreshLock("k", async () => {
      throw new Error("boom")
    })).rejects.toThrow("boom")

    // The lock is released after a failure — a subsequent call still runs.
    await expect(withRefreshLock("k", async () => "after")).resolves.toBe("after")
  })
})

describe("isDefinitiveRefreshFailure", () => {
  it("is true for an invalid_grant error response (dead refresh token)", () => {
    expect(isDefinitiveRefreshFailure(new ErrorResponse({ error: "invalid_grant" }))).toBe(true)
  })

  it("is false for other error responses", () => {
    expect(isDefinitiveRefreshFailure(new ErrorResponse({ error: "server_error" }))).toBe(false)
  })

  it("is false for non-OIDC errors (network failures, timeouts, ...)", () => {
    expect(isDefinitiveRefreshFailure(new TypeError("Failed to fetch"))).toBe(false)
    expect(isDefinitiveRefreshFailure(null)).toBe(false)
    expect(isDefinitiveRefreshFailure("invalid_grant")).toBe(false)
  })
})
