{ ... }:
{
  flake.modules.nixos.technitium-provision =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      inherit (lib) mkIf optionalString;

      pkcs12Path = "${cfg.stateDir}/dns.pfx";
      totpSeedPath =
        if cfg.provision.metricsUser.totp.seedOutputPath != "" then
          cfg.provision.metricsUser.totp.seedOutputPath
        else
          "${cfg.stateDir}/metrics-totp-seed";
      apiBase = "http://127.0.0.1:${toString cfg.webHttpPort}";

      doCert = cfg.encryptedDns.enable && cfg.provision.provisionDoTDoQCert;
      doMetricsUser = cfg.provision.metricsUser.enable;
      doTotp = doMetricsUser && cfg.provision.metricsUser.totp.enable;
      doRateLimit = cfg.rateLimit.enable;
      mu = cfg.provision.metricsUser;

      inherit (lib) concatStringsSep concatMapStringsSep;

      # Technitium renders QPM prefix limits as pipe-separated rows:
      #   prefix|udpLimit|tcpLimit|prefix|udpLimit|tcpLimit...
      renderQpm =
        rows:
        concatMapStringsSep "|" (
          r: "${toString r.prefix}|${toString r.udpLimit}|${toString r.tcpLimit}"
        ) rows;
      qpmV4 = renderQpm cfg.rateLimit.ipv4;
      qpmV6 = renderQpm cfg.rateLimit.ipv6;

      boolStr = b: if b then "true" else "false";

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

          ADMIN_PASS="$(cat "${cfg.adminPasswordFile}")"
          ${optionalString doMetricsUser ''METRICS_PASS="$(cat "${mu.passwordFile}")"''}
          ${optionalString doCert ''PKCS12_PASS="$(cat "${cfg.encryptedDns.pkcs12PasswordFile}")"''}

          API="${apiBase}"

          # --- 0. Wait for Technitium to be ready ---------------------------------
          # Poll the unauthenticated status endpoint instead of a fixed sleep, so the
          # first-boot ordering is deterministic. Bounded to ~60s; the unit's
          # Restart=on-failure covers longer startups.
          ready=0
          for _ in $(seq 1 30); do
            if curl -fsS "$API/api/status" >/dev/null 2>&1; then
              ready=1
              break
            fi
            sleep 2
          done
          if [ "$ready" -ne 1 ]; then
            echo "technitium-provision: Technitium API not ready at $API after ~60s" >&2
            exit 1
          fi

          # --- helpers -------------------------------------------------------------
          # api_call <description> <path> [curl --data-urlencode args...] — fails fast
          # on HTTP error or on a JSON body whose status != "ok".
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

          # --- 2. Global DNS settings: DNSSEC validation + QPM rate limiting ------
          api_call "set DNSSEC validation" \
            "api/settings/set" \
            --data-urlencode "dnssecValidation=${boolStr cfg.dnssecValidation}" \
            >/dev/null

          ${optionalString doRateLimit ''
            # Per-client QPM limits blunt UDP reflection/amplification on the public
            # authoritative service while letting legitimate clients through (over-limit
            # UDP gets TC=1 to force a TCP retry rather than being dropped).
            api_call "set QPM rate limits" \
              "api/settings/set" \
              --data-urlencode "qpmLimitSampleMinutes=${toString cfg.rateLimit.sampleMinutes}" \
              --data-urlencode "qpmLimitUdpTruncationPercentage=${toString cfg.rateLimit.udpTruncationPercentage}" \
              --data-urlencode "qpmPrefixLimitsIPv4=${qpmV4}" \
              --data-urlencode "qpmPrefixLimitsIPv6=${qpmV6}" \
              >/dev/null
          ''}

          ${optionalString doCert ''
            # --- 3. Convert managed PEM -> PKCS#12 + enable DoT/DoQ/DoH -----------
            if [ ! -f "${cfg.encryptedDns.certPemFile}" ] || [ ! -f "${cfg.encryptedDns.certKeyFile}" ]; then
              echo "technitium-provision: encrypted-DNS cert not found (${cfg.encryptedDns.certPemFile})" >&2
              exit 1
            fi
            umask 027
            openssl pkcs12 -export \
              -out "${pkcs12Path}" \
              -inkey "${cfg.encryptedDns.certKeyFile}" \
              -in "${cfg.encryptedDns.certPemFile}" \
              -passout "pass:$PKCS12_PASS"

            api_call "enable DoH/DoT/DoQ with PKCS#12 cert" \
              "api/settings/set" \
              --data-urlencode "enableDnsOverHttps=true" \
              --data-urlencode "enableDnsOverTls=true" \
              --data-urlencode "enableDnsOverQuic=true" \
              --data-urlencode "dnsOverHttpsPort=${toString cfg.encryptedDns.dohPort}" \
              --data-urlencode "dnsOverTlsPort=${toString cfg.encryptedDns.dotPort}" \
              --data-urlencode "dnsOverQuicPort=${toString cfg.encryptedDns.doqPort}" \
              --data-urlencode "dnsTlsCertificatePath=${pkcs12Path}" \
              --data-urlencode "dnsTlsCertificatePassword=$PKCS12_PASS" \
              >/dev/null
          ''}

          ${optionalString doMetricsUser ''
            # --- 4. Dedicated "Dashboard view only" group -------------------------
            groups_json="$(api_call "list groups" "api/admin/groups/list")"
            if ! printf '%s' "$groups_json" | jq -e \
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

            # --- 5. Ensure the limited metrics user -------------------------------
            users_json="$(api_call "list users" "api/admin/users/list")"
            if ! printf '%s' "$users_json" | jq -e \
              '.response.users[]? | select(.username == "${mu.username}")' >/dev/null; then
              api_call "create ${mu.username} user" \
                "api/admin/users/create" \
                --data-urlencode "displayName=${mu.username}" \
                --data-urlencode "user=${mu.username}" \
                --data-urlencode "pass=$METRICS_PASS" \
                >/dev/null
            fi
            api_call "restrict ${mu.username} to metrics-readonly" \
              "api/admin/users/set" \
              --data-urlencode "user=${mu.username}" \
              --data-urlencode "memberOfGroups=metrics-readonly" \
              --data-urlencode "sessionTimeoutSeconds=${toString mu.sessionTimeoutSeconds}" \
              >/dev/null
          ''}

          ${optionalString doTotp ''
            # --- 6. Enable TOTP for the metrics user (init -> enable) -------------
            # Server-generated seed from 2fa/init is persisted for out-of-band
            # transfer to the scraping host. Only runs once (seed file is the guard).
            if [ ! -s "${totpSeedPath}" ]; then
              PROM_LOGIN="$(curl -fsS -G "$API/api/user/login" \
                --data-urlencode "user=${mu.username}" \
                --data-urlencode "pass=$METRICS_PASS" \
                --data-urlencode "includeInfo=false")" || {
                echo "technitium-provision: ${mu.username} login failed" >&2
                exit 1
              }
              if [ "$(printf '%s' "$PROM_LOGIN" | jq -r '.status // "missing"')" != "ok" ]; then
                echo "technitium-provision: ${mu.username} login rejected:" >&2
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

              printf '%s' "$SEED" > "${totpSeedPath}"
              chmod 0400 "${totpSeedPath}"
              echo "technitium-provision: TOTP enabled for ${mu.username}; seed at ${totpSeedPath}"
              echo "technitium-provision: ACTION REQUIRED — copy this seed to the scraping host's sops"
            fi
          ''}

          echo "technitium-provision: completed successfully"
        '';
      };
    in
    {
      config = mkIf (cfg.enable && cfg.provision.enable) {
        systemd.services.technitium-provision = {
          description = "Bootstrap Technitium: DoH/DoT/DoQ cert, metrics user, TOTP";
          after = [ "technitium-dns-server.service" ] ++ cfg.provision.certReadyUnits;
          requires = [ "technitium-dns-server.service" ];
          wants = cfg.provision.certReadyUnits;
          wantedBy = [ "multi-user.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = cfg.user;
            Group = cfg.group;
            ExecStart = lib.getExe provisionScript;
            RemainAfterExit = true;
            Restart = "on-failure";
            RestartSec = "15s";
          };
          unitConfig = {
            StartLimitIntervalSec = "300";
            StartLimitBurst = 10;
          };
          # Readiness is handled inside the script (polls /api/status), so no fixed
          # preStart sleep is needed.
        };
      };
    };
}
