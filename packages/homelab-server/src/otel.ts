import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base"
import { Config, Effect, Option } from "effect"
import { Schemas } from "homelab-services"

export const OtelLive = NodeSdk.layer(
  Effect.gen(function*() {
    const { homelabCommitHash, otelGrpcEndpointUrl } = yield* Config.all({
      homelabCommitHash: Config.schema(Schemas.CommitHash.ShortCommitHashFromCommitHash, "HOMELAB_COMMIT_HASH"),
      otelGrpcEndpointUrl: Config.option(Config.URL("OTEL_GRPC_ENDPOINT_URL")),
    })

    const spanProcessor = new BatchSpanProcessor(
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

    return {
      resource: {
        serviceName: "homelab-api",
        serviceVersion: `homelab-api__${homelabCommitHash}`,
      },
      spanProcessor,
    } satisfies NodeSdk.Configuration
  }),
)
