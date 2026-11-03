import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { XMLParser } from "fast-xml-parser"
import { Schemas, Services } from "homelab-services"
import { Layers } from "../src/index.js"

const DefaultConfig = Layer.succeed(Services.XmlPrintingAppleMdmConfig.AppleMdmXmlPrintingConfig, {
  encoding: "UTF-8",
  newline: "\n",
  indent: "  ",
})

const TestLayer = Layers.XmlPrintingAppleMdm.AppleMdmXmlPrintingLive.pipe(Layer.provide(DefaultConfig))

describe("AppleMdmXmlPrintingService", () => {
  describe("printXml", () => {
    it.effect("should encode string values", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ name: "test" })

        expect(result).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
        expect(result).toContain("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\"")
        expect(result).toContain("<plist version=\"1.0\">")
        expect(result).toContain("<string>test</string>")
        expect(result).toContain("</plist>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode integer values", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ count: 42 })

        expect(result).toContain("<integer>42</integer>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode boolean true", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ enabled: true })

        expect(result).toContain("<true/>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode boolean false", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ enabled: false })

        expect(result).toContain("<false/>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should escape special characters in strings", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ text: "<tag attr=\"value\">&test" })

        expect(result).toContain("&lt;tag attr=&quot;value&quot;&gt;&amp;test")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode nested objects", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({
          user: {
            name: "John",
            age: 30,
          },
        })

        expect(result).toContain("<dict>")
        expect(result).toContain("<key>name</key>")
        expect(result).toContain("<string>John</string>")
        expect(result).toContain("<key>age</key>")
        expect(result).toContain("<integer>30</integer>")
        expect(result).toContain("</dict>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode arrays", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({
          items: ["apple", "banana", "cherry"],
        })

        expect(result).toContain("<array>")
        expect(result).toContain("<string>apple</string>")
        expect(result).toContain("<string>banana</string>")
        expect(result).toContain("<string>cherry</string>")
        expect(result).toContain("</array>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode arrays with only one <array> tag for multiple items", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({
          items: [1, 2, 3],
        })

        const arrayTagCount = (result.match(/<array>/g) || []).length
        expect(arrayTagCount).toBe(1)
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode objects with only one <dict> tag for multiple keys", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({
          obj: { a: "123", b: "456", c: "789" },
        })

        const outerDictMatches = result.match(
          /<dict>[\s\S]*?<key>obj<\/key>[\s\S]*?<dict>([\s\S]*?)<\/dict>[\s\S]*?<\/dict>/g,
        )
        expect(outerDictMatches).toBeTruthy()

        if (outerDictMatches) {
          const innerContent = outerDictMatches[0]
          const innerDictCount = (innerContent.match(/<dict>/g) || []).length
          expect(innerDictCount).toBe(2)
        }
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode Buffer as base64 data", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const buffer = Buffer.from("Hello, World!")
        const result = yield* service.printXml({ payload: buffer })

        expect(result).toContain("<data>")
        expect(result).toContain("SGVsbG8sIFdvcmxkIQ==")
        expect(result).toContain("</data>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should encode complex nested structures", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({
          config: {
            enabled: true,
            servers: ["server1", "server2"],
            timeout: 30,
          },
        })

        expect(result).toContain("<dict>")
        expect(result).toContain("<key>enabled</key>")
        expect(result).toContain("<true/>")
        expect(result).toContain("<key>servers</key>")
        expect(result).toContain("<array>")
        expect(result).toContain("<string>server1</string>")
        expect(result).toContain("<key>timeout</key>")
        expect(result).toContain("<integer>30</integer>")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should fail on null values", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* Effect.flip(service.printXml({ value: null }))

        expect(result).toBeInstanceOf(Services.XmlPrintingService.XmlPrintingError)
        expect(result.error).toBe("Null values are not allowed")
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should fail on NaN values", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* Effect.flip(service.printXml({ value: NaN }))

        expect(result).toBeInstanceOf(Services.XmlPrintingService.XmlPrintingError)
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should fail on unsafe integers", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* Effect.flip(service.printXml({ value: Number.MAX_SAFE_INTEGER + 1 }))

        expect(result).toBeInstanceOf(Services.XmlPrintingService.XmlPrintingError)
      }).pipe(Effect.provide(TestLayer)))

    it.effect("should respect custom encoding configuration", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ test: "value" })

        expect(result).toContain("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>")
      }).pipe(
        Effect.provide(
          Layers.XmlPrintingAppleMdm.AppleMdmXmlPrintingLive.pipe(
            Layer.provide(
              Layer.succeed(Services.XmlPrintingAppleMdmConfig.AppleMdmXmlPrintingConfig, {
                encoding: "ISO-8859-1",
                newline: "\n",
                indent: "  ",
              }),
            ),
          ),
        ),
      ))

    it.effect("should respect custom indent configuration", () =>
      Effect.gen(function*() {
        const service = yield* Services.XmlPrintingService.XmlPrintingService
        const result = yield* service.printXml({ obj: { key: "value" } })

        expect(result).toContain("    <key>key</key>")
      }).pipe(
        Effect.provide(
          Layers.XmlPrintingAppleMdm.AppleMdmXmlPrintingLive.pipe(
            Layer.provide(
              Layer.succeed(Services.XmlPrintingAppleMdmConfig.AppleMdmXmlPrintingConfig, {
                encoding: "UTF-8",
                newline: "\n",
                indent: "    ",
              }),
            ),
          ),
        ),
      ))

    it.effect.prop(
      "should generate valid XML for any RootPayload schema instance",
      [Schemas.RootPayload.RootPayloadSchema],
      ([payload]) =>
        Effect.gen(function*() {
          const service = yield* Services.XmlPrintingService.XmlPrintingService
          const xmlParser = new XMLParser()
          const xmlPayload = yield* service.printXml(payload as Record<string, Schemas.JSONExt.JSONExt>)
          yield* Effect.try(() => xmlParser.parse(xmlPayload))
          return true
        }).pipe(Effect.provide(TestLayer)),
    )
  })
})
