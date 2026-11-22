import { defineConfig } from "@rslib/core"
import { pluginAreTheTypesWrong } from "rsbuild-plugin-arethetypeswrong"
import { pluginPublint } from "rsbuild-plugin-publint"

/**
 * ESM-only bundleless build: every file under src/ emits a matching .js + .d.ts
 * into dist/ (package.json "type": "module" keeps the .js extension).
 *
 * publint + arethetypeswrong validate the publishable package (exports map,
 * types resolution) on EVERY build — including the pre-commit hook — so a
 * broken manifest never reaches `yarn npm publish`.
 */
export default defineConfig({
  // tsconfig.json is the repo's solution file (include: [] + project
  // references), which would make the dts build emit nothing; point RsLib at a
  // dedicated project that includes src/ and matches declarationDir ↔ dist.
  source: { tsconfigPath: "./tsconfig.rslib.json" },
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      syntax: "es2022",
    },
  ],
  plugins: [
    pluginPublint(),
    pluginAreTheTypesWrong({
      areTheTypesWrongOptions: {
        // ESM-only by design: legacy node10 resolution cannot read `exports`
        // and CJS consumers must use dynamic import — both attw findings are
        // intentional. Genuine type-resolution failures in node16-esm/bundler
        // modes still fail the build.
        ignoreResolutions: ["node10", "node16-cjs"],
      },
    }),
  ],
  // TODO: once @rslib/core 1.1.0 (stable) passes the repo's 5-day npm age gate,
  // enable generate-exports and DELETE the handwritten "exports" and
  // "publishConfig.exports" blocks from package.json — with `source: true`,
  // RsLib writes exactly those fields on every build (exports → src for
  // workspace dev, publishConfig.exports → dist for `yarn npm publish`).
  // See https://rslib.rs/config/lib/exports#exports-source
  // exports: { source: true },
})
