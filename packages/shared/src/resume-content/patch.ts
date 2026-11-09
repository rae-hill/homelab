/**
 * JSON Patch codec for resume content: base64 ↔ ops array ↔ ContentState.
 *
 * The codec decodes base64 patches against the frozen `INITIAL_CONTENT_STATE`, applying
 * JSON Patch operations to reconstruct the full `ContentState`. This is the heart of
 * decision D3: patches are the only content representation on the wire.
 */

import { Effect, JsonPatch, Schema, SchemaGetter, SchemaIssue } from "effect"
import { INITIAL_CONTENT_STATE } from "./constants.js"
import { ContentState } from "./schema.js"

/* ---- JSON Patch Operation Schema --------------------------------------------------------- */

/**
 * Hand-written JSON Patch operation schema. The `JsonPatch` module exports types only,
 * no schema, so we define the wire shape here. Validation of semantics (paths exist,
 * indices in bounds) happens at apply time via `JsonPatch.apply`.
 */
const AddOp = Schema.Struct({
  op: Schema.Literal("add"),
  path: Schema.String,
  value: Schema.Json,
  description: Schema.optional(Schema.String),
})

const RemoveOp = Schema.Struct({
  op: Schema.Literal("remove"),
  path: Schema.String,
  description: Schema.optional(Schema.String),
})

const ReplaceOp = Schema.Struct({
  op: Schema.Literal("replace"),
  path: Schema.String,
  value: Schema.Json,
  description: Schema.optional(Schema.String),
})

export const JsonPatchOperationSchema = Schema.Union([AddOp, RemoveOp, ReplaceOp])

export const ContentPatchOps = Schema.Array(JsonPatchOperationSchema)

/* ---- Content Patch Base64 Codec ---------------------------------------------------------- */

/**
 * Encoded (plain-JSON) form of the defaults, computed once at module load. Patches are applied
 * and diffed in ENCODED space — this matches `toDifferJsonPatch` semantics and keeps both
 * sides byte-identical.
 */
const EncodedDefaults: Schema.Json = Schema.encodeSync(ContentState)(INITIAL_CONTENT_STATE)

/**
 * Wire side: base64 string. Typed side: ContentState.
 *
 * Decode = apply the patch to the frozen defaults, then ContentState's own decode validates
 * the result. Encode = diff against the same defaults.
 *
 * The getter directions are verified against `repos/effect` Schema.ts:5678–5707:
 * - `decode` getter: receives `From.Type` (ops array), returns `To.Encoded` (encoded ContentState)
 * - `encode` getter: receives `To.Encoded` (encoded ContentState), returns `From.Type` (ops array)
 */
export const ContentPatchBase64 = Schema.StringFromBase64.pipe(
  // base64 string <-> JSON string <-> ops array
  Schema.decodeTo(Schema.fromJsonString(ContentPatchOps)),
  // ops array <-> ENCODED ContentState JSON
  Schema.decodeTo(ContentState, {
    decode: SchemaGetter.transformEffect((ops, options) =>
      Effect.try({
        try: () => {
          const patchedJson = JsonPatch.apply(ops as JsonPatch.JsonPatch, EncodedDefaults)
          return Schema.decodeUnknownSync(ContentState)(patchedJson)
        },
        catch: (cause) =>
          new SchemaIssue.InvalidValue(
            { message: `Failed to apply JSON patch: ${cause}` },
            ops,
            options,
          ),
      })
    ),
    encode: SchemaGetter.transform((content) =>
      JsonPatch.get(EncodedDefaults, Schema.encodeSync(ContentState)(content))
    ),
  }),
)

/* ---- Content Differ ---------------------------------------------------------------------- */

/**
 * Differ for building patches from typed `ContentState` values. The server uses this to diff
 * `INITIAL_CONTENT_STATE` vs the tailored `ContentState`; the client uses it to diff the
 * defaults vs the user's current `ContentState` (to build the request).
 *
 * The `diff` method takes TYPED values and encodes internally — do NOT pass pre-encoded JSON.
 */
export const ContentDiffer = Schema.toDifferJsonPatch(ContentState)
