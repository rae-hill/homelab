{ config, ... }@topLevel:
{
  # Global DNS settings provisioning: DNSSEC validation + per-client QPM rate limits.
  # Reads the shared session token; applies settings via the Technitium settings API.
  flake.modules.nixos.technitium-provisioning-settings =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      prov = cfg.provision;
      inherit (lib) mkIf optionalString concatMapStringsSep;

      provisionLib = topLevel.config.constants.technitiumProvisioning;
      apiBase = "http://127.0.0.1:${toString cfg.webHttpPort}";

      boolStr = b: if b then "true" else "false";
      doRateLimit = cfg.rateLimit.enable;

      # Technitium renders QPM prefix limits as pipe-separated rows:
      #   prefix|udpLimit|tcpLimit|prefix|udpLimit|tcpLimit...
      renderQpm =
        rows:
        concatMapStringsSep "|" (
          r: "${toString r.prefix}|${toString r.udpLimit}|${toString r.tcpLimit}"
        ) rows;
      qpmV4 = renderQpm cfg.rateLimit.ipv4;
      qpmV6 = renderQpm cfg.rateLimit.ipv6;

      settingsScript = pkgs.writeShellApplication {
        name = "technitium-provision-settings";
        runtimeInputs = provisionLib.baseRuntimeInputs pkgs;
        text =
          provisionLib.preamble {
            inherit apiBase;
            tokenSocketPath = prov.tokenSocketPath;
          }
          + ''
            # --- DNSSEC validation ----------------------------------------------------
            api_call "set DNSSEC validation" \
              "api/settings/set" \
              --data-urlencode "dnssecValidation=${boolStr cfg.dnssecValidation}" \
              >/dev/null

            ${optionalString doRateLimit ''
              # --- per-client QPM rate limits -----------------------------------------
              api_call "set QPM rate limits" \
                "api/settings/set" \
                --data-urlencode "qpmLimitSampleMinutes=${toString cfg.rateLimit.sampleMinutes}" \
                --data-urlencode "qpmLimitUdpTruncationPercentage=${toString cfg.rateLimit.udpTruncationPercentage}" \
                --data-urlencode "qpmPrefixLimitsIPv4=${qpmV4}" \
                --data-urlencode "qpmPrefixLimitsIPv6=${qpmV6}" \
                >/dev/null
            ''}

            echo "technitium-provision-settings: completed"
          '';
      };
    in
    {
      config = mkIf (cfg.enable && prov.enable) {
        systemd.services.technitium-provision-settings = {
          description = "Technitium provisioning: DNSSEC validation + QPM rate limits";
          after = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
          ];
          requires = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
          ];
          wantedBy = [ "technitium-provision.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = cfg.user;
            Group = cfg.group;
            SupplementaryGroups = [ prov.tokenGroup ];
            ExecStart = lib.getExe settingsScript;
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
