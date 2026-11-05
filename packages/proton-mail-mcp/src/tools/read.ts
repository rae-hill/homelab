import { Effect, Schema } from "effect"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import {
  FolderInfoSchema,
  MessageDetailSchema,
  MessageSummarySchema,
  Optional,
  OptionalWithDefault,
} from "../schemas.js"
import { ImapMailService } from "../services/mail.js"
import { PolicyService } from "../services/policy.js"
import { MailToolFailure, toFailure } from "./failure.js"

// `dependencies` declares the request-level services handlers may require; they are
// discharged by the services middleware in server.ts (see McpTest.test.ts pattern).

export const MailListFolders = Tool.make("mail_list_folders", {
  description: "List the mail folders exposed by the local Proton Mail Bridge (INBOX, Archive, Sent, Spam, " +
    "Trash, All Mail, Folders/*, Labels/*). Use it to discover valid `folder` arguments for the " +
    "other mail tools. Requires Proton Mail Bridge running on this machine.",
  success: Schema.Struct({ folders: Schema.Array(FolderInfoSchema) }),
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const MailListMessages = Tool.make("mail_list_messages", {
  description: "List messages in a folder, newest first, with envelope metadata (no bodies). Page through " +
    "with `page` (1-based); `pageSize` is capped by server policy.",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    page: OptionalWithDefault(Schema.Number, () => 1),
    pageSize: OptionalWithDefault(Schema.Number, () => 25),
  }),
  success: Schema.Struct({
    messages: Schema.Array(MessageSummarySchema),
    total: Schema.Number,
    page: Schema.Number,
    pageSize: Schema.Number,
  }),
  failure: MailToolFailure,
  dependencies: [ImapMailService, PolicyService],
})

export const MailGetMessage = Tool.make("mail_get_message", {
  description: "Fetch one message by folder + uid. Returns headers and (unless includeBody=false) the " +
    "text/html body truncated to the server's byte cap, plus attachment METADATA only " +
    "(attachment content is never exposed).",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    uid: Schema.Number,
    includeBody: OptionalWithDefault(Schema.Boolean, () => true),
  }),
  success: MessageDetailSchema,
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const MailSearchMessages = Tool.make("mail_search_messages", {
  description: "Search a folder (IMAP SEARCH via Bridge's local cache): any combination of subject/text " +
    "(full-text)/from/since (yyyy-mm-dd)/unseen. Returns the newest `limit` matches, newest " +
    "first, envelope metadata only.",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    subject: Optional(Schema.String),
    text: Optional(Schema.String),
    from: Optional(Schema.String),
    since: Optional(Schema.String),
    unseen: Optional(Schema.Boolean),
    limit: OptionalWithDefault(Schema.Number, () => 20),
  }),
  success: Schema.Struct({ messages: Schema.Array(MessageSummarySchema) }),
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const MailGetUnreadCount = Tool.make("mail_get_unread_count", {
  description: "Unread message count for a folder (IMAP STATUS).",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
  }),
  success: Schema.Struct({ folder: Schema.String, unread: Schema.Number }),
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const readToolkit = Toolkit.make(
  MailListFolders,
  MailListMessages,
  MailGetMessage,
  MailSearchMessages,
  MailGetUnreadCount,
)

export const readHandlers = readToolkit.toLayer({
  mail_list_folders: () =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      const folders = yield* mail.listFolders().pipe(Effect.mapError(toFailure))
      return { folders }
    }),
  mail_list_messages: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      const policy = yield* PolicyService
      const pageSize = Math.min(Math.max(1, Math.floor(params.pageSize)), policy.maxListMessages)
      const page = Math.max(1, Math.floor(params.page))
      const result = yield* mail
        .listMessages({ folder: params.folder, page, pageSize })
        .pipe(Effect.mapError(toFailure))
      return { messages: result.messages, total: result.total, page, pageSize }
    }),
  mail_get_message: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      return yield* mail
        .getMessage({ folder: params.folder, uid: Math.floor(params.uid), includeBody: params.includeBody })
        .pipe(Effect.mapError(toFailure))
    }),
  mail_search_messages: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      const messages = yield* mail
        .searchMessages({
          folder: params.folder,
          criteria: {
            subject: params.subject,
            text: params.text,
            from: params.from,
            since: params.since,
            unseen: params.unseen,
          },
          limit: Math.max(1, Math.floor(params.limit)),
        })
        .pipe(Effect.mapError(toFailure))
      return { messages }
    }),
  mail_get_unread_count: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      const unread = yield* mail.getUnreadCount(params.folder).pipe(Effect.mapError(toFailure))
      return { folder: params.folder, unread }
    }),
})
