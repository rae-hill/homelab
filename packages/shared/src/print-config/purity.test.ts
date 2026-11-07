import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { PersistedPrintConfig } from "./schema.js"
import type { PersistedConfig } from "./types.js"

describe("print-config purity", () => {
  it("PersistedPrintConfig cannot contain tailor-related fields", () => {
    // Create a complete fixture config
    const fixtureConfig: PersistedConfig = {
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

    // Encode the config to JSON
    const encoded = Schema.encodeSync(PersistedPrintConfig)(fixtureConfig)
    const jsonString = JSON.stringify(encoded)

    // Assert that tailor-related fields are NOT present in the encoded output
    const tailorFields = ["fit", "tips", "verdict", "listingText", "jobTitle", "contentPatch"]
    for (const field of tailorFields) {
      expect(jsonString).not.toContain(`"${field}"`)
    }
  })
})
