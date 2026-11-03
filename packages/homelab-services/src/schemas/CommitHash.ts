import { Schema, SchemaGetter } from "effect"
import { Hex } from "./Hex.js"

export const CommitHash = Hex.pipe(
  Schema.check(
    Schema.makeFilter((hex: string) => hex.length === 40 ? undefined : "Expected hexadecimal string of length 40"),
  ),
  Schema.brand("CommitHash"),
)

export const ShortCommitHash = Hex.pipe(
  Schema.check(
    Schema.makeFilter((hex: string) => hex.length === 7 ? undefined : "Expected hexadecimal string of length 7"),
  ),
  Schema.brand("ShortCommitHash"),
)

/**
 * Converts a 40 length hex string to a 7 length hex string
 *
 * @remarks
 * used to pass in a full length commit hash and parse it down to the
 * short hash.  In this app this is used for the version for opentelemetry
 */
export const ShortCommitHashFromCommitHash = CommitHash.pipe(
  Schema.decodeTo(ShortCommitHash, {
    decode: SchemaGetter.transform((hash) => hash.substring(0, 7) as typeof ShortCommitHash.Type),
    encode: SchemaGetter.forbidden(() => "Unable to form commit hash from short commit hash"),
  }),
)
