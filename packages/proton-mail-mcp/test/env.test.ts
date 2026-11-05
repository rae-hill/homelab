import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Result } from "effect"
import { buildEnv, type RawEnv } from "../src/env.js"

const validRaw: RawEnv = {
  bridgeHost: "127.0.0.1",
  bridgePort: 1143,
  bridgeUsername: "me@proton.me",
  bridgePassword: "bridge-pw",
  bridgeTlsMode: "starttls",
  bridgeTlsCaFile: Option.none(),
  operationsRaw: "read",
  allowedLabelsRaw: "",
  maxBodyBytes: 20_000,
  maxListMessages: 25,
}

const expectFailure = (raw: RawEnv, messagePart: string) =>
  Effect.gen(function*() {
    const result = yield* buildEnv(raw).pipe(Effect.result)
    assert.isTrue(Result.isFailure(result))
    if (Result.isFailure(result)) {
      assert.include(result.failure.message, messagePart)
    }
  })

describe("buildEnv", () => {
  it.effect("defaults to read-only with empty label whitelist", () =>
    Effect.gen(function*() {
      const env = yield* buildEnv(validRaw)
      assert.isTrue(env.operations.has("read"))
      assert.isFalse(env.operations.has("label"))
      assert.deepStrictEqual(env.allowedLabels, [])
      assert.strictEqual(env.bridgePort, 1143)
    }))

  it.effect("rejects the \"label\" operation without a whitelist", () =>
    expectFailure({ ...validRaw, operationsRaw: "read,label" }, "PROTON_MCP_ALLOWED_LABELS"))

  it.effect("accepts label operation with a trimmed whitelist", () =>
    Effect.gen(function*() {
      const env = yield* buildEnv({
        ...validRaw,
        operationsRaw: "read, label ",
        allowedLabelsRaw: " Receipts , Important ",
      })
      assert.isTrue(env.operations.has("label"))
      assert.deepStrictEqual(env.allowedLabels, ["Receipts", "Important"])
    }))

  it.effect("rejects unknown operation tokens", () =>
    expectFailure({ ...validRaw, operationsRaw: "read,send" }, "unknown operation \"send\""))

  it.effect("rejects label names containing path separators", () =>
    expectFailure(
      { ...validRaw, operationsRaw: "read,label", allowedLabelsRaw: "Receipts,../INBOX" },
      "invalid characters",
    ))

  it.effect("rejects non-loopback hosts without a CA file", () =>
    expectFailure({ ...validRaw, bridgeHost: "10.0.0.5" }, "PROTON_BRIDGE_TLS_CA_FILE"))

  it.effect("accepts non-loopback hosts with a CA file", () =>
    Effect.gen(function*() {
      const env = yield* buildEnv({
        ...validRaw,
        bridgeHost: "10.0.0.5",
        bridgeTlsCaFile: Option.some("/etc/bridge.pem"),
      })
      assert.strictEqual(env.bridgeHost, "10.0.0.5")
    }))

  it.effect("rejects invalid TLS modes", () =>
    expectFailure({ ...validRaw, bridgeTlsMode: "plaintext" }, "PROTON_BRIDGE_TLS_MODE"))

  it.effect("rejects out-of-range ports and limits", () =>
    Effect.gen(function*() {
      yield* expectFailure({ ...validRaw, bridgePort: 0 }, "PROTON_BRIDGE_IMAP_PORT")
      yield* expectFailure({ ...validRaw, maxListMessages: 101 }, "PROTON_MCP_MAX_LIST_MESSAGES")
      yield* expectFailure({ ...validRaw, maxBodyBytes: 0 }, "PROTON_MCP_MAX_BODY_BYTES")
    }))

  it.effect("rejects empty credentials", () => expectFailure({ ...validRaw, bridgePassword: "" }, "non-empty"))
})
