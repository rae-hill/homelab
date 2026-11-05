import { Context, Effect } from "effect"
import type { MailError } from "../errors.js"
import type {
  AttachmentMetaSchema,
  FolderInfoSchema,
  LabelInfoSchema,
  MessageDetailSchema,
  MessageSummarySchema,
} from "../schemas.js"

export type FolderInfo = typeof FolderInfoSchema.Type
export type MessageSummary = typeof MessageSummarySchema.Type
export type MessageDetail = typeof MessageDetailSchema.Type
export type LabelInfo = typeof LabelInfoSchema.Type
export type AttachmentMeta = typeof AttachmentMetaSchema.Type

export interface SearchCriteria {
  readonly subject?: string | undefined
  /** IMAP TEXT search (body + headers), served by Bridge against its local cache. */
  readonly text?: string | undefined
  readonly from?: string | undefined
  /** ISO date (yyyy-mm-dd) — messages since this date. */
  readonly since?: string | undefined
  readonly unseen?: boolean | undefined
}

/**
 * Mail operations against the local Proton Mail Bridge (IMAP). Definition only —
 * implementation in ../layers/imap-mail.ts (ImapFlow), following the homelab-services
 * (definitions) / homelab-services-node (implementations) split, self-contained.
 */
export interface ImapMailServiceDef {
  /** All folders Bridge exposes (INBOX, Archive, ..., Folders/*, Labels/*). */
  readonly listFolders: () => Effect.Effect<ReadonlyArray<FolderInfo>, MailError>

  /**
   * Page through a folder, newest first. `pageSize` is clamped to the env cap by callers.
   * Paging is sequence-range based over the mailbox snapshot at call time.
   */
  readonly listMessages: (args: {
    readonly folder: string
    readonly page: number
    readonly pageSize: number
  }) => Effect.Effect<
    { readonly messages: ReadonlyArray<MessageSummary>; readonly total: number },
    MailError
  >

  /** Full message; body parsed (postal-mime) and truncated per env when `includeBody`. */
  readonly getMessage: (args: {
    readonly folder: string
    readonly uid: number
    readonly includeBody: boolean
  }) => Effect.Effect<MessageDetail, MailError>

  /** IMAP SEARCH in a folder; returns the newest `limit` hits, newest first. */
  readonly searchMessages: (args: {
    readonly folder: string
    readonly criteria: SearchCriteria
    readonly limit: number
  }) => Effect.Effect<ReadonlyArray<MessageSummary>, MailError>

  /** Unread count via IMAP STATUS (no mailbox selection needed). */
  readonly getUnreadCount: (folder: string) => Effect.Effect<number, MailError>

  /** Existing `Labels/*` folders as label infos (whitelist intersection happens in tools). */
  readonly listLabels: () => Effect.Effect<ReadonlyArray<LabelInfo>, MailError>

  /** Apply a label = COPY the message into `Labels/<label>` (idempotent; message stays put). */
  readonly addLabel: (args: {
    readonly folder: string
    readonly uid: number
    readonly label: string
  }) => Effect.Effect<{ readonly label: string; readonly folderPath: string }, MailError>

  /**
   * Remove a label = MOVE the message out of `Labels/<label>` back into its resolved home
   * folder. Home resolution uses the Bridge-injected `X-Pm-Gluon-Id` header searched across
   * real folders; if it cannot be resolved UNIQUELY the call FAILS (conservative refusal —
   * never guess a destination folder).
   */
  readonly removeLabel: (args: {
    readonly label: string
    readonly uid: number
  }) => Effect.Effect<{ readonly label: string; readonly movedTo: string }, MailError>

  /** Set/clear \Seen and/or \Flagged on a message. */
  readonly setFlags: (args: {
    readonly folder: string
    readonly uid: number
    readonly seen?: boolean | undefined
    readonly flagged?: boolean | undefined
  }) => Effect.Effect<void, MailError>
}

export class ImapMailService extends Context.Service<ImapMailService, ImapMailServiceDef>()(
  "proton-mail-mcp/services/ImapMailService",
) {}
