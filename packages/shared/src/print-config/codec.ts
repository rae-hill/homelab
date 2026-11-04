/**
 * Wire codecs for the persisted print config: `base64 ↔ JSON string ↔ value`.
 *
 * `PersistedBase64` composes `StringFromBase64` with `fromJsonString(PersistedPrintConfig)`
 * so a single codec handles the whole import/export + preset + remote-print wire format.
 * All decode functions return `Result`s (no logging, no fallbacks) — callers decide how to
 * surface failures (the resume app injects its default state; the API rejects with a
 * schema error).
 */

import { Result, Schema } from "effect"

import * as S from "./schema.js"

/** Codec for a **JSON string** ↔ persisted config (the JSON parse is part of the schema). */
export const PersistedJson = Schema.fromJsonString(S.PersistedPrintConfig)

/**
 * Codec for a **base64 string** ↔ persisted config, composed as
 * `base64 → JSON string → value`.
 */
export const PersistedBase64 = Schema.StringFromBase64.pipe(Schema.decodeTo(PersistedJson))

/**
 * A base64 print-config blob that stays a `string` on the wire but **validates** that it
 * decodes to a `PersistedPrintConfig`. Used for API request payloads so handlers can
 * forward the original blob (e.g. into a resume URL) without re-encoding.
 */
export const ConfigBase64String = Schema.String.check(
  Schema.makeFilter((s) =>
    Result.isSuccess(decodePersistedBase64(s.trim())) ?
      undefined
      : "config is not a valid base64-encoded print config"
  ),
)

export const decodePersistedJson = Schema.decodeUnknownResult(PersistedJson)
export const decodePersistedBase64 = Schema.decodeUnknownResult(PersistedBase64)
export const encodePersistedJson = Schema.encodeSync(PersistedJson)
export const encodePersistedBase64 = Schema.encodeSync(PersistedBase64)
