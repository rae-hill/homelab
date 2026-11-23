// Per-package presence of a semantic-release config guarantees the shared
// pipeline is picked up no matter which config-discovery path
// @anolilab/multi-semantic-release uses (it runs one semantic-release per
// project with cwd = the package directory). Single source of truth: the root
// release.config.js. New libs under lib/ copy this one-liner.
export { default } from "../../release.config.js"
