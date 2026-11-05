import { Data } from "effect"

/**
 * Proton Mail Bridge is not reachable at the configured host/port — it is not running, is
 * locked, or lost its Proton connection (Bridge shuts its IMAP server down in those states).
 */
export class BridgeUnavailableError extends Data.TaggedError("proton-mail-mcp/BridgeUnavailable")<{
  readonly message: string
}> {}

/** Any other IMAP-level failure (protocol error, missing mailbox, server refusal, ...). */
export class ImapError extends Data.TaggedError("proton-mail-mcp/ImapError")<{
  readonly message: string
}> {}

export class MessageNotFoundError extends Data.TaggedError("proton-mail-mcp/MessageNotFound")<{
  readonly message: string
}> {}

/** The requested operation/label is outside the configured env whitelist policy. */
export class PolicyDeniedError extends Data.TaggedError("proton-mail-mcp/PolicyDenied")<{
  readonly message: string
}> {}

/** RFC822 parsing failure (postal-mime). */
export class MailParseError extends Data.TaggedError("proton-mail-mcp/MailParseError")<{
  readonly message: string
}> {}

export type MailError =
  | BridgeUnavailableError
  | ImapError
  | MessageNotFoundError
  | PolicyDeniedError
  | MailParseError
