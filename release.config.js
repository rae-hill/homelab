/**
 * Shared semantic-release configuration for all publishable libraries.
 *
 * Executed per-project by @anolilab/multi-semantic-release (`yarn release`):
 * one semantic-release run per non-private workspace under lib/*, with cwd set
 * to the package directory and commit analysis scoped to commits touching that
 * package's path. Tags are per-package (MSR default `${name}@${version}`, e.g.
 * `@rae-hill/scratch@0.1.0` — confirmed via dry-run at bootstrap).
 *
 * Publishing does NOT go through @semantic-release/npm's publish step — the
 * npm plugin only bumps package.json (npmPublish: false). The actual publish
 * is `yarn npm publish` via @semantic-release/exec, because yarn berry:
 *   - applies publishConfig.exports overrides to the packed manifest
 *     (npm does not — its publishConfig only carries registry-side config),
 *   - rewrites `workspace:` protocol deps to real semver ranges,
 *   - does OIDC trusted publishing + sigstore provenance natively
 *     (GITHUB_ACTIONS + id-token: write; no npm token exists anywhere).
 *
 * See docs/npm-lib-publishing-plan.md for the source-verified rationale.
 */
export default {
  branches: ["main"],
  plugins: [
    // feat: → minor, fix:/perf: → patch, BREAKING CHANGE → major (0.x: → 1.0.0).
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    // Per-library CHANGELOG.md.
    "@semantic-release/changelog",
    // Version bump in package.json only (prepare step); publish is the exec below.
    ["@semantic-release/npm", { npmPublish: false }],
    [
      "@semantic-release/exec",
      {
        // prepare runs AFTER the version bump: rebuild dist/ (RsLib, incl.
        // publint + arethetypeswrong) and regenerate the minor-versioned
        // TypeDoc markdown so the release commit carries matching docs.
        prepareCmd: "yarn build && yarn docs",
        // OIDC trusted publishing; provenance via publishConfig.provenance
        // (the flag is belt-and-braces). --tolerate-republish keeps reruns
        // idempotent. `yarn npm publish` has no --registry flag: the registry
        // comes from config/env, so pin npmjs.org via YARN_NPM_REGISTRY_SERVER
        // (berry defaults to the registry.yarnpkg.com alias — same backend, but
        // the OIDC audience and trusted-publisher config are npmjs.org-native).
        publishCmd:
          "YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org/ yarn npm publish --access public --provenance --tolerate-republish",
      },
    ],
    // Commit bump + changelog + regenerated docs back to main. GITHUB_TOKEN
    // pushes never re-trigger workflows, so this cannot recurse.
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "CHANGELOG.md", "docs"],
      },
    ],
    // GitHub Release with generated notes + issue/PR comments.
    "@semantic-release/github",
  ],
}
