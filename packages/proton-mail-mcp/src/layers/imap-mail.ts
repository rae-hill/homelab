import { Effect, Layer, Option } from "effect"
import { AuthenticationFailure, ImapFlow } from "imapflow"
import type { FetchMessageObject, SearchObject } from "imapflow"
import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import PostalMime from "postal-mime"
import { Env, type EnvDef } from "../env.js"
import {
  BridgeUnavailableError,
  ImapError,
  type MailError,
  MailParseError,
  MessageNotFoundError,
  PolicyDeniedError,
} from "../errors.js"
import { compact } from "../schemas.js"
import type {
  AttachmentMeta,
  FolderInfo,
  ImapMailServiceDef,
  LabelInfo,
  MessageDetail,
  MessageSummary,
  SearchCriteria,
} from "../services/mail.js"
import { ImapMailService } from "../services/mail.js"
import type { PolicyServiceDef } from "../services/policy.js"
import { PolicyService } from "../services/policy.js"

const LABELS_PREFIX = "Labels/"
/** Folders that are projections (Labels/*) or aggregates (All Mail) — never a message's home. */
const isHomeCandidate = (path: string): boolean => !path.startsWith(LABELS_PREFIX) && path !== "All Mail"

const describeCause = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const BRIDGE_HINT = "Proton Mail Bridge is not reachable — is it running and unlocked?"

const isConnectionFailure = (cause: unknown): boolean => {
  if (cause instanceof AuthenticationFailure) return false
  const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause)
  return /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|socket hang up|Connection closed|alert number/i.test(
    text,
  )
}

const toImapFailure = (cause: unknown, context: string): MailError =>
  isConnectionFailure(cause)
    ? new BridgeUnavailableError({ message: `${context}: ${BRIDGE_HINT} (${describeCause(cause)})` })
    : new ImapError({ message: `${context}: ${describeCause(cause)}` })

/** Promise → Effect with domain error mapping. */
const tryP = <A>(context: string, f: () => Promise<A>): Effect.Effect<A, MailError> =>
  Effect.tryPromise({ try: f, catch: (cause) => toImapFailure(cause, context) })

const normalizeDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  return undefined
}

const toAddress = (
  address: { name?: string | null | undefined; address?: string | undefined } | undefined | null,
): { name: string | null; address: string } | undefined =>
  address !== undefined && address !== null && typeof address.address === "string" && address.address.length > 0
    ? { name: address.name ?? null, address: address.address }
    : undefined

const toAddresses = (
  addresses: ReadonlyArray<{ name?: string | null | undefined; address?: string | undefined }> | undefined,
): ReadonlyArray<{ name: string | null; address: string }> =>
  (addresses ?? []).flatMap((entry) => {
    const mapped = toAddress(entry)
    return mapped === undefined ? [] : [mapped]
  })

const truncateUtf8 = (
  value: string | undefined,
  maxBytes: number,
): { value: string | undefined; truncated: boolean } => {
  if (value === undefined || value.length === 0) return { value: undefined, truncated: false }
  const buffer = Buffer.from(value, "utf8")
  if (buffer.byteLength <= maxBytes) return { value, truncated: false }
  // NOTE: byte slicing can split a trailing multi-byte character — acceptable for triage text.
  return { value: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true }
}

const contentByteLength = (content: string | ArrayBuffer | Uint8Array | undefined): number | undefined => {
  if (content === undefined) return undefined
  if (typeof content === "string") return Buffer.byteLength(content, "utf8")
  return content.byteLength
}

class ImapMailServiceImpl implements ImapMailServiceDef {
  constructor(
    private readonly env: EnvDef,
    private readonly policy: PolicyServiceDef,
    private readonly caPem: string | undefined,
  ) {}

