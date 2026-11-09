import { Effect, Schema } from "effect"
import { type LazyArg } from "effect/Function"

/**
 * General-purpose optional-field combinator with a decoding default. When a field is absent
 * in the encoded input, the default is materialized during decode. This keeps persisted blobs
 * decodable when new fields are added (no version bump needed for additive changes).
 *
 * Moved from `homelab-services/src/schemas/optionals.ts` to make it available to all packages.
 */
export function OptionalWithDefault<A, E, RD, RE>(
  schema: Schema.Codec<A, E, RD, RE>,
  _default: LazyArg<A>,
): Schema.Codec<A, E, RD, RE> {
  const result = schema.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(_default)),
  )
  return result as Schema.Codec<A, E, RD, RE>
}
