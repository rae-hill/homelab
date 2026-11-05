// Server assembly: toolkits + policy visibility gates + request-level service middleware.
// Exported as a factory so main.ts (live layers) and tests (stubs) share the exact wiring.
//
// Policy enforcement layers (defense in depth):
//   1. visibility gates below — tools of a disabled operation are hidden from listTools and
//      calls fail not-found (the LLM cannot see or invoke them),
//   2. handler-level whitelist checks (tools/label.ts),
//   3. service-level re-validation (layers/imap-mail.ts assertLabelAllowed).
// Plus OpenClaw's own mcp.servers.toolFilter as a fourth, client-side layer.
//
// Tool `dependencies` (declared per tool) are request-level services discharged by the
// `services` middleware — pattern from repos/effect/packages/effect/test/ai/McpServer/
// McpTest.test.ts (WhoAmI/CurrentUser example).
import { Effect, Layer } from "effect"
import * as McpProtocol from "effect/ai/McpProtocol"
import * as McpServer from "effect/ai/McpServer"
import type { ImapMailServiceDef } from "./services/mail.js"
import { ImapMailService } from "./services/mail.js"
import type { PolicyServiceDef } from "./services/policy.js"
import { PolicyService } from "./services/policy.js"
import { labelHandlers, labelToolkit } from "./tools/label.js"
import { readHandlers, readToolkit } from "./tools/read.js"

export const makeRegistrations = (mail: ImapMailServiceDef, policy: PolicyServiceDef) => {
  const services = McpServer.middleware<{ provides: ImapMailService | PolicyService }>()((effect) =>
    Effect.provideService(Effect.provideService(effect, ImapMailService, mail), PolicyService, policy)
  )
  const readGate = McpServer.visibility(() => Effect.succeed(policy.readEnabled))
  const labelGate = McpServer.visibility(() => Effect.succeed(policy.labelEnabled))

  return Layer.mergeAll(
    McpServer.toolkit(readToolkit).pipe(
      Layer.provide(readGate.combine(services).layer),
      Layer.provide(readHandlers),
    ),
    McpServer.toolkit(labelToolkit).pipe(
      Layer.provide(labelGate.combine(services).layer),
      Layer.provide(labelHandlers),
    ),
  )
}

// Stateful protocol adapters only (v2026_07_28 is stateless — avoid unless a client requires
// it). TODO(deploy): confirm which version OpenClaw's MCP client negotiates.
export const makeServerOptions = (mail: ImapMailServiceDef, policy: PolicyServiceDef) =>
  ({
    name: "proton-mail-mcp",
    version: "0.1.0",
    instructions: "Read and label Proton Mail via the local Proton Mail Bridge. Read tools cover folders, " +
      "message listing/paging, full message fetch (truncated bodies, attachment metadata only), " +
      "search, and unread counts. Label tools exist only when enabled by server policy, and only " +
      "for whitelisted labels. This server NEVER sends, deletes, or trashes mail.",
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25],
    registrations: makeRegistrations(mail, policy),
  }) as const
