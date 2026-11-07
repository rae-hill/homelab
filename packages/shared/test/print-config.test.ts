import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import {
  ConfigBase64String,
  decodePersistedBase64,
  decodePersistedJson,
  encodePersistedBase64,
  encodePersistedJson,
  type PersistedConfig,
} from "../src/print-config/index.js"

/** A minimal-but-complete valid persisted config, reused across the codec tests. */
export const fixtureConfig: PersistedConfig = {
  toggles: {
    skills: true,
    experience: true,
    projects: true,
    positionDescription: true,
    positionResponsibilities: true,
    tagCloud: true,
    positionTags: true,
    projectTags: true,
    certification: true,
    education: true,
    address: true,
    phone: true,
    email: true,
    websiteLink: true,
    githubLink: true,
    linkedinLink: true,
  },
  featuredMode: "Inline",
  sections: {
    experience: {
      layout: { kind: "Stacked", order: "TagsBelow" },
      descriptionTextAlign: "left",
      responsibilitiesTextAlign: "left",
      descriptionAlign: { vertical: "center", horizontal: "start" },
      tagAlign: { vertical: "center", horizontal: "center" },
      gap: 3,
      tagDisplay: "Tags",
    },
    projects: {
      layout: { kind: "SideBySide", order: "DescriptionFirst", ratio: 2 },
      descriptionTextAlign: "center",
      responsibilitiesTextAlign: "right",
      descriptionAlign: { vertical: "start", horizontal: "end" },
      tagAlign: { vertical: "space-between", horizontal: "space-around" },
      gap: 1,
      tagDisplay: "List",
    },
  },
  heading: {
    iconTextSize: "md",
    gap: 3,
    contactGap: 2,
    skillListGap: 1,
    nameAlign: { vertical: "center", horizontal: "center" },
    contactAlign: { vertical: "center", horizontal: "center" },
    description: { kind: "Blurb", textAlign: "center" },
  },
  content: {
    blurb: "A professional summary",
    aboutMe: "About me text",
    experience: [
      {
        id: "acme",
        company: "Acme Corp",
        location: "Denver, CO",
        roles: [{ title: "Software Engineer", date: "2020 – 2024" }],
        description: "Built things.",
        bulletPoints: [{ id: "acme__b0", text: "Shipped features", visible: true }],
        tags: ["TypeScript", "Effect"],
      },
    ],
    projects: [
      {
        id: "proj",
        title: "A Project",
        description: "Does things",
        githubLink: "https://github.com/acme/proj",
        tags: ["Vite"],
      },
    ],
    skills: ["TypeScript", "Effect", "Nix"],
  },
}

describe("print-config codecs", () => {
  it("round-trips a config through base64", () => {
    const base64 = encodePersistedBase64(fixtureConfig)
    const decoded = decodePersistedBase64(base64)
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(fixtureConfig)
    }
  })

  it("round-trips a config through JSON", () => {
    const json = encodePersistedJson(fixtureConfig)
    const decoded = decodePersistedJson(json)
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(fixtureConfig)
    }
  })

  it("the base64 blob decodes to the JSON blob's value", () => {
    const base64 = encodePersistedBase64(fixtureConfig)
    expect(Buffer.from(base64, "base64").toString("utf-8"))
      .toBe(encodePersistedJson(fixtureConfig))
  })

  it("fails on a non-base64 string", () => {
    expect(Result.isFailure(decodePersistedBase64("not base64 !!!"))).toBe(true)
  })

  it("fails on base64 of JSON that does not match the schema", () => {
    const blob = Buffer.from(JSON.stringify({ toggles: "nope" }), "utf-8").toString("base64")
    expect(Result.isFailure(decodePersistedBase64(blob))).toBe(true)
  })
})

describe("ConfigBase64String", () => {
  const decode = Schema.decodeUnknownResult(ConfigBase64String)

  it("accepts (and preserves) a valid base64 config blob", () => {
    const base64 = encodePersistedBase64(fixtureConfig)
    const result = decode(base64)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toBe(base64)
    }
  })

  it("rejects garbage", () => {
    expect(Result.isFailure(decode("%%not-base64%%"))).toBe(true)
  })

  it("rejects base64 of a non-conforming JSON payload", () => {
    const blob = Buffer.from(JSON.stringify({ hello: "world" }), "utf-8").toString("base64")
    expect(Result.isFailure(decode(blob))).toBe(true)
  })
})
