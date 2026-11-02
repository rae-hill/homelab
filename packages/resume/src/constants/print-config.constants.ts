import { concat } from "../util"
import { constantPrefix } from "./index.constants"

export const PRINT_CONFIG_LOCAL_STORAGE_KEY = concat(constantPrefix, "__print-config")

/** localStorage key for user-saved named presets (a `Record<name, base64>`). */
export const PRINT_CONFIG_PRESETS_LOCAL_STORAGE_KEY = concat(
  constantPrefix,
  "__print-config-presets",
)

/** Reserved name for the built-in, read-only preset (the Reset target). */
export const DEFAULT_PRESET_NAME = "Default"
