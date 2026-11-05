import { Config, Context, Data, Effect, Layer, Option } from "effect"

/**
 * Env configuration for the Proton Mail MCP server. All values come from the environment
 * (OpenClaw spawns this process with `mcp.servers.protonmail.env` fed from sops secrets).
 *
 * Policy model: the server registers every tool, but tools of a disabled operation are HIDDEN
 * via McpServer visibility gates, and handlers + the IMAP layer independently re-validate the
 * label whitelist (defense in depth — the LLM cannot call what it cannot see, and even a
 * confused caller gets PolicyDenied for non-whitelisted labels).
 */

export type Operation = "read" | "label"

const ALL_OPERATIONS: ReadonlyArray<Operation> = ["read", "label"]

/** Hosts considered loopback (self-signed Bridge cert tolerated ONLY for these). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

export interface EnvDef {
  /** IMAP host of the local Proton Mail Bridge. */
  readonly bridgeHost: string
  /** IMAP port of the local Proton Mail Bridge (default 1143). */
  readonly bridgePort: number
  /** Mailbox address shown in Bridge's "Mailbox details". */
  readonly bridgeUsername: string
  /** Bridge-generated mailbox password (NOT the Proton account password; revocable in Bridge). */
  readonly bridgePassword: string
  /** Bridge "Connection mode": STARTTLS (default) or implicit TLS. */
  readonly bridgeTlsMode: "starttls" | "implicit"
  /** PEM CA file pinning the Bridge self-signed cert. Required for non-loopback hosts. */
  readonly bridgeTlsCaFile: Option.Option<string>
  /** Enabled operation groups. Default: read only. */
  readonly operations: ReadonlySet<Operation>
  /** Label whitelist (exact names). Required non-empty when "label" is enabled. */
  readonly allowedLabels: ReadonlyArray<string>
  /** Truncation cap for text/html bodies returned to the LLM. */
  readonly maxBodyBytes: number
  /** Page-size cap for list/search results. */
  readonly maxListMessages: number
}

export class Env extends Context.Service<Env, EnvDef>()("proton-mail-mcp/config/Env") {}

export class EnvError extends Data.TaggedError("proton-mail-mcp/EnvError")<{
  readonly message: string
}> {}

/** Raw (string/number) shape produced by Config.all before validation. Exported for tests. */
export interface RawEnv {
  readonly bridgeHost: string
  readonly bridgePort: number
  readonly bridgeUsername: string
  readonly bridgePassword: string
  readonly bridgeTlsMode: string
  readonly bridgeTlsCaFile: Option.Option<string>
  readonly operationsRaw: string
  readonly allowedLabelsRaw: string
  readonly maxBodyBytes: number
  readonly maxListMessages: number
}

const parseCsv = (raw: string): Array<string> =>
  raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

/** Labels become `Labels/<name>` IMAP folder paths — reject path separators and NUL outright. */
const validateLabelName = (label: string): string | undefined => {
  if (label.length === 0) return "empty label name"
  if (/[/\\\0]/.test(label)) return `invalid characters in label "${label}" (no slashes or NUL allowed)`
  return undefined
}

