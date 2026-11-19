/**
 * Style exemplars for the cover-letter generation prompt (CL-D3).
 *
 * v1 seed: the owner's SailPoint letter (~/git/cover-letters/sailpoint/cover-letters-2026-sailpoint.typ,
 * body only — the letterloom scaffolding is owned by the Typst template, not the model).
 *
 * ADDING EXAMPLES: append a `{ name, text }` entry and bump `version` in
 * makeCoverLetterPromptConfigService (prompt-cache invalidation + eval tracking).
 * Keep the array capped (≤4) — each exemplar is ~500 prompt tokens (README OQ7).
 */
export interface CoverLetterExemplar {
  readonly name: string
  readonly text: string
}

export const COVER_LETTER_EXEMPLARS: ReadonlyArray<CoverLetterExemplar> = [
  {
    name: "sailpoint-2026",
    text: `Hello! My name is Rae, and I am interested in one of the many opportunities available at SailPoint. In particular, the Senior DevOps Engineering position stood out to me; though if there's a better fit in another role, I'd be open to applying to that one instead. I’ve spent much of my career split about 60/40 between full-stack and DevOps responsibilities. Recently, my interests have leaned more toward DevOps, so I would be grateful to be considered for this role.

I am fascinated by the correctness, in a cryptographic sense, of authentication and authorization systems. I have long been interested in contributing to an identity platform, especially now that AI agents and chatbots require equal, if not greater, access to a user’s resources and to act on behalf of a user’s identity. When I came across the DevOps listing for SailPoint, I jumped at the opportunity. I am curious about SailPoint’s approach to identity in this age of AI; it is a challenging problem to solve and requires a lot of knowledge and skill to implement correctly. It’s been a joy to implement authentication systems both in my personal and professional life, and I am familiar with the great many challenges that go into designing such a system.

Managing an enterprise PaaS is very meaningful to me; the work feels important, especially when SLAs must be met, and uptime is essential. DevOps is critical for these platforms, and a good DevOps engineer is familiar with managing deployment processes and methodologies to eliminate downtime and implement graceful recovery. Mistakes happen, but it’s a satisfying challenge in its own right to design a system that’s resilient to developer mistakes and can maintain the standards that highlight the difference between your platform and your competitors. At the same time, you need a system that future engineers can reliably maintain, which is why I generally prefer keeping things simple and getting things done.`,
  },
]
