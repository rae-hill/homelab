import { Array, Cause, Config, Formatter, Inspectable, Layer, Logger, References } from "effect"
import { match } from "ts-pattern"

/** Regex matching sensitive key names that should be redacted in logs. */
const SENSITIVE_KEY_PATTERN = /authorization|api[_-]?key|secret|bearer/i

/** Redact sensitive values in log annotations to prevent credential leakage. */
const redactSensitiveValue = (key: string, value: unknown): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]"
  }
  return value
}

export const structureLogMessage = (u: unknown): unknown => {
  switch (typeof u) {
    case "bigint":
    case "function":
    case "symbol": {
      return String(u)
    }
    default: {
      return Inspectable.toJson(u)
    }
  }
}

function getLoggableMessage(
  line: unknown,
): Record<string, unknown> {
  if (line instanceof Error) return { error: structureLogMessage(line) }
  if (Array.isArray(line) && line.every((err) => err instanceof Error)) {
    if (line.length === 1) {
      return { error: structureLogMessage(line[0]) }
    }

    return structureLogMessage(
      line.reduce(
        (acc, curr, i) => {
          acc[`error_${i}`] = curr

          return acc
        },
        {} as Record<string, unknown>,
      ),
    ) as Record<string, unknown>
  }

  return structureLogMessage({ message: line }) as Record<string, unknown>
}

export const jsonLogger = Logger.make<unknown, unknown>(
  ({ cause, date, fiber, logLevel, message }) => {
    const now = date.getTime()
    const annotationsObj: Record<string, unknown> = {}
    const spansObj: Record<string, number> = {}

    const annotations = fiber.getRef(References.CurrentLogAnnotations)
    for (const [k, v] of Object.entries(annotations)) {
      annotationsObj[k] = structureLogMessage(redactSensitiveValue(k, v))
    }

    const spans = fiber.getRef(References.CurrentLogSpans)
    for (const [label, timestamp] of spans) {
      spansObj[label] = now - timestamp
    }

    const loggedMessage = getLoggableMessage(message)

    return {
      logLevel,
      timestamp: date.toISOString(),
      cause: cause.reasons.length > 0 ? Cause.pretty(cause) : undefined,
      annotations: annotationsObj,
      spans: spansObj,
      fiberId: String(fiber.id),
      ...loggedMessage,
    }
  },
)

export const jsonConsoleLogger = jsonLogger.pipe(
  Logger.map(Formatter.formatJson),
  Logger.withLeveledConsole,
)

// Logger.layer REPLACES the default logger set, and the default set includes
// `Logger.tracerLogger` — the logger that turns `Effect.log*` messages into OTel span
// events. Without it explicitly listed here, no log text is ever attached to spans and
// Tempo's span "Logs" sections stay empty. Keep it in every branch.
export const LoggerLive = Layer.unwrap(
  Config.option(Config.Literals(["JSON", "pretty"], "LOG_STYLE"))
    .pipe(
      Config.map(
        (_) =>
          match(_)
            .with(
              { _tag: "None" },
              { _tag: "Some", value: "JSON" },
              () => Logger.layer([jsonConsoleLogger, Logger.tracerLogger]),
            )
            .with(
              { _tag: "Some", value: "pretty" },
              () => Logger.layer([Logger.consolePretty(), Logger.tracerLogger]),
            )
            .exhaustive(),
      ),
    ),
)
