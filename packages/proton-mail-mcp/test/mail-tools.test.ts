import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import * as McpProtocol from "effect/ai/McpProtocol"
import * as McpTest from "effect/ai/McpTest"
import type { EnvDef } from "../src/env.js"
import { makeRegistrations } from "../src/server.js"
import type { ImapMailServiceDef } from "../src/services/mail.js"
import { policyFromEnv } from "../src/services/policy.js"

const makeEnv = (overrides: Partial<EnvDef> = {}): EnvDef => ({
  bridgeHost: "127.0.0.1",
  bridgePort: 1143,
  bridgeUsername: "me@proton.me",
  bridgePassword: "pw",
  bridgeTlsMode: "starttls",
  bridgeTlsCaFile: Option.none(),
  operations: new Set(["read"]),
  allowedLabels: [],
  maxBodyBytes: 20_000,
  maxListMessages: 25,
  ...overrides,
})

const labelEnv = makeEnv({
  operations: new Set(["read", "label"]),
  allowedLabels: ["Receipts"],
})

const INBOX_SUMMARY = {
  folder: "INBOX",
  uid: 7,
  date: "2026-11-01T00:00:00.000Z",
  subject: "hello",
  from: { name: null, address: "a@b.c" },
  seen: false,
  flagged: false,
  size: 1234,
}

const DETAIL = {
  ...INBOX_SUMMARY,
  to: [],
  cc: [],
  text: "body text",
  truncated: false,
  attachments: [],
}

interface StubCalls {
  listMessagesPageSize: number[]
  addLabel: string[]
}

const makeStub = (calls: StubCalls): ImapMailServiceDef => ({
  listFolders: () => Effect.succeed([{ path: "INBOX" }, { path: "Labels/Receipts" }]),
  listMessages: ({ pageSize }) => {
    calls.listMessagesPageSize.push(pageSize)
    return Effect.succeed({ messages: [INBOX_SUMMARY], total: 1 })
  },
  getMessage: () => Effect.succeed(DETAIL),
  searchMessages: () => Effect.succeed([]),
  getUnreadCount: () => Effect.succeed(3),
  listLabels: () => Effect.succeed([{ name: "Receipts", path: "Labels/Receipts", existsOnServer: true }]),
  addLabel: ({ label }) => {
    calls.addLabel.push(label)
    return Effect.succeed({ label, folderPath: `Labels/${label}` })
  },
  removeLabel: ({ label }) => Effect.succeed({ label, movedTo: "INBOX" }),
  setFlags: () => Effect.void,
})

const newCalls = (): StubCalls => ({ listMessagesPageSize: [], addLabel: [] })

const makeClient = (env: EnvDef, stub: ImapMailServiceDef) =>
  McpTest.makeClient(makeRegistrations(stub, policyFromEnv(env)), {
    protocols: [McpProtocol.v2025_11_25],
  })

/** The tool's text content is already JSON — extract it raw (avoid double-stringify escaping). */
const contentJson = (result: { content: unknown }): string =>
  (result.content as ReadonlyArray<{ type: string; text?: string | undefined }>)
    .map((part) => part.text ?? "")
    .join("")

describe("tool visibility policy", () => {
  it.effect("hides label tools when operations=read", () =>
    Effect.gen(function*() {
      const client = yield* makeClient(makeEnv(), makeStub(newCalls()))
      const tools = yield* client.listTools()
      assert.deepStrictEqual(
        tools.tools.map((tool) => tool.name).sort(),
        [
          "mail_get_message",
          "mail_get_unread_count",
          "mail_list_folders",
          "mail_list_messages",
          "mail_search_messages",
        ],
      )
    }))

  it.effect("shows label tools when operations=read,label", () =>
    Effect.gen(function*() {
      const client = yield* makeClient(labelEnv, makeStub(newCalls()))
      const tools = yield* client.listTools()
      const names = tools.tools.map((tool) => tool.name).sort()
      assert.strictEqual(names.length, 10)
      assert.isTrue(names.includes("mail_add_label"))
      assert.isTrue(names.includes("mail_remove_label"))
    }))
})

describe("read tools", () => {
  it.effect("lists folders through the MCP session", () =>
    Effect.gen(function*() {
      const client = yield* makeClient(makeEnv(), makeStub(newCalls()))
      const result = yield* client.callTool({ name: "mail_list_folders" })
      const json = contentJson(result)
      assert.include(json, "INBOX")
      assert.include(json, "Labels/Receipts")
    }))

  it.effect("clamps pageSize to the policy maximum", () =>
    Effect.gen(function*() {
      const calls = newCalls()
      const client = yield* makeClient(makeEnv(), makeStub(calls))
      yield* client.callTool({
        name: "mail_list_messages",
        arguments: { folder: "INBOX", page: 1, pageSize: 500 },
      })
      assert.deepStrictEqual(calls.listMessagesPageSize, [25])
    }))

  it.effect("returns unread counts", () =>
    Effect.gen(function*() {
      const client = yield* makeClient(makeEnv(), makeStub(newCalls()))
      const result = yield* client.callTool({ name: "mail_get_unread_count", arguments: {} })
      assert.include(contentJson(result), "\"unread\":3")
    }))
})

describe("label policy enforcement", () => {
  it.effect("applies a whitelisted label", () =>
    Effect.gen(function*() {
      const calls = newCalls()
      const client = yield* makeClient(labelEnv, makeStub(calls))
      const result = yield* client.callTool({
        name: "mail_add_label",
        arguments: { folder: "INBOX", uid: 7, label: "Receipts" },
      })
      assert.notStrictEqual(result.isError, true)
      assert.include(contentJson(result), "Labels/Receipts")
      assert.deepStrictEqual(calls.addLabel, ["Receipts"])
    }))

  it.effect("denies a non-whitelisted label without touching the service", () =>
    Effect.gen(function*() {
      const calls = newCalls()
      const client = yield* makeClient(labelEnv, makeStub(calls))
      const result = yield* client.callTool({
        name: "mail_add_label",
        arguments: { folder: "INBOX", uid: 7, label: "Everything" },
      })
      assert.strictEqual(result.isError, true)
      assert.include(contentJson(result), "policy_denied")
      assert.deepStrictEqual(calls.addLabel, [])
    }))

  it.effect("lists only whitelisted labels with server-existence flags", () =>
    Effect.gen(function*() {
      const client = yield* makeClient(labelEnv, makeStub(newCalls()))
      const result = yield* client.callTool({ name: "mail_list_labels" })
      const json = contentJson(result)
      assert.include(json, "\"name\":\"Receipts\"")
      assert.include(json, "\"existsOnServer\":true")
    }))
})
