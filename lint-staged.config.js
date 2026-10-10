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
  "*.nix": [
    "nixfmt",
    () => "nix flake check --no-build",
  ],
}
