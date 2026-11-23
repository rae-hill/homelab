---
name: creating-libs
description: Stand up a new publishable library under lib/; questions on npm publishing (@rae-hill/*), semantic-release/multi-semantic-release releases with OIDC Trusted Publishing + provenance, TypeDoc/RsPress docs, or RsLib ESM builds for libs.
---

# Creating a New Publishable Library (`lib/*`)

Scaffold a new publishable ESM-only library under `lib/` from the canonical template at `lib/scratch`. See `docs/npm-lib-publishing-plan.md` for design rationale.

## Overview

| Aspect   | Detail                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Location | `lib/<name>` → publishes to npm as `@rae-hill/<name>`                                                                            |
| Build    | **RsLib** bundleless ESM + `.d.ts` into `dist/` (publint + arethetypeswrong on every build)                                      |
| Types    | Solution tsconfig pattern: `tsconfig.json` (references src + test)                                                               |
| Tests    | **Vitest** (merges `../../vitest.shared.js`)                                                                                     |
| Linting  | Root `eslint.config.mjs`; ignores `dist`, `doc_build`, `docs`, `yarn/**`                                                         |
| Docs     | **TypeDoc** → committed markdown in `docs/v<major>.<minor>/`; **RsPress v2** → gitignored HTML in `doc_build/`                   |
| Releases | **multi-semantic-release** per lib → `yarn npm publish` via **OIDC Trusted Publishing** + **provenance** (no NPM_TOKEN anywhere) |
| Version  | Starts `0.1.0`; thereon owned entirely by semantic-release                                                                       |

`packages/*` = private apps (never published). `lib/*` = publishable libs.

## Step-by-step Scaffold Recipe

For `<name>`, create these files under `lib/<name>/`:

### Files (with key content changes)

```
lib/<name>/
├── src/index.ts                    # TSDoc @packageDocumentation header + functions
├── test/<name>.test.ts             # vitest tests
├── package.json                    # name @rae-hill/<name>; version 0.1.0; description changed; export paths unchanged
├── rslib.config.ts                 # COPY VERBATIM from lib/scratch (TODO about generate-exports stays)
├── typedoc.json                    # COPY VERBATIM (entryPoints: ["src/index.ts"])
├── rspress.config.ts               # title: "@rae-hill/<name>" (rest verbatim)
├── tsconfig.json                   # solution file; references tsconfig.src.json + tsconfig.test.json
├── tsconfig.src.json               # COPY VERBATIM (extends ../../tsconfig.base.json; include src)
├── tsconfig.test.json              # COPY VERBATIM (includes src + test; types node)
├── tsconfig.rslib.json             # COPY VERBATIM — the dts source project for RsLib (declarationDir dist);
│                                   #   tsconfig.json is the solution file (include: []) and would emit nothing
├── eslint.config.mjs               # COPY VERBATIM (two-liner re-exporting the root eslint.config.mjs)
├── vitest.config.ts                # COPY VERBATIM (mergeConfig(shared))
├── release.config.js               # one-liner re-export of root release config (verbatim)
├── README.md                       # title + examples updated for <name>
└── LICENSE                         # COPY VERBATIM from lib/scratch/LICENSE (MIT rae-hill)
```

**File-specific notes:**

- **package.json**: Change `name` to `@rae-hill/<name>`, update `version` to `0.1.0`, write a one-line `description`, update `repository.directory` to `lib/<name>`, change `repository.url` to `git+https://github.com/rae-hill/homelab.git`. All other fields (exports, publishConfig.exports, devDependencies, scripts) copy verbatim.
- **src/index.ts**: Start with JSDoc `@packageDocumentation` block. Each exported function gets full TSDoc: `@param`, `@returns`, `@example` with `import { ... } from "@rae-hill/<name>"`.
- **test/<name>.test.ts**: Import from `../src/<name>.js` (extension required in ESM). Group tests by describe block per exported function.
- **release.config.js**: Copy verbatim — it's just `export { default } from "../../release.config.js"`.
- **README.md**: Update title, usage import example, development commands referencing `@rae-hill/<name>`.
- **LICENSE**: Copy verbatim from `lib/scratch/LICENSE`. No modification.

**⚠ VERSION WARNING:** Starter version is `0.1.0`. After merging the scaffold, NEVER hand-edit `version` again — semantic-release owns versions exclusively. Never hand-tag except the initial baseline bootstrap tag below.

## Hard Rules

| Rule                                      | Rationale                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **ESM-only**                              | `"type": "module"`, `.js` extensions in imports                                                      |
| **`workspace:^` for lib→lib deps**        | Yarn links locally, rewrites to `^<version>` at pack time; plain semver flips to registry resolution |
| **Never depend on `packages/*`**          | Private app territory; must not pull in apps                                                         |
| **`publishConfig.provenance: true`**      | Sigstore provenance on `yarn npm publish`                                                            |
| **`repository.url` exact match**          | Provenance verification rejects mismatched URLs (`git+https://github.com/rae-hill/homelab.git`)      |
| **`repository.directory` = `lib/<name>`** | Provenance requires matching directory                                                               |
| **`files: ["dist"]`**                     | Berry includes README/LICENSE automatically                                                          |
| **`yarn npm publish` only**               | Applies publishConfig.swap + workspace rewrite; `npm publish` does neither                           |

## Registration

**None needed.** Root workspaces glob `lib/*`, release workflow gates use the root scripts
`typecheck:libs`/`lint:libs`/`test:libs` (`yarn workspaces foreach --include '@rae-hill/*'`), and
MSR discovers non-private workspaces automatically. Do NOT add to root `tsconfig.build.json` —
libs typecheck via their own solution tsconfigs through repo-wide `yarn typecheck`.

## Docs Workflow

| Command          | Effect                                      | Output                              | Git status    |
| ---------------- | ------------------------------------------- | ----------------------------------- | ------------- |
| `yarn docs`      | TypeDoc via `scripts/typedoc-versioned.mjs` | Markdown → `docs/v<major>.<minor>/` | **COMMITTED** |
| `yarn docs:dev`  | RsPress live-reload server                  | HTML → `doc_build/`                 | gitignored    |
| `yarn docs:site` | RsPress static build                        | HTML → `doc_build/`                 | gitignored    |

`typedoc-versioned.mjs` reads `package.json` version for output folder. RsPress `multiVersion` scans `docs/` at config time — new minor folders auto-appear in the dropdown without config churn. `_meta.json` per version controls sidebars. HTML is never committed.

**Pre-commit hook** (`libRefresh` in `lint-staged.config.js`) runs build + docs and stages docs when staged files touch `lib/<name>/{src,test,**}` or `{package.json,typedoc.json,rslib.config.ts,rspress.config.ts,vitest.config.ts}`. Human commits rely on this. **Agents with `--no-verify` MUST manually run both steps and `git add lib/<name>/docs` before committing.**

## Release Mechanics

| Conventional commit | Bump at 0.x                                   | Bump at ≥1.x |
| ------------------- | --------------------------------------------- | ------------ |
| `fix:`, `perf:`     | patch                                         | patch        |
| `feat:`             | minor                                         | minor        |
| `BREAKING CHANGE:`  | **1.0.0** (semrel refuses 0.x breaking→minor) | major        |
| Non-conventional    | No release                                    | No release   |

Per-lib artifacts: CHANGELOG.md, GitHub Release, release commit pushed back to `main`, tag
`@rae-hill/<name>@<version>` (MSR default `${name}@${version}` — no `v`; confirm in the dry-run
log). Workflow triggers on push to `main` touching `lib/**`, `release.config.js`,
`typedoc-versioned.mjs`, `release.yml`, or `.github/actions/setup/action.yml`. Gates:
`yarn typecheck:libs` → `lint:libs` → `test:libs` → `yarn release`.

### First-Release Bootstrap

1. Scaffold with version `0.1.0`; merge to main.
2. Tag the scaffold commit `@rae-hill/<name>@0.0.0` and push. This baseline ensures first `feat:` → `0.1.0` (not `1.0.0`).
3. Make `feat(<name>): initial library` commit → CI computes `0.1.0` and publishes via OIDC.

**Trusted Publishing scope level** (npmjs.com → `@rae-hill` scope → Settings → Trusted Publisher → `rae-hill/homelab/release.yml`). Covers all future libs. If unavailable during bootstrap, add per-package entries individually after each package exists. Must succeed within **2 days** of TP config creation or it expires.

## Validation Checklist

Run from repo root **inside the devshell**:

```sh
yarn install
yarn typecheck:libs && yarn lint:libs && yarn test:libs   # or the per-workspace equivalents
yarn workspace @rae-hill/<name> build           # dist/ created; publint + arethetypeswrong pass?
yarn workspace @rae-hill/<name> docs            # check docs/v0.1/*.md exists
# Inspect the exact publish artifact (manifest swap + file list):
(cd lib/<name> && yarn pack --out /tmp/<name>.tgz && tar -xzOf /tmp/<name>.tgz package/package.json)
#   → exports must show dist paths; files ["dist"]; README/LICENSE present
yarn release --dry-run                          # only this lib listed; private packages skipped
```

After `yarn.lock` changes: update the two `fetchYarnBerryDeps` hashes per the `nix-hashes` skill.

## Gotchas

- **npm age gate** (5-day): Blocks installing versions published < 5 days ago. Pin older patches if blocked.
- **RsLib `generate-exports`** needs @rslib/core ≥ 1.1.0 stable. Hand-written blocks remain. Once available, uncomment `exports: { source: true }` and DELETE handwritten exports/publishConfig.exports.
- **Never `npm publish`**: Doesn't apply publishConfig.swap or workspace rewrite. Always `yarn npm publish`.
- **Semantic-release owns versions**: Never hand-edit `version` or create tags (except bootstrap `@v0.0.0`).
- **Provenance needs public repo**: Private repos make provenance impossible.
- **Lockfile stability**: Version bumps don't dirty `yarn.lock` (Berry lockfiles don't record workspace versions).
- **Local dry-run caveats**: `yarn npm publish --dry-run` FAILS locally whenever
  `publishConfig.provenance` is set (berry 4.14 refuses provenance outside GHA/GitLab CI, and
  `--no-provenance` does not override `publishConfig`). Use `yarn pack` + tarball inspection for
  local validation. `yarn release --dry-run` on a detached HEAD or non-`main` branch exits early
  with "triggered on the branch undefined"/"behind the remote" — expected; CI checkouts are on
  main and pass these checks.
- **attw ESM-only carve-out**: `ignoreResolutions: ["node10", "node16-cjs"]` in rslib.config.ts is
  deliberate (ESM-only packages legitimately fail those modes); genuine node16-esm/bundler
  failures still fail the build. Do not widen the ignore list casually.
- **Devshell specifics**: `corepack` is provided by the flake devshell (stripped-shims wrapper) —
  rsbuild-plugin-arethetypeswrong spawns `corepack yarn pack` and fails without it. Bare shells
  have no node/yarn at all; always work inside `nix develop`.
