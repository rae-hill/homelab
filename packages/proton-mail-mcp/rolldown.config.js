import { defineConfig } from "rolldown"
import { esmExternalRequirePlugin } from "rolldown/plugins"

export default defineConfig({
  input: "./src/main.ts",
  output: { dir: "./dist/bundle" },
  platform: "node",
  // CJS deps (imapflow/mailparser when they land) need the require interop plugin.
  // No stubOptionalNative plugin: unlike homelab-server (ws/bufferutil), our deps are pure JS.
  plugins: [esmExternalRequirePlugin()],
})
