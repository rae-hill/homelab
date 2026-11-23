#!/usr/bin/env node
/**
 * Generates TypeDoc markdown for a publishable lib into a minor-versioned docs
 * folder, e.g. `docs/v0.1/`, based on the lib's current package.json version.
 *
 * Run from the lib directory (its package.json wires it as the `docs` script):
 *
 *   node ../../scripts/typedoc-versioned.mjs
 *
 * Base options (entry points, markdown plugin, etc.) come from the lib's
 * typedoc.json; this script merges in a computed `outputs` path and runs
 * typedoc against the merged temp config, because typedoc 0.28 only accepts
 * `outputs` from a config file (not the CLI). Committed docs stay organized
 * per minor release; prior minor folders are left untouched as history, and
 * the RsPress site config picks versions up by scanning docs/.
 *
 * Generated output is dprint-formatted before exit: raw TypeDoc markdown
 * violates the repo's dprint.json, agent commits skip the formatting hook
 * (--no-verify is the house rule), and lint-staged's repo-wide `fmt .` would
 * otherwise keep resurfacing the unformatted docs as unstaged drift. The
 * format pass soft-fails (warning only) where dprint is unavailable (e.g. the
 * release CI runner); `nix build .#checks.x86_64-linux.formatting` is the
 * authoritative gate.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const libDir = process.cwd()

let pkg
try {
  pkg = JSON.parse(readFileSync(join(libDir, "package.json"), "utf8"))
} catch (error) {
  console.error(`[typedoc-versioned] no readable package.json in ${libDir}:`, error.message)
  process.exit(1)
}

let baseConfig
try {
  baseConfig = JSON.parse(readFileSync(join(libDir, "typedoc.json"), "utf8"))
} catch (error) {
  console.error(`[typedoc-versioned] no readable typedoc.json in ${libDir}:`, error.message)
  process.exit(1)
}

const [major, minor] = String(pkg.version ?? "0.0.0").split(".")
const outDir = join("docs", `v${major}.${minor}`)

// Temp config lives beside typedoc.json so its relative paths (entryPoints,
// tsconfig, output dir) resolve identically.
const tmpConfig = join(libDir, ".typedoc-versioned.json")
writeFileSync(
  tmpConfig,
  JSON.stringify(
    { ...baseConfig, outputs: [{ name: "markdown", path: outDir }] },
    null,
    2,
  ),
)

try {
  const result = spawnSync("typedoc", ["--options", ".typedoc-versioned.json"], {
    stdio: "inherit",
    cwd: libDir,
    env: process.env,
    shell: process.platform === "win32",
  })

  if (result.error) {
    console.error(
      `[typedoc-versioned] failed to launch typedoc (is it installed? run via \`yarn workspace ${pkg.name} docs\`):`,
      result.error.message,
    )
    process.exit(1)
  }

  process.exitCode = result.status ?? 1

  // Format the generated markdown to the repo's dprint standard (see the
  // header note). Runs from the repo root so dprint auto-discovers dprint.json.
  if (process.exitCode === 0) {
    const repoRoot = resolve(libDir, "..", "..")
    const outRel = relative(repoRoot, resolve(libDir, outDir))
    const fmt = spawnSync("dprint", ["fmt", "--", outRel], {
      stdio: "inherit",
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
    })
    if (fmt.error?.code === "ENOENT") {
      console.warn(
        `[typedoc-versioned] dprint not on PATH; generated docs left UNFORMATTED — run \`fmt ${outRel}\` in the devshell before committing.`,
      )
    } else if (fmt.error || fmt.status !== 0) {
      const reason = fmt.error ? fmt.error.message : `exit code ${fmt.status}`
      console.warn(`[typedoc-versioned] dprint fmt failed (${reason}); generated docs may be unformatted.`)
    }
  }
} finally {
  rmSync(tmpConfig, { force: true })
}
