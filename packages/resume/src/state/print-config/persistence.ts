import { Result, Schema } from "effect"

import { PRINT_CONFIG_LOCAL_STORAGE_KEY } from "../../constants/print-config.constants"
import { PersistedPrintConfig } from "./schema"
import { initialPrintConfigState, type PrintConfigState } from "./types"

export { PRINT_CONFIG_LOCAL_STORAGE_KEY }

/** The persisted projection type (everything except the ephemeral `editingEnabled`). */
export type PersistedConfig = Schema.Schema.Type<typeof PersistedPrintConfig>

/**
 * Codec for a **JSON string** ↔ persisted config. `fromJsonString` does the JSON
 * parse/stringify as part of the schema, so there is no manual `JSON.parse`.
 */
const PersistedJson = Schema.fromJsonString(PersistedPrintConfig)

/**
 * Codec for a **base64 string** ↔ persisted config, composed as
 * `base64 → JSON string → value`: `StringFromBase64` decodes the base64 to a string,
 * then the `PersistedJson` codec parses that string as JSON into the schema. One codec
 * handles the whole import/export + preset wire format.
 */
const PersistedBase64 = Schema.StringFromBase64.pipe(Schema.decodeTo(PersistedJson))

const decodeJson = Schema.decodeUnknownResult(PersistedJson)
const decodeBase64 = Schema.decodeUnknownResult(PersistedBase64)
const encodeJson = Schema.encodeSync(PersistedJson)
const encodeBase64 = Schema.encodeSync(PersistedBase64)

/**
 * Turn a decode `Result` into the full runtime state (adding the ephemeral
 * `editingEnabled` default), or log the Effect schema error and fall back to defaults.
 */
function toStateOrDefault(
  result: Result.Result<PersistedConfig, unknown>,
  context: string,
): PrintConfigState {
  if (Result.isSuccess(result)) {
    return {
      ...result.success,
      editingEnabled: initialPrintConfigState.editingEnabled,
    }
  }
  console.warn(
    `Failed to decode ${context}; resetting to default state.`,
    result.failure,
  )
  return initialPrintConfigState
}

/**
 * Parse the persisted localStorage blob (a JSON string) via the schema. On any schema
 * mismatch the Effect error is logged and the state resets to defaults. `editingEnabled`
 * is never restored (ephemeral — re-locks each load).
 */
export function parsePersisted(raw: string | null): PrintConfigState {
  if (raw === null) {
    return initialPrintConfigState
  }
  return toStateOrDefault(decodeJson(raw), PRINT_CONFIG_LOCAL_STORAGE_KEY)
}

/**
 * Decode a base64-encoded config blob (import / preset recall). Returns `null` on failure
 * (and logs the Effect error) so callers can surface an inline UI error.
 */
export function decodeBase64Config(base64: string): PrintConfigState | null {
  const result = decodeBase64(base64.trim())
  if (Result.isSuccess(result)) {
    return { ...result.success, editingEnabled: initialPrintConfigState.editingEnabled }
  }
  console.warn("Failed to decode imported config.", result.failure)
  return null
}

/** The JSON string persisted to localStorage (schema-encoded; omits `editingEnabled`). */
export function persistableSnapshot(state: PrintConfigState): string {
  return encodeJson(state)
}

/** Base64-encode the current config (for export / presets). */
export function encodeBase64Config(state: PrintConfigState): string {
  return encodeBase64(state)
}