  private connect(): Effect.Effect<ImapFlow, MailError> {
    const env = this.env
    const caPem = this.caPem
    return Effect.tryPromise({
      try: async () => {
        const client = new ImapFlow({
          host: env.bridgeHost,
          port: env.bridgePort,
          // secure=false → ImapFlow opportunistically upgrades via STARTTLS (Bridge default).
          secure: env.bridgeTlsMode === "implicit",
          // Loopback-only unless a CA file pins the Bridge self-signed cert (guarded in Env).
          tls: caPem !== undefined ? { ca: [caPem] } : { rejectUnauthorized: false },
          auth: { user: env.bridgeUsername, pass: env.bridgePassword },
          logger: false,
        })
        await client.connect()
        return client
      },
      catch: (cause) =>
        cause instanceof AuthenticationFailure
          ? new ImapError({
            message: `Bridge authentication failed — check the mailbox password in Bridge settings (${
              describeCause(cause)
            })`,
          })
          : isConnectionFailure(cause)
          ? new BridgeUnavailableError({
            message: `connect ${env.bridgeHost}:${env.bridgePort}: ${BRIDGE_HINT} (${describeCause(cause)})`,
          })
          : new ImapError({ message: `connect failed: ${describeCause(cause)}` }),
    })
  }

  /** One connection per operation: Bridge tolerates it, and it keeps locking trivial. */
  private withClient<A>(use: (client: ImapFlow) => Effect.Effect<A, MailError>): Effect.Effect<A, MailError> {
    return Effect.acquireUseRelease(
      this.connect(),
      use,
      (client) => Effect.tryPromise(() => client.logout()).pipe(Effect.ignore),
    )
  }

  /**
   * Serialise mailbox-scoped commands under a lock (imapflow 2.x locks expose only
   * {path, release} — mailbox counters come from STATUS, not the lock object).
   */
  private withLock<A>(
    client: ImapFlow,
    path: string,
    use: () => Effect.Effect<A, MailError>,
  ): Effect.Effect<A, MailError> {
    return Effect.acquireUseRelease(
      tryP(`open mailbox "${path}"`, () => client.getMailboxLock(path)),
      () => use(),
      (lock) => Effect.sync(() => lock.release()),
    )
  }

  private toSummary(message: FetchMessageObject, folder: string): MessageSummary {
    const flags = message.flags ?? new Set<string>()
    return compact<MessageSummary>({
      folder,
      uid: message.uid,
      date: normalizeDate(message.envelope?.date),
      subject: message.envelope?.subject ?? undefined,
      from: toAddress(message.envelope?.from?.[0]),
      seen: flags.has("\\Seen"),
      flagged: flags.has("\\Flagged"),
      size: message.size ?? undefined,
    })
  }

  private assertLabelAllowed(label: string): Effect.Effect<string, PolicyDeniedError> {
    if (!this.policy.labelEnabled) {
      return Effect.fail(
        new PolicyDeniedError({
          message: `the "label" operation is disabled (PROTON_MCP_OPERATIONS=${[...this.env.operations].join(",")})`,
        }),
      )
    }
    if (!this.policy.isLabelAllowed(label)) {
      return Effect.fail(
        new PolicyDeniedError({
          message: `label "${label}" is not whitelisted (allowed: ${this.policy.allowedLabels.join(", ")})`,
        }),
      )
    }
    return Effect.succeed(`${LABELS_PREFIX}${label}`)
  }

  listFolders(): Effect.Effect<ReadonlyArray<FolderInfo>, MailError> {
    return this.withClient((client) =>
      tryP("list folders", () => client.list()).pipe(
        Effect.map((boxes) =>
          boxes.map((box) =>
            compact<FolderInfo>({
              path: box.path,
              specialUse: typeof box.specialUse === "string" ? box.specialUse : undefined,
            })
          )
        ),
      )
    )
  }

  listMessages: ImapMailServiceDef["listMessages"] = (args) => {
    const env = this.env
    const toSummary = this.toSummary.bind(this)
    return this.withClient((client) =>
      this.withLock(client, args.folder, () =>
        Effect.gen(function*() {
          const status = yield* tryP(`status "${args.folder}"`, () => client.status(args.folder, { messages: true }))
          const total = status !== false && status.messages !== undefined ? status.messages : 0
          const size = Math.min(Math.max(1, Math.floor(args.pageSize)), env.maxListMessages)
          const page = Math.max(1, Math.floor(args.page))
          const end = total - (page - 1) * size
          if (end < 1) return { messages: [], total }
          const start = Math.max(1, end - size + 1)
          const fetched = yield* tryP(
            `fetch ${start}:${end} in "${args.folder}"`,
            () => client.fetchAll(`${start}:${end}`, { uid: true, envelope: true, flags: true, size: true }),
          )
          // Newest first: fetchAll returns ascending sequence order.
          return { messages: [...fetched].reverse().map((message) => toSummary(message, args.folder)), total }
        }))
    )
  }

