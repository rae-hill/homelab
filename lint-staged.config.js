export default {
  "*": (files) => {
    const cmds = ["fmt ."]
    // e2e guardrail: run the bundled-server e2e suite whenever staged changes
    // can affect the server bundle (catches bundle-only bugs unit tests miss,
    // e.g. the rolldown ws `mask` crash). When changes are confined to the e2e
    // workspace, run only the touched test files (paths pass through as vitest
    // filters). `e2e` is the devshell command (wraps scripts/e2e.sh) — commits
    // happen inside the devshell anyway, since yarn is only accessible there.
    const serverSidePkgs = ["homelab-server", "homelab-services", "homelab-services-node", "homelab-api", "shared"]
    const touchesServer = files.some(
      (f) => serverSidePkgs.some((p) => f.includes(`/packages/${p}/`)) || f.endsWith("/yarn.lock"),
    )
    const e2eFiles = files.filter((f) => f.includes("/packages/homelab-e2e-tests/"))
    if (touchesServer) {
      cmds.push("e2e")
    } else if (e2eFiles.length > 0) {
      cmds.push(`e2e ${e2eFiles.map((f) => `'${f}'`).join(" ")}`)
    }
    return cmds
  },
  "*.{ts,tsx,js,jsx,mjs}": [
    "eslint --fix",
    "yarn test:staged",
  ],
  "*.{ts,tsx}": [
    () => "yarn lint",
    () => "yarn typecheck",
  ],
  // Exclude vendored submodules under repos/ — those are read-only upstream sources
  // and must never be reformatted by nixfmt (mirrors dprint.json's `repos/*` exclude).
  // Invoke nixfmt via `nix run .#nixfmt` so the hook uses the SAME pinned nixfmt as
  // the devshell and the nixvim editor config, and does not depend on PATH (git
  // hooks run in a minimal shell that may not inherit the devshell environment).
  // `nix flake check --no-build` deliberately lives in .husky/pre-push instead of
  // here: pre-commit tasks run inside lint-staged's stash/restore window, so
  // evaluating the flake there ingests transient worktree states into the Nix
  // store (see docs/nix-store-poisoning/README.md).
  "*.nix": (files) => {
    const own = files.filter((f) => !f.includes("/repos/") && !f.startsWith("repos/"))
    const cmds = []
    if (own.length > 0) {
      cmds.push(`nix run .#nixfmt -- ${own.map((f) => `'${f}'`).join(" ")}`)
    }
    return cmds
  },
}
