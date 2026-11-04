import { Button, HStack, IconButton, Text } from "@chakra-ui/react"
import { LuLogIn, LuLogOut } from "react-icons/lu"

import { useHomelabAuth, useHomelabReachability, useLogin, useLogout } from "../state/homelab"

/**
 * Homelab sign-in control for the header. Stays completely dark unless the tailscale-only
 * homelab API answered the reachability probe — public visitors never see it. Signed out
 * → a Sign in button (PKCE redirect to kanidm); signed in → the account email + sign out.
 * The whole header (and thus this control) is hidden in print.
 */
export function HomelabAuthButton() {
  const reachability = useHomelabReachability()
  const auth = useHomelabAuth()
  const login = useLogin()
  const logout = useLogout()

  if (reachability !== "reachable" || auth.status === "unknown") {
    return null
  }

  if (auth.status === "signedIn") {
    return (
      <HStack gap={1}>
        <Text m={0} textStyle="xs" color="fg.muted" maxW="12rem" truncate>
          {auth.email ?? "Signed in"}
        </Text>
        <IconButton aria-label="Sign out" variant="ghost" size="md" onClick={logout}>
          <LuLogOut style={{ width: "1.25rem", height: "1.25rem" }} />
        </IconButton>
      </HStack>
    )
  }

  return (
    <Button size="sm" variant="ghost" onClick={login}>
      <LuLogIn /> Sign in
    </Button>
  )
}
