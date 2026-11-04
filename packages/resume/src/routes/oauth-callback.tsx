import { Box, Button, Spinner, Text, VStack } from "@chakra-ui/react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Effect } from "effect"
import { useEffect, useRef, useState } from "react"

import { completeLoginCallback } from "../state/homelab"
import { useAppDispatch } from "../state/print-config/store"

export const Route = createFileRoute("/oauth-callback")({
  component: OAuthCallbackPage,
})

/**
 * OIDC redirect-landing route (`/oauth-callback`, registered with kanidm). Completes the
 * PKCE code exchange via the shared AuthService — which validates `state` + the code
 * verifier and stores the session in sessionStorage — records the signed-in user in
 * redux, then bounces back to the resume. On failure, offers a way home.
 */
function OAuthCallbackPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    // StrictMode double-mount guard: the code/state exchange is strictly one-shot.
    if (started.current) {
      return
    }
    started.current = true
    void Effect.runPromise(completeLoginCallback(dispatch)).then((ok) => {
      if (ok) {
        void navigate({ to: "/" })
      } else {
        setFailed(true)
      }
    })
  }, [dispatch, navigate])

  return (
    <Box minH="40dvh" display="flex" alignItems="center" justifyContent="center">
      {failed ?
        (
          <VStack gap={3}>
            <Text m={0} color="red.fg">
              Sign-in failed — the link may be stale or expired.
            </Text>
            <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/" })}>
              Back to the resume
            </Button>
          </VStack>
        ) :
        (
          <VStack gap={3}>
            <Spinner size="lg" color="teal.500" />
            <Text m={0} textStyle="sm" color="fg.muted">
              Completing sign-in…
            </Text>
          </VStack>
        )}
    </Box>
  )
}
