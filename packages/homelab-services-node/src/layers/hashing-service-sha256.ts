import { Effect, Layer } from "effect"
import * as Digest from "effect/crypto/Digest"
import { Services, Utils } from "homelab-services"

/**
 * HashingServiceSha256 implementation using effect/crypto Digest service.
 *
 * Built on the native Effect API (effect/crypto Digest) which uses WebCrypto
 * (crypto.subtle) under the hood. Node 18+ provides globalThis.crypto.subtle,
 * so the layerWebCrypto provider works without additional dependencies.
 *
 * Self-contained: provides the Digest layer internally so consumers don't
 * need to know about it.
 */
export const makeHashingServiceSha256 = () =>
  Layer.effect(
    Services.HashingServiceSha256.HashingServiceSha256,
    Effect.gen(function*() {
      const digestService = yield* Digest.Digest

      return {
        digestHex: Effect.fn("HashingServiceSha256.digestHex")((input: string | Uint8Array) =>
          Effect.gen(function*() {
            // Convert string to Uint8Array via TextEncoder
            const bytes = typeof input === "string"
              ? new TextEncoder().encode(input)
              : input

            // Compute SHA-256 digest as lowercase hex
            return yield* digestService.digestHex(Digest.sha256, bytes).pipe(
              Effect.mapError((error) =>
                new Services.HashingServiceSha256.HashingServiceSha256Error({
                  message: "SHA-256 hashing failed",
                  error: Utils.errorToJson(error),
                })
              ),
            )
          })
        ),
      }
    }),
  ).pipe(
    // Self-contained: provide the Digest layer internally
    Layer.provide(Digest.layerWebCrypto),
  )

export const HashingServiceSha256Live = makeHashingServiceSha256()
