{ config, inputs, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
  dnsMetrics = c.services.dns-metrics;
in
{
  flake.modules.nixos.technitium-caddy =
    {
      config,
      lib,
      ...
    }:
    let
      publicCert = config.security.acme.certs."${tech.domain}".directory;
      metricsCert = config.security.acme.certs."${dnsMetrics.domain}".directory;
    in
    {
      imports = [
        inputs.self.modules.nixos.caddy
      ];

      services.caddy = {
        enable = true;
        # Caddy's internal-CA default is irrelevant here: every vhost names its cert
        # explicitly. Public vhosts use the Let's Encrypt PEM; internal vhosts use
        # the step-ca PEM. We do not rely on Caddy's own ACME.
        useInternalCA = true;
      };

      # Port 80: serve the public Let's Encrypt HTTP-01 challenge for dns.* and the
      # step-ca HTTP-01 challenge for dns-metrics.* by proxying to the acme listeners.
      services.caddy.virtualHosts."http://${tech.domain}" = {
        extraConfig = ''
          handle /.well-known/acme-challenge/* {
            reverse_proxy 127.0.0.1:${toString tech.acmePort}
          }
          handle {
            redir https://${tech.domain}{uri}
          }
        '';
      };

      services.caddy.virtualHosts."http://${dnsMetrics.domain}" = {
        extraConfig = ''
          reverse_proxy localhost:${toString dnsMetrics.acmePort}
        '';
      };

      # Public DoH endpoint (443). Caddy terminates TLS with the Let's Encrypt cert
      # and proxies to Technitium's plaintext DoH listener on :80.
      services.caddy.virtualHosts."https://${tech.domain}" = {
        extraConfig = ''
          tls ${publicCert}/fullchain.pem ${publicCert}/key.pem
          reverse_proxy 127.0.0.1:80
        '';
      };

      # Admin UI (Tailscale-only via firewall, mTLS client-cert gated).
      # Technitium's own OIDC/SSO runs behind this for interactive logins.
      services.caddy.virtualHosts."https://${tech.adminDomain}" = {
        extraConfig = ''
          tls {
            client_auth {
              mode require_and_verify
              trust_pool file {
                pem_file ${c.ca.rootCert}
              }
            }
          }
          reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
        '';
      };

      # Metrics endpoint (Tailscale-only, mTLS). Serves two scrape targets:
      #   - /metrics                     -> node_exporter (host metrics)
      #   - /api/dashboard/metrics/text  -> Technitium DNS metrics (bearer-gated by Technitium)
      # Everything else is denied.
      services.caddy.virtualHosts."https://${dnsMetrics.domain}:${toString dnsMetrics.port}" = {
        extraConfig = ''
          tls ${metricsCert}/fullchain.pem ${metricsCert}/key.pem {
            client_auth {
              mode require_and_verify
              trust_pool file {
                pem_file ${c.ca.rootCert}
              }
            }
          }

          @node path /metrics
          handle @node {
            reverse_proxy 127.0.0.1:${toString dnsMetrics.nodeExporterPort}
          }

          @dns path /api/dashboard/metrics/text
          handle @dns {
            reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
          }

          handle {
            respond 404
          }
        '';
      };

      users.groups.technitium.members = [ "caddy" ];
    };
}
