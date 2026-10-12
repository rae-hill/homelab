{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
in
{
  flake.modules.nixos.technitium-provision =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (config.security.acme.certs."${tech.domain}") directory;
      stateDir = "/var/lib/technitium-dns-server";
      pkcs12Path = "${stateDir}/dns.pfx";
      # Where the server-generated TOTP seed is persisted after first enablement so
      # the augustus token oneshot can compute codes. Readable only by technitium.
      totpSeedPath = "${stateDir}/metrics-totp-seed";
      apiBase = "http://127.0.0.1:${toString tech.webHttpPort}";

      provisionScript = pkgs.writeShellApplication {
        name = "technitium-provision";
        runtimeInputs = with pkgs; [
          curl
          jq
          openssl
          oath-toolkit
          coreutils
        ];
        text = ''
          set -euo pipefail

          ADMIN_PASS="$(cat "${config.sops.secrets.technitium_admin_password.path}")"
          METRICS_PASS="$(cat "${config.sops.secrets.technitium_metrics_user_password.path}")"
          PKCS12_PASS="$(cat "${config.sops.secrets.technitium_pkcs12_password.path}")"

          API="${apiBase}"

          # --- helpers -------------------------------------------------------------
          # api_call <description> <path-with-query...> — fails fast on HTTP error or
          # on a JSON body whose status != "ok". Prints the Technitium errorMessage.
          api_call() {
            local desc="$1"
            shift
            local url="$API/$1"
            shift || true

            local resp
            if ! resp="$(curl -fsS -G "$url" "$@" \
              --data-urlencode "token=''${TOKEN:-}")"; then
              echo "technitium-provision: HTTP failure during: $desc" >&2
              exit 1
            fi

            local status
            status="$(printf '%s' "$resp" | jq -r '.status // "missing"')"
            if [ "$status" != "ok" ]; then
              echo "technitium-provision: API error during: $desc" >&2
              printf '%s\n' "$resp" | jq -r '.errorMessage // "no errorMessage"' >&2
              exit 1
            fi

            printf '%s' "$resp"
          }

          # --- 1. Admin login (fail fast) -----------------------------------------
          TOKEN=""
          LOGIN_RESP="$(curl -fsS -G "$API/api/user/login" \
            --data-urlencode "user=admin" \
            --data-urlencode "pass=$ADMIN_PASS" \
            --data-urlencode "includeInfo=false")" || {
            echo "technitium-provision: admin login request failed (is the service up?)" >&2
            exit 1
          }
          if [ "$(printf '%s' "$LOGIN_RESP" | jq -r '.status // "missing"')" != "ok" ]; then
            echo "technitium-provision: admin login rejected:" >&2
            printf '%s\n' "$LOGIN_RESP" | jq -r '.errorMessage // "no errorMessage"' >&2
            exit 1
          fi
          TOKEN="$(printf '%s' "$LOGIN_RESP" | jq -r '.token')"
          if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
            echo "technitium-provision: no token returned from login" >&2
            exit 1
          fi

          # --- 2. Relocate DoH-over-HTTP off port 80 + lock reverse proxy to Caddy -
          # Caddy owns port 80 (ACME). Move Technitium's plaintext DoH listener to a
          # loopback backend port and restrict it to the loopback reverse proxy.
          api_call "set DoH-over-HTTP backend port + reverse proxy ACL" \
            "api/settings/set" \
            --data-urlencode "enableDnsOverHttp=true" \
            --data-urlencode "dnsOverHttpPort=${toString tech.dohBackendPort}" \
            --data-urlencode "dnsReverseProxyNetworkACL=127.0.0.1,::1" \
            >/dev/null

          # --- 3. Convert ACME PEM -> PKCS#12 for DoT/DoQ -------------------------
          if [ ! -f "${directory}/fullchain.pem" ] || [ ! -f "${directory}/key.pem" ]; then
            echo "technitium-provision: ACME cert for ${tech.domain} not found at ${directory}" >&2
            exit 1
          fi
          umask 027
          openssl pkcs12 -export \
            -out "${pkcs12Path}" \
            -inkey "${directory}/key.pem" \
            -in "${directory}/fullchain.pem" \
            -passout "pass:$PKCS12_PASS"

          # --- 4. Enable DoT/DoQ with the PKCS#12 cert ----------------------------
          api_call "enable DoT/DoQ with PKCS#12 cert" \
            "api/settings/set" \
            --data-urlencode "enableDnsOverTls=true" \
            --data-urlencode "enableDnsOverQuic=true" \
            --data-urlencode "dnsOverTlsPort=${toString tech.dotPort}" \
            --data-urlencode "dnsOverQuicPort=${toString tech.dotPort}" \
            --data-urlencode "dnsTlsCertificatePath=${pkcs12Path}" \
            --data-urlencode "dnsTlsCertificatePassword=$PKCS12_PASS" \
            >/dev/null

          # --- 5. Dedicated "Dashboard view only" group for metrics ---------------
          # Create a group (idempotent: tolerate "already exists") and grant it
          # Dashboard view-only, nothing else.
          GROUPS="$(api_call "list groups" "api/admin/groups/list")"
          if ! printf '%s' "$GROUPS" | jq -e \
            '.response.groups[]? | select(.name == "metrics-readonly")' >/dev/null; then
            api_call "create metrics-readonly group" \
              "api/admin/groups/create" \
              --data-urlencode "group=metrics-readonly" \
              --data-urlencode "description=Dashboard view-only for Prometheus" \
              >/dev/null
          fi
          api_call "grant Dashboard view to metrics-readonly" \
            "api/admin/permissions/set" \
            --data-urlencode "section=Dashboard" \
            --data-urlencode "groupPermissions=metrics-readonly|true|false|false" \
            >/dev/null

          # --- 6. Ensure the limited "prometheus" user ----------------------------
          USERS="$(api_call "list users" "api/admin/users/list")"
          if ! printf '%s' "$USERS" | jq -e \
            '.response.users[]? | select(.username == "prometheus")' >/dev/null; then
            api_call "create prometheus user" \
              "api/admin/users/create" \
              --data-urlencode "displayName=Prometheus" \
              --data-urlencode "user=prometheus" \
              --data-urlencode "pass=$METRICS_PASS" \
              >/dev/null
          fi
          # Restrict membership to ONLY the metrics-readonly group + generous timeout.
          api_call "restrict prometheus user to metrics-readonly" \
            "api/admin/users/set" \
            --data-urlencode "user=prometheus" \
            --data-urlencode "memberOfGroups=metrics-readonly" \
            --data-urlencode "sessionTimeoutSeconds=3600" \
            >/dev/null

          # --- 7. Enable TOTP for the prometheus user (init -> enable) ------------
          # Only run the init/enable flow if a seed has not already been persisted.
          # The seed is SERVER-generated by 2fa/init and must be captured for the
          # augustus token oneshot to compute codes.
          if [ ! -s "${totpSeedPath}" ]; then
            # Log in AS the prometheus user to get a session for 2FA setup.
            PROM_LOGIN="$(curl -fsS -G "$API/api/user/login" \
              --data-urlencode "user=prometheus" \
              --data-urlencode "pass=$METRICS_PASS" \
              --data-urlencode "includeInfo=false")" || {
              echo "technitium-provision: prometheus login failed" >&2
              exit 1
            }
            if [ "$(printf '%s' "$PROM_LOGIN" | jq -r '.status // "missing"')" != "ok" ]; then
              echo "technitium-provision: prometheus login rejected:" >&2
              printf '%s\n' "$PROM_LOGIN" | jq -r '.errorMessage // "no errorMessage"' >&2
              exit 1
            fi
            PROM_TOKEN="$(printf '%s' "$PROM_LOGIN" | jq -r '.token')"

            INIT="$(curl -fsS -G "$API/api/user/2fa/init" \
              --data-urlencode "token=$PROM_TOKEN")" || {
              echo "technitium-provision: 2fa/init request failed" >&2
              exit 1
            }
            if [ "$(printf '%s' "$INIT" | jq -r '.status // "missing"')" != "ok" ]; then
              echo "technitium-provision: 2fa/init rejected:" >&2
              printf '%s\n' "$INIT" | jq -r '.errorMessage // "no errorMessage"' >&2
              exit 1
            fi
            SEED="$(printf '%s' "$INIT" | jq -r '.response.secret // empty')"
            if [ -z "$SEED" ]; then
              echo "technitium-provision: 2fa/init returned no secret" >&2
              exit 1
            fi

            CODE="$(oathtool --totp -b "$SEED")"
            ENABLE="$(curl -fsS -G "$API/api/user/2fa/enable" \
              --data-urlencode "token=$PROM_TOKEN" \
              --data-urlencode "totp=$CODE")" || {
              echo "technitium-provision: 2fa/enable request failed" >&2
              exit 1
            }
            if [ "$(printf '%s' "$ENABLE" | jq -r '.status // "missing"')" != "ok" ]; then
              echo "technitium-provision: 2fa/enable rejected:" >&2
              printf '%s\n' "$ENABLE" | jq -r '.errorMessage // "no errorMessage"' >&2
              exit 1
            fi

            # Persist the seed (0400, technitium-only) for the augustus oneshot to
            # fetch out-of-band during the deployment runbook.
            printf '%s' "$SEED" > "${totpSeedPath}"
            chmod 0400 "${totpSeedPath}"
            echo "technitium-provision: TOTP enabled for prometheus; seed written to ${totpSeedPath}"
            echo "technitium-provision: ACTION REQUIRED — copy this seed into augustus sops as technitium_metrics_totp_secret"
          fi

          echo "technitium-provision: completed successfully"
        '';
      };
    in
    {
      systemd.services.technitium-provision = {
        description = "Bootstrap Technitium: DoH port, DoT/DoQ cert, metrics user, TOTP";
        after = [
          "technitium-dns-server.service"
          "acme-${tech.domain}.service"
        ];
        requires = [ "technitium-dns-server.service" ];
        wantedBy = [ "multi-user.target" ];

        serviceConfig = {
          Type = "oneshot";
          User = "technitium";
          Group = "technitium";
          ExecStart = lib.getExe provisionScript;
          RemainAfterExit = true;
          # Retry a few times if Technitium is still starting on first boot.
          Restart = "on-failure";
          RestartSec = "15s";
        };
        unitConfig = {
          StartLimitIntervalSec = "300";
          StartLimitBurst = 10;
        };

        # Give Technitium time to write its initial config before first attempt.
        preStart = "${pkgs.coreutils}/bin/sleep 10";
      };

      # Re-run provisioning on cert renewal to refresh the PKCS#12 bundle.
      systemd.services."acme-${tech.domain}".wants = [ "technitium-provision.service" ];
    };
}
