{ ... }:
{
  # Socket-activated session-token broker. The ONLY unit with access to the
  # provisioning user's password and the cached session token. Consumers connect to a
  # group-locked Unix socket and receive the current token on stdout; they never see
  # the password or the cache. The broker lazily refreshes the token when a stored
  # deadline has elapsed, so there is no background timer — refresh happens on demand,
  # guarded by a flock so concurrent connections don't race the cache.
  #
  # The broker logs in as the DEDICATED provisioning user (provision.apiUser), which
  # is created MANUALLY with least privilege (Settings:Modify + Zones:Modify) — see
  # docs/aedilis-deployment-runbook.md. It is NOT the built-in admin account.
  #
  # Security model:
  #   - socket:         root:<tokenGroup> mode 0660  -> only tokenGroup may connect
  #   - apiUser passwd: owner-only sops secret, read only by the broker service user
  #   - token cache:    StateDirectory (/var/lib/<tokenCacheDir>), broker-user-only
  flake.modules.nixos.technitium-provisioning-token =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      prov = cfg.provision;
      inherit (lib) mkIf;

      apiBase = "http://127.0.0.1:${toString cfg.webHttpPort}";

      # /run/technitium-provision/token.sock -> RuntimeDirectory "technitium-provision"
      # (relative to /run). The socket unit creates the parent dir via tmpfiles below.
      socketDir = builtins.dirOf prov.tokenSocketPath;

      cacheDir = "/var/lib/${prov.tokenCacheDir}";
      tokenCache = "${cacheDir}/token";
      deadlineCache = "${cacheDir}/deadline";
      lockFile = "${cacheDir}/.lock";

      brokerScript = pkgs.writeShellApplication {
        name = "technitium-provision-token-broker";
        runtimeInputs = with pkgs; [
          curl
          jq
          coreutils
          util-linux # flock
        ];
        text = ''
          set -euo pipefail

          API="${apiBase}"

          # Serialize refreshes across concurrent connections. The whole validate +
          # refresh + emit sequence runs under the lock so two connections can't both
          # mint a token (or read a half-written cache).
          exec 9>"${lockFile}"
          flock 9

          now="$(date +%s)"
          need_refresh=1
          if [ -s "${tokenCache}" ] && [ -s "${deadlineCache}" ]; then
            deadline="$(cat "${deadlineCache}")"
            if [ "$now" -lt "$deadline" ]; then
              need_refresh=0
            fi
          fi

          if [ "$need_refresh" -eq 1 ]; then
            API_PASS="$(cat "${prov.apiPasswordFile}")"

            # Wait for the API (the broker may be hit before Technitium is fully up).
            ready=0
            for _ in $(seq 1 30); do
              if curl -fsS "$API/api/status" >/dev/null 2>&1; then
                ready=1
                break
              fi
              sleep 2
            done
            if [ "$ready" -ne 1 ]; then
              echo "technitium-provision-token-broker: API not ready at $API" >&2
              exit 1
            fi

            # Log in as the DEDICATED provisioning user (created manually; least
            # privilege: Settings:Modify + Zones:Modify). NOT the admin account.
            LOGIN_RESP="$(curl -fsS -G "$API/api/user/login" \
              --data-urlencode "user=${prov.apiUser}" \
              --data-urlencode "pass=$API_PASS" \
              --data-urlencode "includeInfo=false")" || {
              echo "technitium-provision-token-broker: ${prov.apiUser} login request failed" >&2
              exit 1
            }
            if [ "$(printf '%s' "$LOGIN_RESP" | jq -r '.status // "missing"')" != "ok" ]; then
              echo "technitium-provision-token-broker: ${prov.apiUser} login rejected:" >&2
              echo "technitium-provision-token-broker: has the '${prov.apiUser}' user been created? (see runbook)" >&2
              printf '%s\n' "$LOGIN_RESP" | jq -r '.errorMessage // "no errorMessage"' >&2
              exit 1
            fi
            TOKEN="$(printf '%s' "$LOGIN_RESP" | jq -r '.token')"
            if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
              echo "technitium-provision-token-broker: no token returned from login" >&2
              exit 1
            fi

            umask 077
            printf '%s' "$TOKEN" > "${tokenCache}"
            printf '%s' "$((now + ${toString prov.tokenTtlSeconds}))" > "${deadlineCache}"
          fi

          # Emit the token to the connected client (StandardOutput=socket). No trailing
          # newline so the consumer captures it verbatim.
          printf '%s' "$(cat "${tokenCache}")"
        '';
      };
    in
    {
      config = mkIf (cfg.enable && prov.enable) {
        # Dedicated service-account group permitted to connect to the broker socket.
        users.groups.${prov.tokenGroup} = { };

        # Ensure the socket's parent directory exists (owned by the service user) so
        # the socket unit can bind there.
        systemd.tmpfiles.rules = [
          "d ${socketDir} 0755 ${cfg.user} ${cfg.group} -"
        ];

        # Socket activation: per-connection (Accept=yes) spawns the template below,
        # handing it the connection on stdout. Group-locked to tokenGroup.
        systemd.sockets.technitium-provision-token = {
          description = "Technitium provisioning: session-token broker socket";
          wantedBy = [ "sockets.target" ];
          socketConfig = {
            ListenStream = prov.tokenSocketPath;
            Accept = "yes";
            SocketMode = "0660";
            SocketUser = cfg.user;
            SocketGroup = prov.tokenGroup;
          };
        };

        # Per-connection template. Runs as the service user (which can read the admin
        # password + cache); validates/refreshes the token; prints it to the socket.
        systemd.services."technitium-provision-token@" = {
          description = "Technitium provisioning: session-token broker (per connection)";
          after = [ "technitium-dns-server.service" ];

          serviceConfig = {
            Type = "oneshot";
            User = cfg.user;
            Group = cfg.group;
            ExecStart = lib.getExe brokerScript;
            StandardInput = "socket";
            StandardOutput = "socket";
            StandardError = "journal";
            # Broker-only token cache (never group-exposed).
            StateDirectory = prov.tokenCacheDir;
            StateDirectoryMode = "0700";
          };
        };
      };
    };
}