  getMessage: ImapMailServiceDef["getMessage"] = (args) => {
    const maxBodyBytes = this.env.maxBodyBytes
    return this.withClient((client) =>
      this.withLock(client, args.folder, () =>
        Effect.gen(function*() {
          const fetched = yield* tryP(`fetch uid ${args.uid} in "${args.folder}"`, () =>
            client.fetchOne(
              args.uid,
              {
                uid: true,
                envelope: true,
                flags: true,
                size: true,
                ...(args.includeBody ? { source: true } : {}),
              },
              { uid: true },
            ))
          if (!fetched) {
            return yield* Effect.fail(
              new MessageNotFoundError({ message: `no message uid=${args.uid} in "${args.folder}"` }),
            )
          }
          const flags = fetched.flags ?? new Set<string>()
          const base = compact<MessageDetail>({
            folder: args.folder,
            uid: fetched.uid,
            date: normalizeDate(fetched.envelope?.date),
            subject: fetched.envelope?.subject ?? undefined,
            from: toAddress(fetched.envelope?.from?.[0]),
            to: toAddresses(fetched.envelope?.to),
            cc: toAddresses(fetched.envelope?.cc),
            messageId: fetched.envelope?.messageId ?? undefined,
            gluonId: undefined,
            seen: flags.has("\\Seen"),
            flagged: flags.has("\\Flagged"),
            size: fetched.size ?? undefined,
            text: undefined,
            html: undefined,
            truncated: false,
            attachments: [],
          })
          if (!args.includeBody || fetched.source === undefined) return base

          const source = fetched.source
          const parsed = yield* Effect.tryPromise({
            try: () => PostalMime.parse(source),
            catch: (cause) => new MailParseError({ message: `parse uid=${args.uid}: ${describeCause(cause)}` }),
          })

          const text = truncateUtf8(parsed.text ?? undefined, maxBodyBytes)
          const html = truncateUtf8(parsed.html ?? undefined, maxBodyBytes)
          const gluonHeader = parsed.headers.find((header) => header.key.toLowerCase() === "x-pm-gluon-id")

          return compact<MessageDetail>({
            ...base,
            date: parsed.date ?? base.date,
            subject: parsed.subject ?? base.subject,
            from: toAddress(parsed.from) ?? base.from,
            to: parsed.to !== undefined ? toAddresses(parsed.to) : base.to,
            cc: parsed.cc !== undefined ? toAddresses(parsed.cc) : base.cc,
            messageId: parsed.messageId ?? base.messageId,
            gluonId: gluonHeader?.value,
            text: text.value,
            html: html.value,
            truncated: text.truncated || html.truncated,
            attachments: (parsed.attachments ?? []).map((attachment) =>
              compact<AttachmentMeta>({
                filename: attachment.filename ?? null,
                mimeType: attachment.mimeType ?? null,
                size: contentByteLength(attachment.content),
              })
            ),
          })
        }))
    )
  }

  searchMessages: ImapMailServiceDef["searchMessages"] = (args) => {
    const env = this.env
    const toSummary = this.toSummary.bind(this)
    return this.withClient((client) =>
      this.withLock(client, args.folder, () =>
        Effect.gen(function*() {
          const search: SearchObject = {}
          const criteria: SearchCriteria = args.criteria
          if (criteria.subject !== undefined) search.subject = criteria.subject
          if (criteria.text !== undefined) search.text = criteria.text
          if (criteria.from !== undefined) search.from = criteria.from
          if (criteria.since !== undefined) search.since = new Date(criteria.since)
          if (criteria.unseen === true) search.seen = false
          const uids = yield* tryP(`search in "${args.folder}"`, () => client.search(search, { uid: true }))
          if (!Array.isArray(uids)) {
            return yield* Effect.fail(new ImapError({ message: `server refused SEARCH in "${args.folder}"` }))
          }
          const limit = Math.min(Math.max(1, args.limit), env.maxListMessages)
          const limited = uids.slice(-limit)
          if (limited.length === 0) return []
          const fetched = yield* tryP(
            "fetch search hits",
            () => client.fetchAll(limited, { uid: true, envelope: true, flags: true, size: true }, { uid: true }),
          )
          return [...fetched].reverse().map((message) => toSummary(message, args.folder))
        }))
    )
  }

