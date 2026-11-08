import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { Config, Effect, Option } from "effect"
import { Schemas } from "homelab-services"

/** Regex matching sensitive attribute keys that should be redacted in spans. */
const SENSITIVE_KEY_PATTERN = /authorization|api[_-]?key|secret|bearer/i

/** Redact sensitive values in span attributes to prevent credential leakage. */
const redactSpanAttributes = (attributes: Record<string, any>): Record<string, any> => {
  const redacted: Record<string, any> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[REDACTED]"
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

/** SpanProcessor wrapper that redacts sensitive attributes before export. */
class RedactingSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: any): void {
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    // Redact sensitive attributes before passing to inner processor
    const originalAttributes = span.attributes
    const redactedAttributes = redactSpanAttributes(originalAttributes as Record<string, any>)

    // Create a wrapper that returns redacted attributes
    const wrappedSpan = new Proxy(span, {
      get(target, prop) {
        if (prop === "attributes") {
          return redactedAttributes
        }
        const value = (target as any)[prop]
        return typeof value === "function" ? value.bind(target) : value
      },
    })

    this.inner.onEnd(wrappedSpan)
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

export const OtelLive = NodeSdk.layer(
  Effect.gen(function*() {
    const { homelabCommitHash, otelGrpcEndpointUrl } = yield* Config.all({
      homelabCommitHash: Config.schema(Schemas.CommitHash.ShortCommitHashFromCommitHash, "HOMELAB_COMMIT_HASH"),
      otelGrpcEndpointUrl: Config.option(Config.URL("OTEL_GRPC_ENDPOINT_URL")),
    })

    const innerSpanProcessor = new BatchSpanProcessor(
      otelGrpcEndpointUrl.pipe(
        Option.match({
          onNone() {
            return new ConsoleSpanExporter()
          },
          onSome(url) {
            return new OTLPTraceExporter({
              url: url.toString(),
            })
          },
        }),
      ),
    )

    // Wrap the span processor to redact sensitive attributes
    const spanProcessor = new RedactingSpanProcessor(innerSpanProcessor)

    return {
      resource: {
        serviceName: "homelab-api",
        serviceVersion: `homelab-api__${homelabCommitHash}`,
      },
      spanProcessor,
    } satisfies NodeSdk.Configuration
  }),
)
