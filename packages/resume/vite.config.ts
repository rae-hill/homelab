import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * Vite config for the CSR/SPA build.
 *
 * - `tanstackRouter` generates the type-safe route tree from `src/routes/**` into
 *   `src/routeTree.gen.ts` (with automatic code-splitting).
 * - `base: '/'` — the site is served at its own subdomain (resume.rae-hill.dev), so root base.
 * - Build output is `dist/` (Vite default); CI copies `index.html` → `404.html` for the
 *   GitHub Pages SPA deep-link fallback.
 *
 * No `tsconfig` path aliases are used, so no path-resolution plugin is needed.
 */
export default defineConfig({
  base: "/",
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        // Split large, rarely-changing vendor libraries into their own cacheable chunks
        // so the main app chunk is smaller and repeat visits reuse cached vendors.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: "chakra", test: /node_modules\/(@chakra-ui|@emotion|@zag-js|@ark-ui)\// },
            {
              name: "state",
              test: /node_modules\/(@reduxjs|react-redux|redux|immer|reselect|effect)\//,
            },
            { name: "router", test: /node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
})
