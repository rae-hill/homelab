{ ... }:
{
  # Shared shell helpers for the Technitium provisioning units, exposed as a
  # flake-parts constant (config.constants.technitiumProvisioning). Each unit module
  # reads this at the flake-parts level and closes over it, so the fail-fast API
  # handling, readiness poll, and shared-token read are defined exactly once without
  # relative-path imports.
  config.constants.technitiumProvisioning = {
    # Common shell preamble: defines API, the helper functions, and (unless
    # `needsToken = false`) fetches the shared token from the broker socket. The
    # generated script gets:
    #   - wait_for_api : polls $API/api/status until ready (bounded).
    #   - fetch_token  : connects to the broker socket, reads $TOKEN (fails if blank).
    #   - api_call     : authenticated GET with .status=="ok" + errorMessage check.
    preamble =
      {
        apiBase,
        tokenSocketPath,
        needsToken ? true,
      }:
      ''
        set -euo pipefail

        API="${apiBase}"
        TOKEN_SOCKET="${tokenSocketPath}"

        # --- wait_for_api: poll the unauthenticated status endpoint ---------------
        wait_for_api() {
          local ready=0 _
          for _ in $(seq 1 30); do
            if curl -fsS "$API/api/status" >/dev/null 2>&1; then
              ready=1
              break
            fi
            sleep 2
          done
          if [ "$ready" -ne 1 ]; then
            echo "technitium-provision: API not ready at $API after ~60s" >&2
            exit 1
          fi
        }

        # --- fetch_token: ask the broker socket for the current session token -----
        # The broker (socket-activated, group-locked) validates/refreshes and returns
        # the token on the connection. We never see the admin password.
        fetch_token() {
          TOKEN="$(socat - "UNIX-CONNECT:$TOKEN_SOCKET" 2>/dev/null || true)"
          if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
            echo "technitium-provision: token broker returned no token at $TOKEN_SOCKET" >&2
            echo "technitium-provision: is technitium-provision-token.socket active?" >&2
            exit 1
          fi
        }

        # --- api_call <description> <path> [curl --data-urlencode args...] --------
        # Fails fast on HTTP error or a JSON body whose status != "ok". Automatically
        # appends the shared token.
        api_call() {
          local desc="$1"
          shift
          local path="$1"
          shift || true

          local resp
          if ! resp="$(curl -fsS -G "$API/$path" "$@" \
            --data-urlencode "token=''${TOKEN:-}")"; then
            echo "technitium-provision: HTTP failure during: $desc" >&2
            exit 1
          fi

          if [ "$(printf '%s' "$resp" | jq -r '.status // "missing"')" != "ok" ]; then
            echo "technitium-provision: API error during: $desc" >&2
            printf '%s\n' "$resp" | jq -r '.errorMessage // "no errorMessage"' >&2
            exit 1
          fi

          printf '%s' "$resp"
        }
      ''
      + (
        if needsToken then
          ''
            wait_for_api
            fetch_token
          ''
        else
          ""
      );

    # Base runtime inputs every provisioning unit needs. socat is used to talk to the
    # token broker socket.
    baseRuntimeInputs =
      pkgs: with pkgs; [
        curl
        jq
        coreutils
        socat
      ];
  };
}
