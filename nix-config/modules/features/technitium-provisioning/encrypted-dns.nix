{ config, ... }@topLevel:
{
  # Encrypted-DNS provisioning: convert the managed PEM cert to PKCS#12 and enable
  # DoH/DoT/DoQ via the settings API. Ordered after the ACME unit(s) that produce the
  # cert (cfg.provision.certReadyUnits), without this module referencing security.acme.
  flake.modules.nixos.technitium-provisioning-encrypted-dns =
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

      provisionLib = topLevel.config.constants.technitiumProvisioning;
      apiBase = "http://127.0.0.1:${toString cfg.webHttpPort}";
      pkcs12Path = "${cfg.stateDir}/dns.pfx";

      enabled = cfg.enable && prov.enable && cfg.encryptedDns.enable && prov.provisionDoTDoQCert;

      encryptedDnsScript = topLevel.config.constants.shell.mkScript pkgs {
        name = "technitium-provision-encrypted-dns";
        runtimeInputs = (provisionLib.baseRuntimeInputs pkgs) ++ [ pkgs.openssl ];
        text =
          provisionLib.preamble {
            inherit apiBase;
            tokenSocketPath = prov.tokenSocketPath;
          }
          + ''
            PKCS12_PASS="$(cat "${cfg.encryptedDns.pkcs12PasswordFile}")"

            # --- convert managed PEM -> PKCS#12 --------------------------------------
            if [ ! -f "${cfg.encryptedDns.certPemFile}" ] || [ ! -f "${cfg.encryptedDns.certKeyFile}" ]; then
              echo "technitium-provision-encrypted-dns: cert not found (${cfg.encryptedDns.certPemFile})" >&2
              exit 1
            fi
            umask 027
            openssl pkcs12 -export \
              -out "${pkcs12Path}" \
              -inkey "${cfg.encryptedDns.certKeyFile}" \
              -in "${cfg.encryptedDns.certPemFile}" \
              -passout "pass:$PKCS12_PASS"

            # --- enable DoH/DoT/DoQ with the PKCS#12 cert ----------------------------
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

            echo "technitium-provision-encrypted-dns: completed"
          '';
      };
    in
    {
      config = mkIf enabled {
        services.technitium-server-complete.provision._lintScripts = [ encryptedDnsScript ];

        systemd.services.technitium-provision-encrypted-dns = {
          description = "Technitium provisioning: PKCS#12 + enable DoH/DoT/DoQ";
          after = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
          ]
          ++ prov.certReadyUnits;
          requires = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
          ];
          wants = prov.certReadyUnits;
          wantedBy = [ "technitium-provision.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = cfg.user;
            Group = cfg.group;
            SupplementaryGroups = [ prov.tokenGroup ];
            ExecStart = lib.getExe encryptedDnsScript;
            RemainAfterExit = true;
            Restart = "on-failure";
            RestartSec = "15s";
          };
          unitConfig = {
            StartLimitIntervalSec = "300";
            StartLimitBurst = 10;
          };
        };
      };
    };
}
