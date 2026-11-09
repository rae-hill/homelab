/**
 * Leaf module for the default content strings — intentionally import-free.
 *
 * Both `schema.ts` (needs these as `OptionalWithDefault` defaults) and `constants.ts`
 * (needs these for `INITIAL_CONTENT_STATE`) consume them; keeping the strings in their
 * own leaf module avoids a `schema.ts → constants.ts → types.ts → schema.ts` import
 * cycle (madge `yarn circular` gate). `constants.ts` re-exports them so the module
 * barrel surface (`ResumeContent.BLURB_DEFAULT`, …) is unchanged.
 */

/** Personal summary paragraph shown in the heading when the description mode is `Blurb`.
 * Lifted from `packages/resume/src/components/resume/sections/heading.tsx` `BLURB` const. */
export const BLURB_DEFAULT =
  "Agentic developer, multilingual full-stack engineer, DevOps architect, and mathematician " +
  "seeking a software engineering or DevOps role. Experienced in applying AI to solve " +
  "complex problems and improve user workflows. Proficient in TypeScript, Python, frontend " +
  "frameworks, systems design, and backend microservice architecture. Skilled at building secure, " +
  "distributed, scalable, observable systems with strong performance characteristics."

/** The About Me section paragraph. Lifted from
 * `packages/resume/src/components/resume/sections/about-me.tsx` `Text` content. */
export const ABOUT_ME_DEFAULT =
  "Multilingual full-stack engineer and mathematician seeking a software engineering role with an " +
  "emphasis in frontend or backend development. Dedicated to the craft of principled engineering and " +
  "systematized approaches to AI workflow integration. Experienced in TypeScript, Python, frontend " +
  "frameworks, systems design, and backend microservice architecture. Skilled at building secure, " +
  "distributed, scalable, observable systems with strong performance characteristics."
