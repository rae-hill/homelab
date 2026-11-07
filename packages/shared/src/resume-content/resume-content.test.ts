import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { ABOUT_ME_DEFAULT, BLURB_DEFAULT, INITIAL_CONTENT_STATE } from "./constants.js"
import { ContentState } from "./schema.js"
import type { ExperienceContent, ProjectContent } from "./types.js"

describe("resume-content", () => {
  describe("roundtrip", () => {
    it("roundtrips INITIAL_CONTENT_STATE through encode/decode", () => {
      const encoded = Schema.encodeSync(ContentState)(INITIAL_CONTENT_STATE)
      const decoded = Schema.decodeSync(ContentState)(encoded)
      expect(decoded).toEqual(INITIAL_CONTENT_STATE)
    })
  })

  describe("old-blob compatibility", () => {
    it("decodes a blob without blurb/aboutMe and materializes defaults", () => {
      // Simulate an old persisted blob that lacks blurb and aboutMe fields
      const oldBlob = {
        experience: [
          {
            id: "test",
            company: "Test Co",
            location: "Remote",
            roles: [{ title: "Engineer", date: "2020-2021" }],
            description: "Did stuff",
            bulletPoints: [{ id: "b1", text: "Bullet", visible: true }],
            tags: ["TypeScript"],
          },
        ],
        projects: [
          {
            id: "proj1",
            title: "Project",
            description: "A project",
            githubLink: "https://github.com/test",
            tags: ["React"],
          },
        ],
        skills: ["Skill1"],
      } as unknown

      const decoded = Schema.decodeUnknownSync(ContentState)(oldBlob)
      expect(decoded.blurb).toBe(BLURB_DEFAULT)
      expect(decoded.aboutMe).toBe(ABOUT_ME_DEFAULT)
      expect(decoded.experience).toHaveLength(1)
      expect(decoded.projects).toHaveLength(1)
      expect(decoded.skills).toEqual(["Skill1"])
    })
  })

  describe("defaults snapshot", () => {
    it("has the expected structure and default values", () => {
      expect(INITIAL_CONTENT_STATE.experience).toHaveLength(5)
      expect(INITIAL_CONTENT_STATE.projects).toHaveLength(4)
      expect(INITIAL_CONTENT_STATE.skills).toEqual(["Foo", "Bar"])
      expect(INITIAL_CONTENT_STATE.blurb).toBe(BLURB_DEFAULT)
      expect(INITIAL_CONTENT_STATE.aboutMe).toBe(ABOUT_ME_DEFAULT)
    })

    it("experience entries have the expected IDs", () => {
      const ids = INITIAL_CONTENT_STATE.experience.map((e: ExperienceContent) => e.id)
      expect(ids).toEqual([
        "nutrien",
        "shutterfly",
        "simspace",
        "electronic-caregiver",
        "indica-labs",
      ])
    })

    it("project entries have the expected IDs", () => {
      const ids = INITIAL_CONTENT_STATE.projects.map((p: ProjectContent) => p.id)
      expect(ids).toEqual([
        "nixos-homelab",
        "schemata-ts",
        "bifold-traverse",
        "matrix-ts",
      ])
    })
  })
})
