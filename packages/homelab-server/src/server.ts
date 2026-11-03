import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { Config, Layer } from "effect"
import { createServer } from "http"

export const HttpServerLive = Layer.unwrap(
  Config.all({
    port: Config.Int("PORT"),
    host: Config.withDefault(Config.String("HOST"), "127.0.0.1"),
  }).pipe(
    Config.map(({ host, port }) => NodeHttpServer.layer(() => createServer(), { port, host })),
  ),
)
