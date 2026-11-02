import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"

import "./env"
import "./css/custom.css"
import { setupEnvironmentSideEffects } from "./prod-side-effects"
import { routeTree } from "./routeTree.gen"

setupEnvironmentSideEffects()

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById("root")
if (rootElement === null) {
  throw new Error("Root element #root not found")
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
