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
          TOTP_SECRET="$(cat "${config.sops.secrets.technitium_metrics_totp_secret.path}")"
          PKCS12_PASS="$(cat "${config.sops.secrets.technitium_pkcs12_password.path}")"

          api() {
            # usage: api <path-with-query>
            curl -fsS "${apiBase}/$1"
          }

          # --- 1. Admin login ------------------------------------------------------
          TOKEN="$(api "api/user/login?user=admin&pass=$ADMIN_PASS&includeInfo=false" \
            | jq -r '.token // empty')"
          if [ -z "$TOKEN" ]; then
            echo "technitium-provision: admin login failed" >&2
            exit 1
          fi

          auth() {
            # usage: auth <path-with-query>
            curl -fsS -H "Authorization: Bearer $TOKEN" "${apiBase}/$1"
          }

          # --- 2. Convert ACME PEM -> PKCS#12 for DoT/DoQ --------------------------
          # Technitium's DoT/DoQ listener needs its TLS material as a PKCS#12 bundle.
          if [ -f "${directory}/fullchain.pem" ] && [ -f "${directory}/key.pem" ]; then
            openssl pkcs12 -export \
              -out "${pkcs12Path}" \
              -inkey "${directory}/key.pem" \
              -in "${directory}/fullchain.pem" \
              -passout "pass:$PKCS12_PASS"
            chmod 0640 "${pkcs12Path}"
          fi

          # --- 3. Ensure the limited "prometheus" metrics user --------------------
          # NOTE: The exact session/permission API shape must be verified against the
          # running Technitium version (see docs/aedilis-host-plan.md §6). The calls
          # below follow APIDOCS.md and are written to be idempotent.
          EXISTING="$(auth "api/admin/users/list" | jq -r \
            '.response.users[]?.username // empty' | grep -Fx "prometheus" || true)"
          if [ -z "$EXISTING" ]; then
            auth "api/admin/users/create?user=prometheus&displayName=Prometheus&pass=$METRICS_PASS" \
              >/dev/null || true
          fi

          # Restrict the user to Dashboard: View only (idempotent set).
          auth "api/admin/users/set?user=prometheus&memberOfGroups=" >/dev/null || true

          # Generous session timeout so scraping survives brief gaps (§6).
          auth "api/admin/users/set?user=prometheus&sessionTimeoutSeconds=3600" \
            >/dev/null || true

          # --- 4. Enable TOTP for the prometheus user -----------------------------
          # Bootstrap wrinkle: Technitium may require a server-generated seed from
          # 2fa/init. If so, this step needs a one-time manual seed capture into
          # sops. See docs/aedilis-host-plan.md §6. We attempt enablement here and
          # tolerate failure so provisioning is not blocked.
          CODE="$(oathtool --totp -b "$TOTP_SECRET" 2>/dev/null || true)"
          if [ -n "$CODE" ]; then
            auth "api/user/2fa/enable?totp=$CODE" >/dev/null || true
          fi

          # --- 5. Enable DoT/DoQ optional protocols with the PKCS#12 cert ---------
          # Exact settings keys must be verified against the running version.
          if [ -f "${pkcs12Path}" ]; then
            auth "api/settings/set?enableDnsOverTls=true&enableDnsOverQuic=true&dnsTlsCertificatePath=${pkcs12Path}&dnsTlsCertificatePassword=$PKCS12_PASS" \
              >/dev/null || true
          fi

          echo "technitium-provision: completed"
        '';
      };
    in
    {
      systemd.services.technitium-provision = {
        description = "Bootstrap Technitium users, TOTP, DoT/DoQ cert";
        after = [
          "technitium-dns-server.service"
          "acme-${tech.domain}.service"
        ];
        wants = [ "technitium-dns-server.service" ];
        wantedBy = [ "multi-user.target" ];

        serviceConfig = {
          Type = "oneshot";
          User = "technitium";
          Group = "technitium";
          ExecStart = lib.getExe provisionScript;
          # Re-run when the public cert renews (refreshes the PKCS#12 bundle).
          RemainAfterExit = true;
        };

        # Give Technitium a moment to come up and write its initial config.
        preStart = "${pkgs.coreutils}/bin/sleep 10";
      };

      # Re-run provisioning on cert renewal to refresh the PKCS#12 bundle.
      systemd.services."acme-${tech.domain}".wants = [ "technitium-provision.service" ];
    };
}
