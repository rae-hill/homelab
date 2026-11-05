// Entry point: builds the service layers once (fail-fast on bad env), then launches the stdio
// MCP server. Side-effectful startup lives only here — server.ts is importable/testable.
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import * as McpServer from "effect/ai/McpServer"
import { EnvLive } from "./env.js"
import { ImapMailServiceLive } from "./layers/imap-mail.js"
import { makeServerOptions } from "./server.js"
import { ImapMailService } from "./services/mail.js"
import { PolicyService, PolicyServiceLive } from "./services/policy.js"

const ServicesLive = ImapMailServiceLive.pipe(
  Layer.provideMerge(PolicyServiceLive),
  Layer.provide(EnvLive),
)

const main = Effect.gen(function*() {
  const mail = yield* ImapMailService
  const policy = yield* PolicyService
  const server = McpServer.layerStdio(makeServerOptions(mail, policy)).pipe(
    Layer.provide(NodeStdio.layer),
  )
  yield* Layer.launch(server)
})

NodeRuntime.runMain(main.pipe(Effect.provide(ServicesLive)))
