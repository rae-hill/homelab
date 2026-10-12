{ inputs, ... }:
{
  flake.modules.nixos.technitium-caddy =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      inherit (lib) mkIf;
    in
    {
      imports = [ inputs.self.modules.nixos.caddy ];

      config = mkIf (cfg.enable && cfg.caddy.enable) {
        services.caddy = {
          enable = true;
          # Every vhost names its cert explicitly; the global default issuer is unused.
          useInternalCA = true;
        };

        # Admin UI (Tailscale-only via firewall, OIDC-gated by Technitium). No mTLS —
        # Tailscale + OIDC already gate access. Caddy terminates TLS with the step-ca
        # cert and reverse-proxies to the loopback web console.
        services.caddy.virtualHosts."https://${cfg.caddy.adminDomain}:${toString cfg.caddy.adminPort}" = {
          extraConfig = ''
            tls ${cfg.caddy.adminCertPemFile} ${cfg.caddy.adminCertKeyFile}
            reverse_proxy 127.0.0.1:${toString cfg.webHttpPort}
          '';
        };

        # Metrics endpoint (Tailscale-only, mTLS). Prometheus has no OIDC, so client
        # certs gate it. Serves node_exporter at /metrics and Technitium DNS metrics
        # at /api/dashboard/metrics/text; everything else is denied.
        services.caddy.virtualHosts."https://${cfg.caddy.metricsDomain}:${toString cfg.caddy.metricsPort}" =
          {
            extraConfig = ''
              tls ${cfg.caddy.metricsCertPemFile} ${cfg.caddy.metricsCertKeyFile} {
                client_auth {
                  mode require_and_verify
                  trust_pool file {
                    pem_file ${cfg.caddy.metricsMtlsTrustPoolFile}
                  }
                }
              }

              @node path /metrics
              handle @node {
                reverse_proxy 127.0.0.1:${toString cfg.caddy.nodeExporterPort}
              }

              @dns path /api/dashboard/metrics/text
              handle @dns {
                reverse_proxy 127.0.0.1:${toString cfg.webHttpPort}
              }

              handle {
                respond 404
              }
            '';
          };

        # Caddy needs read access to the technitium-group-owned certs.
        users.groups.${cfg.group}.members = [ "caddy" ];
      };
    };
}
