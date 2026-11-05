import { defineConfig } from "rolldown"
import { esmExternalRequirePlugin } from "rolldown/plugins"

const stubOptionalNative = {
  name: "stub-optional-native",
  resolveId(id) {
    if (id === "bufferutil" || id === "utf-8-validate") {
      return { id, external: false }
    }
  },
  load(id) {
    if (id === "bufferutil" || id === "utf-8-validate") {
      // Throw, like the real `require` does when the optional native addon is
      // absent (MODULE_NOT_FOUND). ws requires these inside try/catch and
      // falls back to its pure-JS implementations. A stub exporting
      // `undefined` instead would make the require "succeed", ws would keep
      // the native-backed mask/unmask wrappers, and every CDP websocket frame
      // >= 48 bytes would crash with
      // "TypeError: Cannot read properties of undefined (reading 'mask')".
      // (Setting WS_NO_BUFFER_UTIL/WS_NO_UTF_8_VALIDATE from main.ts does NOT
      // work: this chunk is a static import evaluated before main.js's body.)
      return "throw new Error('optional native module stubbed out by bundler');"
    }
  },
}

export default defineConfig({
  input: "./src/main.ts",
  output: { dir: "./dist/bundle" },
  platform: "node",
  plugins: [
    stubOptionalNative,
    esmExternalRequirePlugin(),
  ],
})
