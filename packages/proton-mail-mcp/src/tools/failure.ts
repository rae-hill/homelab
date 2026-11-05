import { Schema } from "effect"
import type { MailError } from "../errors.js"

/**
 * The single declared tool-failure shape. Tool errors surface as MCP `isError` results with
 * this JSON payload, so the agent can distinguish "Bridge is down" (retry later / tell the
 * user) from "policy denied" (do not retry) from "not found".
 */
export class MailToolFailure extends Schema.Class<MailToolFailure>("proton-mail-mcp/MailToolFailure")({
  kind: Schema.Literals([
    "bridge_unavailable",
    "imap_error",
    "message_not_found",
    "policy_denied",
    "mail_parse_error",
  ]),
  message: Schema.String,
}) {}

export const toFailure = (error: MailError): MailToolFailure => {
  switch (error._tag) {
    case "proton-mail-mcp/BridgeUnavailable":
      return new MailToolFailure({ kind: "bridge_unavailable", message: error.message })
    case "proton-mail-mcp/ImapError":
      return new MailToolFailure({ kind: "imap_error", message: error.message })
    case "proton-mail-mcp/MessageNotFound":
      return new MailToolFailure({ kind: "message_not_found", message: error.message })
    case "proton-mail-mcp/PolicyDenied":
      return new MailToolFailure({ kind: "policy_denied", message: error.message })
    case "proton-mail-mcp/MailParseError":
      return new MailToolFailure({ kind: "mail_parse_error", message: error.message })
  }
}
