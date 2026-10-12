{ ... }:
{
  # Observability for aedilis: node_exporter (host metrics, scraped via the mTLS
  # Caddy metrics vhost) + Alloy (journald → augustus Loki push over mTLS).
  # Gated by services.technitium-server-complete.observability.enable.
  flake.modules.nixos.technitium-aedilis-observability =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      obs = cfg.observability;
      inherit (lib) mkIf;
    in
    {
      config = mkIf (cfg.enable && obs.enable) {
        services.prometheus.exporters.node = {
          enable = true;
          port = obs.nodeExporterPort;
          listenAddress = "127.0.0.1";
          enabledCollectors = [
            "systemd"
            "processes"
          ];
        };

        services.alloy = {
          enable = true;
          extraFlags = [
            "--server.http.listen-addr=127.0.0.1:${toString obs.alloyPort}"
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
              url = "${obs.lokiPushUrl}/loki/api/v1/push"

              tls_config {
                ca_file     = "${obs.lokiCaFile}"
                cert_file   = "${obs.lokiClientCertPemFile}"
                key_file    = "${obs.lokiClientCertKeyFile}"
              }
            }
          }
        '';

        # Static user with group-based cert access (metrics cert owned by certGroup).
        systemd.services.alloy.serviceConfig = {
          DynamicUser = lib.mkForce false;
          User = "alloy";
          Group = "alloy";
          SupplementaryGroups = [
            "systemd-journal"
            cfg.certGroup
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
      };
    };
}
