import { Context, Data, Effect } from "effect"

export const HashingServiceSha256Id = "homelab-api/services/hashing/HashingServiceSha256"

/** Raised when SHA-256 hashing fails. */
export class HashingServiceSha256Error extends Data.TaggedError("HashingServiceSha256Error")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface HashingServiceSha256Def {
  /**
   * Compute the SHA-256 digest of the input and return it as a lowercase hex string.
   *
   * Accepts either a string (UTF-8 encoded) or a Uint8Array (raw bytes).
   */
  readonly digestHex: (
    input: string | Uint8Array,
  ) => Effect.Effect<string, HashingServiceSha256Error>
}

export class HashingServiceSha256
  extends Context.Service<HashingServiceSha256, HashingServiceSha256Def>()(HashingServiceSha256Id)
{}

/** {@inheritDoc HashingServiceSha256Def.digestHex} */
export const digestHex = Effect.fn("HashingServiceSha256.digestHex")(function*(
  ...params: Parameters<HashingServiceSha256Def["digestHex"]>
): Effect.fn.Return<string, HashingServiceSha256Error, HashingServiceSha256> {
  const svc = yield* HashingServiceSha256
  return yield* svc.digestHex(...params)
})
