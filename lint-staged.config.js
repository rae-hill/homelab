export default {
  "*": [
    "fmt .",
  ],
  "*.{ts,tsx,js,jsx,mjs}": [
    "eslint --fix",
    "yarn test:staged",
  ],
  "*.{ts,tsx}": [
    () => "yarn lint",
    () => "yarn typecheck",
  ],
  // Exclude vendored subtrees under repos/ — those are read-only upstream sources
  // and must never be reformatted by nixfmt (mirrors dprint.json's `repos/*` exclude).
  // Invoke nixfmt via `nix run .#nixfmt` so the hook uses the SAME pinned nixfmt as
  // the devshell and the nixvim editor config, and does not depend on PATH (git
  // hooks run in a minimal shell that may not inherit the devshell environment).
  "*.nix": (files) => {
    const own = files.filter((f) => !f.includes("/repos/") && !f.startsWith("repos/"))
    const cmds = []
    if (own.length > 0) {
      cmds.push(`nix run .#nixfmt -- ${own.map((f) => `'${f}'`).join(" ")}`)
    }
    cmds.push("nix flake check --no-build")
    return cmds
  },
}
