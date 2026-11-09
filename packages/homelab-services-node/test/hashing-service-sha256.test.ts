import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Services } from "homelab-services"
import { createHash } from "node:crypto"
import { HashingServiceSha256Live } from "../src/layers/hashing-service-sha256.js"

describe("HashingServiceSha256", () => {
  const runTest = <E, A>(
    effect: Effect.Effect<A, E, Services.HashingServiceSha256.HashingServiceSha256>,
  ) => effect.pipe(Effect.provide(HashingServiceSha256Live))

  it.effect("computes SHA-256 of known vector", () =>
    runTest(Effect.gen(function*() {
      const service = yield* Services.HashingServiceSha256.HashingServiceSha256
      const hash = yield* service.digestHex("abc")
      expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    })))

  it.effect("string input equals Uint8Array input for same bytes", () =>
    runTest(Effect.gen(function*() {
      const service = yield* Services.HashingServiceSha256.HashingServiceSha256
      const testString = "hello world"
      const hashFromString = yield* service.digestHex(testString)
      const hashFromBytes = yield* service.digestHex(new TextEncoder().encode(testString))
      expect(hashFromString).toBe(hashFromBytes)
    })))

  it.effect("matches node:crypto createHash reference", () =>
    runTest(Effect.gen(function*() {
      const service = yield* Services.HashingServiceSha256.HashingServiceSha256
      const testInput = "test input for hashing"

      // Compute via our service
      const hashFromService = yield* service.digestHex(testInput)

      // Compute via node:crypto
      const hashFromNodeCrypto = createHash("sha256").update(testInput).digest("hex")

      expect(hashFromService).toBe(hashFromNodeCrypto)
    })))
})
