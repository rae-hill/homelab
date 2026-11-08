import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiSwagger } from "effect/http-api"
import { Homelab } from "homelab-api"
import { Layers, Shell } from "homelab-services-node"
import { ApiLive } from "./api.js"
import { EnvLive } from "./env.js"
import { LoggerLive } from "./logger.js"
import { OtelLive } from "./otel.js"
import { HttpServerLive } from "./server.js"
import { ProfileUuidConfigLive } from "./uuids.js"

const Routes = ApiLive.pipe(
  Layer.merge(HttpApiSwagger.layer(Homelab.HomelabApi)),
)

// Per-request server spans (OTel kind=server) that END with the response — Tempo traces
// finally get a resolving root. Parenting comes only from an inbound `traceparent`
// header, so request traces are self-contained roots otherwise. `serve` composes the
// default `HttpMiddleware.logger` INSIDE this, so "Sent HTTP response" lands as a span
// event too.
//
// Naming quirk (empirically verified): the SpanNameGenerator override lands on the
// ROUTE-level span HttpApi creates further inside — the outermost middleware span reads
// the fiber ref before the provided value is in scope and keeps the method-only default
// ("POST"). The named child ("POST /resume/tailor", with the http.route attribute) is
// the span to read in Tempo; the method-named root is just its completing parent.
const Server = HttpRouter.serve(Routes, {
  middleware: (httpApp) =>
    Effect.provideService(
      HttpMiddleware.tracer(httpApp),
      HttpMiddleware.SpanNameGenerator,
      (request) => `${request.method} ${request.url.split("?")[0]}`,
    ),
}).pipe(
  Layer.provide(LoggerLive),
  Layer.provide(OtelLive),
  Layer.provide(Shell.Authentication.Aggregate),
  Layer.provide(Shell.Authorization.Aggregate),
  Layer.provide(Shell.Crypto.Aggregate),
  Layer.provide(Shell.Printing.Aggregate),
  Layer.provide(Shell.Tailor.Aggregate),
  Layer.provide(Shell.ProfilePayload.Aggregate),
  Layer.provide(Layers.CertificateService.CertificateServiceLive),
  Layer.provide(Layers.UuidService.UuidServiceLive),
  Layer.provide(ProfileUuidConfigLive),
  Layer.provide(Shell.Config.ConfigLive),
  Layer.provide(EnvLive),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
  Layer.provide(
    Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, HttpClient.filterStatusOk),
    ).pipe(Layer.provide(FetchHttpClient.layer)),
  ),
  Layer.provide(HttpServerLive),
  Layer.tapError(Effect.logFatal),
)

NodeRuntime.runMain(
  Layer.launch(Server),
  {
    disableErrorReporting: false,
  },
)
