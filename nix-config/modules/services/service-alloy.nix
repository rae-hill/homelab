{ config, ... }:
let
  c = config.constants;
  svc = c.services.alloy;
  lokiSvc = c.services.loki;
in
{
  flake.modules.nixos.alloy =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.alloy = {
        enable = true;
        extraFlags = [
          "--server.http.listen-addr=127.0.0.1:${toString svc.port}"
          "--disable-reporting"
        ];
      };

      environment.etc."alloy/config.alloy".text = ''
        // Discover all systemd journal entries (services + podman containers)
        loki.source.journal "systemd" {
          relabel_rules = loki.relabel.journal.rules
          forward_to    = [loki.write.local.receiver]
          max_age       = "12h"
        }

        // Relabel rules to extract useful metadata
        loki.relabel "journal" {
          forward_to = []

          rule {
            source_labels = ["__journal__systemd_unit"]
            target_label  = "unit"
          }

          rule {
            source_labels = ["__journal__hostname"]
            target_label  = "hostname"
          }

          rule {
            source_labels = ["__journal_priority_keyword"]
            target_label  = "syslevel"
          }

          rule {
            source_labels = ["__journal_container_name"]
            target_label  = "container"
          }

          rule {
            source_labels = ["__journal__transport"]
            target_label  = "transport"
          }
        }

        // Push logs to local Loki instance
        loki.write "local" {
          endpoint {
            url = "http://127.0.0.1:${toString lokiSvc.port}/loki/api/v1/push"
          }
        }
      '';

      # Alloy needs access to the systemd journal
      systemd.services.alloy.serviceConfig = {
        SupplementaryGroups = [ "systemd-journal" ];
      };

      services.failure-notifs.attachServices = [ "alloy" ];
    };
}
