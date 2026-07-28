{ config, ... }:
let
  c = config.constants;
  svc = c.services.prometheus;
in
{
  flake.modules.nixos.prometheus =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.prometheus = {
        enable = true;
        checkConfig = "syntax-only";
        port = svc.port;
        listenAddress = "127.0.0.1";
        stateDir = "prometheus2";
        retentionTime = "30d";
        extraFlags = [ "--web.enable-remote-write-receiver" ];

        globalConfig = {
          scrape_interval = "15s";
          evaluation_interval = "15s";
        };

        scrapeConfigs = [
          {
            job_name = "prometheus";
            static_configs = [
              { targets = [ "127.0.0.1:${toString svc.port}" ]; }
            ];
          }
          {
            job_name = "node";
            static_configs = [
              { targets = [ "127.0.0.1:${toString config.services.prometheus.exporters.node.port}" ]; }
            ];
          }
          {
            job_name = "caddy";
            static_configs = [
              { targets = [ "127.0.0.1:2019" ]; }
            ];
          }
          {
            job_name = "caddy-mini";
            static_configs = [
              { targets = [ "mini-caddy-metrics.plato-splunk.media" ]; }
            ];
            scheme = "https";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.ca.metricsDomain;
            };
          }
          {
            job_name = "jellyfin";
            static_configs = [
              { targets = [ "jellyfin.plato-splunk.media" ]; }
            ];
            metrics_path = "/metrics";
            scheme = "https";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.ca.metricsDomain;
            };
          }
          {
            job_name = "loki";
            static_configs = [
              { targets = [ "127.0.0.1:${toString c.services.loki.port}" ]; }
            ];
            metrics_path = "/metrics";
          }
          {
            job_name = "step-ca";
            static_configs = [
              { targets = [ "${c.ca.metricsDomain}:${toString c.ca.metricsPort}" ]; }
            ];
            scheme = "https";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.ca.metricsDomain;
            };
            metrics_path = "/metrics";
          }
          {
            job_name = "postgres";
            static_configs = [
              { targets = [ "127.0.0.1:${toString config.services.prometheus.exporters.postgres.port}" ]; }
            ];
          }
          {
            job_name = "cicero-node";
            scheme = "https";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.services.cicero-metrics.domain;
            };
            static_configs = [
              {
                targets = [ "${c.services.cicero-metrics.domain}:${toString c.services.cicero-metrics.port}" ];
                labels = {
                  instance = "cicero";
                };
              }
            ];
            metrics_path = "/metrics";
          }
          {
            job_name = "tailscale";
            scheme = "http";
            static_configs = [
              {
                targets = [ "100.100.100.100" ];
                labels = {
                  instance = "augustus";
                };
              }
              {
                targets = [ "cicero.plato-splunk.media:${toString c.services.tailscale-metrics.port}" ];
                labels = {
                  instance = "cicero";
                };
              }
              {
                targets = [ "praeconinus.plato-splunk.media:${toString c.services.tailscale-metrics.port}" ];
                labels = {
                  instance = "praeconinus";
                };
              }
              {
                targets = [ "nixos.plato-splunk.media:${toString c.services.tailscale-metrics.port}" ];
                labels = {
                  instance = "nixos";
                };
              }
              {
                targets = [ "mini.plato-splunk.media:${toString c.services.tailscale-metrics.port}" ];
                labels = {
                  instance = "mini";
                };
              }
            ];
            metrics_path = "/metrics";
          }
          {
            job_name = "unpoller";
            static_configs = [
              { targets = [ "127.0.0.1:${toString c.services.unpoller.port}" ]; }
            ];
            metrics_path = "/metrics";
          }
        ];

        exporters.node = {
          enable = true;
          port = 9100;
          listenAddress = "127.0.0.1";
          enabledCollectors = [
            "systemd"
            "processes"
          ];
        };

        exporters.postgres = {
          enable = true;
          port = 9187;
          listenAddress = "127.0.0.1";
          dataSourceName = "postgresql:///prometheus_exporter?host=/run/postgresql&sslmode=disable";
          user = "prometheus_exporter";
        };
      };

      # PostgreSQL monitoring user (read-only via pg_monitor)
      users.users.prometheus_exporter = {
        isSystemUser = true;
        group = "prometheus_exporter";
      };

      users.groups.prometheus_exporter = { };

      services.postgresql.ensureUsers = [
        {
          name = "prometheus_exporter";
        }
      ];

      services.postgresql.ensureDatabases = [
        "prometheus_exporter"
      ];

      services.peesequel.grantRoles = {
        prometheus_exporter = [ "pg_monitor" ];
      };

      # Client certificate for Prometheus to scrape mTLS-guarded remote targets
      security.acme.certs."${c.services.prometheus-client.domain}" = {
        domain = c.services.prometheus-client.domain;
        listenHTTP = "127.0.0.1:${builtins.toString c.services.prometheus-client.acmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = "prometheus";
        reloadServices = [ "prometheus.service" ];
      };

      services.caddy.virtualHosts."http://${c.services.prometheus-client.domain}" = {
        extraConfig = ''
          reverse_proxy localhost:${builtins.toString c.services.prometheus-client.acmePort}
        '';
      };

      # Caddy reverse proxy with mTLS (Prometheus has no OIDC)
      services.caddy.virtualHosts."${svc.url}" = {
        extraConfig = ''
          tls {
            client_auth {
              mode require_and_verify
              trust_pool file {
                pem_file ${c.ca.rootCert}
              }
            }
          }
          tracing {
            span prometheus
          }
          reverse_proxy 127.0.0.1:${builtins.toString svc.port}
        '';
      };

      services.failure-notifs.attachServices = [
        "prometheus"
        "prometheus-node-exporter"
      ];
    };
}
