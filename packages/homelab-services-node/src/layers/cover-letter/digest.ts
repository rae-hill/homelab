import type { ResumeContent } from "shared"

/**
 * Compact resume digest for the generation prompt (doc 01 §B).
 *
 * The FULL ContentState JSON is too noisy for letter writing (ids, github links, hidden
 * bullets); the digest keeps everything a cover letter legitimately grounds on:
 * blurb, aboutMe, and per-entry employer/roles/description/VISIBLE bullets/tags, projects,
 * skills. Pure function — unit-tested.
 */
export const buildContentDigest = (content: ResumeContent.ContentState): string =>
  JSON.stringify(
    {
      blurb: content.blurb,
      aboutMe: content.aboutMe,
      experience: content.experience.map((entry) => ({
        company: entry.company,
        location: entry.location,
        roles: entry.roles.map((role) => ({ title: role.title, date: role.date })),
        description: entry.description,
        bulletPoints: entry.bulletPoints.filter((bullet) => bullet.visible).map((bullet) => bullet.text),
        tags: entry.tags,
      })),
      projects: content.projects.map((project) => ({
        title: project.title,
        description: project.description,
        tags: project.tags,
      })),
      skills: content.skills,
    },
    null,
    2,
  )
