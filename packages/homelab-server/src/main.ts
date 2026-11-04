import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpRouter } from "effect/http"
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

const Server = HttpRouter.serve(Routes).pipe(
  Layer.provide(LoggerLive),
  Layer.provide(OtelLive),
  Layer.provide(Shell.Authentication.Aggregate),
  Layer.provide(Shell.Authorization.Aggregate),
  Layer.provide(Shell.Crypto.Aggregate),
  Layer.provide(Shell.Printing.Aggregate),
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