/** Pure validation/parsing of raw env values. Exported for unit tests. */
export const buildEnv = (raw: RawEnv): Effect.Effect<EnvDef, EnvError> =>
  Effect.gen(function*() {
    if (!Number.isInteger(raw.bridgePort) || raw.bridgePort < 1 || raw.bridgePort > 65_535) {
      return yield* Effect.fail(
        new EnvError({ message: `PROTON_BRIDGE_IMAP_PORT out of range [1, 65535]: ${raw.bridgePort}` }),
      )
    }
    if (raw.bridgeTlsMode !== "starttls" && raw.bridgeTlsMode !== "implicit") {
      return yield* Effect.fail(
        new EnvError({
          message: `PROTON_BRIDGE_TLS_MODE must be "starttls" or "implicit", got "${raw.bridgeTlsMode}"`,
        }),
      )
    }
    if (!LOOPBACK_HOSTS.has(raw.bridgeHost) && Option.isNone(raw.bridgeTlsCaFile)) {
      return yield* Effect.fail(
        new EnvError({
          message: `refusing non-loopback Bridge host "${raw.bridgeHost}" without PROTON_BRIDGE_TLS_CA_FILE ` +
            "(pin the Bridge certificate when leaving localhost)",
        }),
      )
    }
    if (raw.bridgeUsername.length === 0 || raw.bridgePassword.length === 0) {
      return yield* Effect.fail(
        new EnvError({ message: "PROTON_BRIDGE_USERNAME and PROTON_BRIDGE_PASSWORD must be non-empty" }),
      )
    }

    const operations = new Set<Operation>()
    for (const token of parseCsv(raw.operationsRaw)) {
      if (token !== "read" && token !== "label") {
        return yield* Effect.fail(
          new EnvError({
            message: `PROTON_MCP_OPERATIONS: unknown operation "${token}" (allowed: ${ALL_OPERATIONS.join(", ")})`,
          }),
        )
      }
      operations.add(token)
    }

    const allowedLabels = parseCsv(raw.allowedLabelsRaw)
    for (const label of allowedLabels) {
      const problem = validateLabelName(label)
      if (problem !== undefined) {
        return yield* Effect.fail(new EnvError({ message: `PROTON_MCP_ALLOWED_LABELS: ${problem}` }))
      }
    }
    if (operations.has("label") && allowedLabels.length === 0) {
      return yield* Effect.fail(
        new EnvError({
          message: "PROTON_MCP_ALLOWED_LABELS must list at least one label when the \"label\" operation is enabled",
        }),
      )
    }

    if (!Number.isInteger(raw.maxBodyBytes) || raw.maxBodyBytes < 1) {
      return yield* Effect.fail(new EnvError({ message: "PROTON_MCP_MAX_BODY_BYTES must be an integer >= 1" }))
    }
    if (!Number.isInteger(raw.maxListMessages) || raw.maxListMessages < 1 || raw.maxListMessages > 100) {
      return yield* Effect.fail(
        new EnvError({ message: "PROTON_MCP_MAX_LIST_MESSAGES must be an integer in [1, 100]" }),
      )
    }

    return {
      bridgeHost: raw.bridgeHost,
      bridgePort: raw.bridgePort,
      bridgeUsername: raw.bridgeUsername,
      bridgePassword: raw.bridgePassword,
      bridgeTlsMode: raw.bridgeTlsMode,
      bridgeTlsCaFile: raw.bridgeTlsCaFile,
      operations,
      allowedLabels,
      maxBodyBytes: raw.maxBodyBytes,
      maxListMessages: raw.maxListMessages,
    }
  })

export const EnvLive = Layer.effect(
  Env,
  Config.all({
    bridgeHost: Config.withDefault(Config.String("PROTON_BRIDGE_IMAP_HOST"), "127.0.0.1"),
    bridgePort: Config.withDefault(Config.Int("PROTON_BRIDGE_IMAP_PORT"), 1143),
    bridgeUsername: Config.String("PROTON_BRIDGE_USERNAME"),
    bridgePassword: Config.String("PROTON_BRIDGE_PASSWORD"),
    bridgeTlsMode: Config.withDefault(Config.String("PROTON_BRIDGE_TLS_MODE"), "starttls"),
    bridgeTlsCaFile: Config.option(Config.String("PROTON_BRIDGE_TLS_CA_FILE")),
    operationsRaw: Config.withDefault(Config.String("PROTON_MCP_OPERATIONS"), "read"),
    allowedLabelsRaw: Config.withDefault(Config.String("PROTON_MCP_ALLOWED_LABELS"), ""),
    maxBodyBytes: Config.withDefault(Config.Int("PROTON_MCP_MAX_BODY_BYTES"), 20_000),
    maxListMessages: Config.withDefault(Config.Int("PROTON_MCP_MAX_LIST_MESSAGES"), 25),
  }).pipe(Effect.flatMap(buildEnv)),
)
