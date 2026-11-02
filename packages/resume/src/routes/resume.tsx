import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The resume lives at the site root (`/`). This route only exists to redirect any existing
 * `/resume` links to the primary page (handled in `beforeLoad` so it never renders).
 */
export const Route = createFileRoute("/resume")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
})
