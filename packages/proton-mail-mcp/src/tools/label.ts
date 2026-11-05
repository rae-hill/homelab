import { Effect, Schema } from "effect"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import { LabelInfoSchema, OptionalWithDefault } from "../schemas.js"
import { ImapMailService } from "../services/mail.js"
import { PolicyService } from "../services/policy.js"
import { MailToolFailure, toFailure } from "./failure.js"

// Label tools are registered but HIDDEN (McpServer visibility gate in server.ts) unless the
// "label" operation is enabled; handlers AND the IMAP layer additionally enforce the whitelist.

export const MailListLabels = Tool.make("mail_list_labels", {
  description: "List the Proton Mail labels this server is ALLOWED to manage (configured whitelist), and " +
    "whether each already exists on the account. Use before mail_add_label/mail_remove_label.",
  success: Schema.Struct({ labels: Schema.Array(LabelInfoSchema) }),
  failure: MailToolFailure,
  dependencies: [ImapMailService, PolicyService],
})

export const MailAddLabel = Tool.make("mail_add_label", {
  description: "Apply a whitelisted label to a message (idempotent — the message stays in its folder). " +
    "Only labels listed by mail_list_labels are permitted; anything else is policy_denied.",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    uid: Schema.Number,
    label: Schema.String,
  }),
  success: Schema.Struct({ label: Schema.String, folderPath: Schema.String }),
  failure: MailToolFailure,
  dependencies: [ImapMailService, PolicyService],
})

export const MailRemoveLabel = Tool.make("mail_remove_label", {
  description: "Remove a whitelisted label from a message: the message is moved out of the label folder " +
    "back into its resolved home folder. Refuses (imap_error) when the home folder cannot be " +
    "resolved unambiguously — the message is then left untouched.",
  parameters: Schema.Struct({
    label: Schema.String,
    uid: Schema.Number,
  }),
  success: Schema.Struct({ label: Schema.String, movedTo: Schema.String }),
  failure: MailToolFailure,
  dependencies: [ImapMailService, PolicyService],
})

export const MailSetRead = Tool.make("mail_set_read", {
  description: "Mark a message read or unread (\\Seen flag).",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    uid: Schema.Number,
    read: Schema.Boolean,
  }),
  success: Schema.Struct({ uid: Schema.Number, seen: Schema.Boolean }),
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const MailSetStarred = Tool.make("mail_set_starred", {
  description: "Star or unstar a message (\\Flagged flag).",
  parameters: Schema.Struct({
    folder: OptionalWithDefault(Schema.String, () => "INBOX"),
    uid: Schema.Number,
    starred: Schema.Boolean,
  }),
  success: Schema.Struct({ uid: Schema.Number, flagged: Schema.Boolean }),
  failure: MailToolFailure,
  dependencies: [ImapMailService],
})

export const labelToolkit = Toolkit.make(
  MailListLabels,
  MailAddLabel,
  MailRemoveLabel,
  MailSetRead,
  MailSetStarred,
)

export const labelHandlers = labelToolkit.toLayer({
  mail_list_labels: () =>
    Effect.gen(function*() {
      const policy = yield* PolicyService
      const mail = yield* ImapMailService
      const existing = yield* mail.listLabels().pipe(Effect.mapError(toFailure))
      return {
        labels: policy.allowedLabels.map((name) => ({
          name,
          path: `Labels/${name}`,
          existsOnServer: existing.some((label) => label.name === name),
        })),
      }
    }),
  mail_add_label: (params) =>
    Effect.gen(function*() {
      const policy = yield* PolicyService
      if (!policy.isLabelAllowed(params.label)) {
        return yield* Effect.fail(
          new MailToolFailure({
            kind: "policy_denied",
            message: `label "${params.label}" is not whitelisted (allowed: ${policy.allowedLabels.join(", ")})`,
          }),
        )
      }
      const mail = yield* ImapMailService
      return yield* mail
        .addLabel({ folder: params.folder, uid: Math.floor(params.uid), label: params.label })
        .pipe(Effect.mapError(toFailure))
    }),
  mail_remove_label: (params) =>
    Effect.gen(function*() {
      const policy = yield* PolicyService
      if (!policy.isLabelAllowed(params.label)) {
        return yield* Effect.fail(
          new MailToolFailure({
            kind: "policy_denied",
            message: `label "${params.label}" is not whitelisted (allowed: ${policy.allowedLabels.join(", ")})`,
          }),
        )
      }
      const mail = yield* ImapMailService
      return yield* mail.removeLabel({ label: params.label, uid: Math.floor(params.uid) }).pipe(
        Effect.mapError(toFailure),
      )
    }),
  mail_set_read: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      yield* mail
        .setFlags({ folder: params.folder, uid: Math.floor(params.uid), seen: params.read })
        .pipe(Effect.mapError(toFailure))
      return { uid: Math.floor(params.uid), seen: params.read }
    }),
  mail_set_starred: (params) =>
    Effect.gen(function*() {
      const mail = yield* ImapMailService
      yield* mail
        .setFlags({ folder: params.folder, uid: Math.floor(params.uid), flagged: params.starred })
        .pipe(Effect.mapError(toFailure))
      return { uid: Math.floor(params.uid), flagged: params.starred }
    }),
})
