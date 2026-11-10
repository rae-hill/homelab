import { Array, Cause, Config, Formatter, Inspectable, Layer, Logger, References } from "effect"
import { match } from "ts-pattern"

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
      annotationsObj[k] = structureLogMessage(v)
    }

    const spans = fiber.getRef(References.CurrentLogSpans)
    for (const [label, timestamp] of spans) {
      spansObj[label] = now - timestamp
    }

    const loggedMessage = getLoggableMessage(message)

    // Extract trace_id and span_id from the current OTel span if available
    // fiber.cache.span is AnySpan (Span | ExternalSpan), both expose traceId/spanId
    const currentSpan = fiber.cache.span
    const traceContext = currentSpan
      ? { trace_id: currentSpan.traceId, span_id: currentSpan.spanId }
      : {}

    return {
      logLevel,
      timestamp: date.toISOString(),
      cause: cause.reasons.length > 0 ? Cause.pretty(cause) : undefined,
      annotations: annotationsObj,
      spans: spansObj,
      fiberId: String(fiber.id),
      ...traceContext,
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
