import { PrintConfig } from "shared"

import { concat } from "../util"
import { constantPrefix } from "./index.constants"

/**
 * Canonical value lives in `shared` (print-config wire contract): the server's
 * PdfPrintService seeds the print config into localStorage under this same key
 * before loading the site. Must stay identical to `concat(constantPrefix, "__print-config")`.
 */
export const PRINT_CONFIG_LOCAL_STORAGE_KEY = PrintConfig.PRINT_CONFIG_LOCAL_STORAGE_KEY

/** localStorage key for user-saved named presets (a `Record<name, base64>`). */
export const PRINT_CONFIG_PRESETS_LOCAL_STORAGE_KEY = concat(
  constantPrefix,
  "__print-config-presets",
)

/** Reserved name for the built-in, read-only preset (the Reset target). */
export const DEFAULT_PRESET_NAME = "Default"