  getUnreadCount: ImapMailServiceDef["getUnreadCount"] = (folder) =>
    this.withClient((client) =>
      tryP(`status "${folder}"`, () => client.status(folder, { unseen: true })).pipe(
        Effect.map((status) => (status !== false && status.unseen !== undefined ? status.unseen : 0)),
      )
    )

  listLabels(): Effect.Effect<ReadonlyArray<LabelInfo>, MailError> {
    return this.withClient((client) =>
      tryP("list folders", () => client.list()).pipe(
        Effect.map((boxes) =>
          boxes
            .filter((box) => box.path.startsWith(LABELS_PREFIX) && box.path.length > LABELS_PREFIX.length)
            .map((box) => ({
              name: box.path.slice(LABELS_PREFIX.length),
              path: box.path,
              existsOnServer: true,
            }))
        ),
      )
    )
  }

  addLabel: ImapMailServiceDef["addLabel"] = (args) => {
    const assertLabelAllowed = this.assertLabelAllowed.bind(this)
    return this.withClient((client) =>
      Effect.gen(function*() {
        const labelPath = yield* assertLabelAllowed(args.label)
        const boxes = yield* tryP("list folders", () => client.list())
        if (!boxes.some((box) => box.path === labelPath)) {
          yield* tryP(`create label folder "${labelPath}"`, () => client.mailboxCreate(labelPath))
        }
        return yield* Effect.acquireUseRelease(
          tryP(`open mailbox "${args.folder}"`, () => client.getMailboxLock(args.folder)),
          () =>
            Effect.gen(function*() {
              const exists = yield* tryP(
                `fetch uid ${args.uid}`,
                () => client.fetchOne(args.uid, { uid: true }, { uid: true }),
              )
              if (!exists) {
                return yield* Effect.fail(
                  new MessageNotFoundError({ message: `no message uid=${args.uid} in "${args.folder}"` }),
                )
              }
              // COPY = idempotent label apply; the message stays in its folder (Bridge label
              // folders are virtual projections with multi-membership).
              const copied = yield* tryP(
                `copy uid ${args.uid} to "${labelPath}"`,
                () => client.messageCopy(args.uid, labelPath, { uid: true }),
              )
              if (copied === false) {
                return yield* Effect.fail(
                  new ImapError({ message: `server refused COPY uid=${args.uid} → "${labelPath}"` }),
                )
              }
              return { label: args.label, folderPath: labelPath }
            }),
          (lock) => Effect.sync(() => lock.release()),
        )
      })
    )
  }

