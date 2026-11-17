{ config, ... }:
let
  c = config.constants;
  alloySvc = c.services.alloy;
  lokiPush = c.services.loki-push;
  ciceroMetrics = c.services.cicero-metrics;
in
{
  flake.modules.nixos.cicero-observability-alloy =
    { config, lib, ... }:
    let
      inherit (config.security.acme.certs."${ciceroMetrics.domain}") directory;
    in
    {
      services.alloy = {
        enable = true;
        extraFlags = [
          "--server.http.listen-addr=127.0.0.1:${toString alloySvc.port}"
          "--disable-reporting"
        ];
      };

      environment.etc."alloy/config.alloy".text = ''
        // Discover all systemd journal entries
        loki.source.journal "systemd" {
          relabel_rules = loki.relabel.journal.rules
          forward_to    = [loki.write.remote.receiver]
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

        // Push logs to Augustus' Loki via mTLS
        loki.write "remote" {
          endpoint {
            url = "${lokiPush.url}/loki/api/v1/push"

            tls_config {
              ca_file     = "${c.ca.rootCert}"
              cert_file   = "${directory}/fullchain.pem"
              key_file    = "${directory}/key.pem"
            }
          }
        }
      '';

      # Override DynamicUser so we can use a static user with group-based cert access
      systemd.services.alloy.serviceConfig = {
        DynamicUser = lib.mkForce false;
        User = "alloy";
        Group = "alloy";
        SupplementaryGroups = [
          "systemd-journal"
          "cicero-observability"
        ];
      };

      systemd.tmpfiles.rules = [
        "d /var/lib/alloy 0750 alloy alloy -"
        "Z /var/lib/alloy - alloy alloy -"
      ];

      users.users.alloy = {
        isSystemUser = true;
        group = "alloy";
      };

      users.groups.alloy = { };

      # Ensure Alloy starts after cert is available
      systemd.services.alloy.after = [ "acme-${ciceroMetrics.domain}.service" ];
      systemd.services.alloy.wants = [ "acme-${ciceroMetrics.domain}.service" ];
    };
}
