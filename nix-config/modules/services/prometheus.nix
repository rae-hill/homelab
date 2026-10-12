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
              server_name = "mini-caddy-metrics.plato-splunk.media";
            };
          }
          {
            job_name = "jellyfin";
            static_configs = [
              { targets = [ "mini-jellyfin-metrics.plato-splunk.media" ]; }
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
              server_name = "mini-jellyfin-metrics.plato-splunk.media";
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
            job_name = "aedilis-node";
            scheme = "https";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.services.dns-metrics.domain;
            };
            static_configs = [
              {
                targets = [ "${c.services.dns-metrics.domain}:${toString c.services.dns-metrics.port}" ];
                labels = {
                  instance = "aedilis";
                };
              }
            ];
            metrics_path = "/metrics";
          }
          {
            job_name = "aedilis-dns";
            scheme = "https";
            # Short-lived bearer token minted by the technitium-metrics-token oneshot.
            authorization.credentials_file = "/run/technitium-metrics/token";
            tls_config = {
              ca_file = toString c.ca.rootCert;
              cert_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/fullchain.pem";
              key_file = "${
                config.security.acme.certs."${c.services.prometheus-client.domain}".directory
              }/key.pem";
              server_name = c.services.dns-metrics.domain;
            };
            static_configs = [
              {
                targets = [ "${c.services.dns-metrics.domain}:${toString c.services.dns-metrics.port}" ];
                labels = {
                  instance = "aedilis";
                };
              }
            ];
            metrics_path = "/api/dashboard/metrics/text";
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
              {
                targets = [ "aedilis.plato-splunk.media:${toString c.services.tailscale-metrics.port}" ];
                labels = {
                  instance = "aedilis";
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

      # ---------------------------------------------------------------------------
      # Technitium metrics token exchange (aedilis).
      #
      # Technitium's /api/dashboard/metrics/text requires a bearer token. We avoid
      # non-expiring API tokens: a oneshot logs in with a password + TOTP (sops) to
      # mint a SHORT-LIVED session token, written to /run/technitium-metrics/token,
      # which the aedilis-dns scrape job reads via authorization.credentials_file.
      # A timer refreshes it well before the session expires.
      # See docs/aedilis-host-plan.md §6.
      # ---------------------------------------------------------------------------
      systemd.tmpfiles.rules = [
        "d /run/technitium-metrics 0750 prometheus prometheus -"
        # Pre-create an empty token file so Prometheus' credentials_file always
        # exists even before the first successful token exchange (empty = clean 401).
        "f /run/technitium-metrics/token 0640 prometheus prometheus -"
      ];

      systemd.services.technitium-metrics-token =
        let
          dnsMetrics = c.services.dns-metrics;
          promClientCert = config.security.acme.certs."${c.services.prometheus-client.domain}".directory;
          endpoint = "https://${dnsMetrics.domain}:${toString dnsMetrics.port}";
          tokenScript = pkgs.writeShellApplication {
            name = "technitium-metrics-token";
            runtimeInputs = with pkgs; [
              curl
              jq
              oath-toolkit
              coreutils
            ];
            text = ''
              set -euo pipefail

              TOKEN_FILE=/run/technitium-metrics/token

              # Ensure the file always exists so Prometheus config load never fails
              # on a missing credentials_file. An empty token yields a clean 401
              # (target DOWN) rather than a silent stale-token success.
              if [ ! -e "$TOKEN_FILE" ]; then
                umask 027
                : > "$TOKEN_FILE"
                chown prometheus:prometheus "$TOKEN_FILE"
              fi

              # On any failure, blank the token so a stale/expired one is not left in
              # place (would otherwise 401 silently until the next successful run).
              fail() {
                echo "technitium-metrics-token: $1" >&2
                umask 027
                : > "$TOKEN_FILE"
                chown prometheus:prometheus "$TOKEN_FILE"
                exit 1
              }

              PASS="$(cat "${config.sops.secrets.technitium_metrics_user_password.path}")"
              TOTP_SECRET="$(cat "${config.sops.secrets.technitium_metrics_totp_secret.path}")"
              CODE="$(oathtool --totp -b "$TOTP_SECRET")"

              # mTLS login over the Tailscale metrics endpoint.
              RESP="$(curl -fsS \
                --cacert "${toString c.ca.rootCert}" \
                --cert "${promClientCert}/fullchain.pem" \
                --key "${promClientCert}/key.pem" \
                "${endpoint}/api/user/login?user=prometheus&pass=$PASS&totp=$CODE&includeInfo=false")" \
                || fail "login request failed (aedilis reachable over Tailscale?)"

              TOKEN="$(echo "$RESP" | jq -r '.token // empty')"
              if [ -z "$TOKEN" ]; then
                fail "login rejected: $(echo "$RESP" | jq -r '.errorMessage // "unknown"')"
              fi

              umask 027
              printf '%s' "$TOKEN" > "$TOKEN_FILE"
              chown prometheus:prometheus "$TOKEN_FILE"
            '';
          };
        in
        {
          description = "Acquire a short-lived Technitium metrics bearer token";
          after = [ "network-online.target" ];
          wants = [ "network-online.target" ];
          before = [ "prometheus.service" ];
          wantedBy = [ "prometheus.service" ];
          serviceConfig = {
            Type = "oneshot";
            User = "prometheus";
            Group = "prometheus";
            ExecStart = lib.getExe tokenScript;
          };
        };

      systemd.timers.technitium-metrics-token = {
        description = "Refresh the Technitium metrics bearer token before expiry";
        wantedBy = [ "timers.target" ];
        timerConfig = {
          # Session timeout on the prometheus user is 3600s (set during aedilis
          # provisioning); refresh every 20 minutes with jitter.
          OnBootSec = "2min";
          OnUnitActiveSec = "20min";
          RandomizedDelaySec = "60s";
          Persistent = true;
        };
      };
    };
}