  removeLabel: ImapMailServiceDef["removeLabel"] = (args) => {
    const assertLabelAllowed = this.assertLabelAllowed.bind(this)
    return this.withClient((client) =>
      Effect.gen(function*() {
        const labelPath = yield* assertLabelAllowed(args.label)
        const boxes = yield* tryP("list folders", () => client.list())
        if (!boxes.some((box) => box.path === labelPath)) {
          return yield* Effect.fail(
            new ImapError({ message: `label folder "${labelPath}" does not exist on the server` }),
          )
        }

        // 1. Read the stable cross-folder identity from the label-folder projection.
        const gluonId = yield* Effect.acquireUseRelease(
          tryP(`open mailbox "${labelPath}"`, () => client.getMailboxLock(labelPath)),
          () =>
            Effect.gen(function*() {
              const fetched = yield* tryP(
                `fetch uid ${args.uid} headers`,
                () => client.fetchOne(args.uid, { uid: true, headers: ["x-pm-gluon-id"] }, { uid: true }),
              )
              if (!fetched) {
                return yield* Effect.fail(
                  new MessageNotFoundError({ message: `no message uid=${args.uid} in "${labelPath}"` }),
                )
              }
              const headers = fetched.headers
              if (headers === undefined) return undefined
              const match = /x-pm-gluon-id:\s*(\S+)/i.exec(headers.toString("utf8"))
              return match?.[1]
            }),
          (lock) => Effect.sync(() => lock.release()),
        )
        if (gluonId === undefined) {
          return yield* Effect.fail(
            new ImapError({
              message:
                `cannot resolve the home folder of uid=${args.uid} in "${labelPath}" (no X-Pm-Gluon-Id header) — ` +
                "refusing to move; remove the label in Proton Mail instead",
            }),
          )
        }

        // 2. Find the ONE real folder that also contains this message identity.
        const candidates = boxes.map((box) => box.path).filter((path) => path !== labelPath && isHomeCandidate(path))
        let home: string | undefined
        for (const candidate of candidates) {
          const hits = yield* Effect.acquireUseRelease(
            tryP(`open mailbox "${candidate}"`, () => client.getMailboxLock(candidate)),
            () =>
              tryP(`search identity in "${candidate}"`, () =>
                client.search({ header: { "x-pm-gluon-id": gluonId } }, { uid: true })),
            (lock) =>
              Effect.sync(() => lock.release()),
          )
          if (Array.isArray(hits) && hits.length > 0) {
            if (home !== undefined) {
              return yield* Effect.fail(
                new ImapError({
                  message: `message identity found in multiple home folders (${home}, ${candidate}) — ` +
                    "refusing to guess a move destination; remove the label in Proton Mail instead",
                }),
              )
            }
            home = candidate
          }
        }
        if (home === undefined) {
          return yield* Effect.fail(
            new ImapError({
              message: `no home folder found for uid=${args.uid} of "${labelPath}" — refusing to move; ` +
                "remove the label in Proton Mail instead",
            }),
          )
        }

        // 3. MOVE the label projection into its home folder (= label removal in Bridge semantics).
        const target = home
        return yield* Effect.acquireUseRelease(
          tryP(`open mailbox "${labelPath}"`, () => client.getMailboxLock(labelPath)),
          () =>
            Effect.gen(function*() {
              const moved = yield* tryP(`move uid ${args.uid} to "${target}"`, () =>
                client.messageMove(args.uid, target, { uid: true }))
              if (moved === false) {
                return yield* Effect.fail(
                  new ImapError({ message: `server refused MOVE uid=${args.uid} → "${target}"` }),
                )
              }
              return { label: args.label, movedTo: target }
            }),
          (lock) => Effect.sync(() => lock.release()),
        )
      })
    )
  }

  setFlags: ImapMailServiceDef["setFlags"] = (args) =>
    this.withClient((client) =>
      this.withLock(client, args.folder, () =>
        Effect.gen(function*() {
          const exists = yield* tryP(`fetch uid ${args.uid}`, () =>
            client.fetchOne(args.uid, { uid: true }, { uid: true }))
          if (!exists) {
            return yield* Effect.fail(
              new MessageNotFoundError({ message: `no message uid=${args.uid} in "${args.folder}"` }),
            )
          }
          if (args.seen !== undefined) {
            yield* tryP(`set \\Seen=${args.seen} uid ${args.uid}`, () =>
              args.seen === true
                ? client.messageFlagsAdd(args.uid, ["\\Seen"], { uid: true })
                : client.messageFlagsRemove(args.uid, ["\\Seen"], { uid: true })).pipe(Effect.asVoid)
          }
          if (args.flagged !== undefined) {
            yield* tryP(`set \\Flagged=${args.flagged} uid ${args.uid}`, () =>
              args.flagged === true
                ? client.messageFlagsAdd(args.uid, ["\\Flagged"], { uid: true })
                : client.messageFlagsRemove(args.uid, ["\\Flagged"], { uid: true })).pipe(Effect.asVoid)
          }
        }))
    )
}

export const ImapMailServiceLive = Layer.effect(
  ImapMailService,
  Effect.gen(function*() {
    const env = yield* Env
    const policy = yield* PolicyService
    const caFile = env.bridgeTlsCaFile
    const caPem = Option.isSome(caFile)
      ? yield* Effect.try({
        try: () => readFileSync(caFile.value, "utf8"),
        catch: (cause) =>
          new ImapError({
            message: `cannot read PROTON_BRIDGE_TLS_CA_FILE "${caFile.value}": ${describeCause(cause)}`,
          }),
      })
      : undefined
    return new ImapMailServiceImpl(env, policy, caPem)
  }),
)
