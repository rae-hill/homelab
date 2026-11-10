/**
 * Schema-based nested-error serialization (v2 error model — doc 07 §A).
 *
 * Owner directive (2026-11-09): use Effect Schema decode/encode instead of a hand-rolled
 * serializer — the encoded shape is validated by the schema and serialization is Effect's
 * built-in.
 *
 * `Schema.Defect` is Effect's codec for arbitrary failure values (unknown ⇄ Json):
 *
 * - **encode**: `Error` instances — including `Data.TaggedError`s, whose `name` carries the
 *   `_tag` — become recursive `{ name, message, cause? }` JSON objects; circular references
 *   become `"[Circular]"`; stack traces only with `{ includeStack: true }`. Non-Error values
 *   go through Effect's JSON formatter (`Inspectable`-aware, so Data values keep their
 *   fields); non-JSON-representable values fall back to a formatted string.
 * - **decode**: validates the JSON and rebuilds objects with a string `message` back into
 *   `Error` instances (round-trippable).
 *
 * Consumers store the encoded JSON in `TailorError.error` → `InternalServerError.error`
 * (its `OptionalUnknown`/`JsonUnknown` field passes pre-validated JSON through untouched),
 * so logs and error responses carry the raw nested error JSON — no bespoke string rendering
 * (v1's `describeErrorChain` is retired).
 *
 * Note: the native Error encoding keeps `name`/`message`/`cause` — extra own fields of Error
 * subclasses are not captured, so anything load-bearing belongs in `message`/`cause` (or is
 * passed alongside, like `TailorError.error`).
 */
import { Schema } from "effect"

/** Codec between unknown failure values (Type side) and validated nested JSON (Encoded side). */
export const ErrorJson = Schema.Defect()

/**
 * Serialize any caught error/defect into nested JSON-safe structure for wire/log payloads.
 * Replaces v1's `describeErrorChain` string rendering.
 */
export const errorToJson = (error: unknown): Schema.Json => Schema.encodeSync(ErrorJson)(error)

/** Decode + validate received nested error JSON (objects with `message` rebuild as `Error`s). */
export const parseErrorJson = (json: unknown): unknown => Schema.decodeUnknownSync(ErrorJson)(json)
