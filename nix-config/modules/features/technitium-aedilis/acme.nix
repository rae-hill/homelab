{ config, inputs, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
  dnsMetrics = c.services.dns-metrics;
in
{
  # ACME cert management for aedilis's Technitium deployment:
  #   - public Let's Encrypt cert for dns.plato-splunk.media (consumed by Technitium
  #     for native DoH/DoT/DoQ termination)
  #   - step-ca internal certs for the admin UI + metrics vhosts (consumed by Caddy)
  #     and the Alloy client cert (metrics domain) for Loki push.
  flake.modules.nixos.technitium-aedilis-acme =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
    in
    {
      imports = [ inputs.self.modules.nixos.acme ];

      # Default to internal step-ca; the public DNS cert overrides to Let's Encrypt.
      services.homelab-acme.defaultCA = "internal";

      # Public cert for the DNS endpoint (Let's Encrypt, HTTP-01 on port 80 — which
      # is now fully free since Technitium no longer uses it). Consumed by the
      # Technitium service (converted to PKCS#12), so owned by the service group.
      security.acme.certs."${tech.domain}" = {
        domain = tech.domain;
        email = "rae@plato-splunk.media";
        server = "https://acme-v02.api.letsencrypt.org/directory";
        listenHTTP = "127.0.0.1:${toString tech.acmePort}";
        group = cfg.group; # "technitium" — service reads it for the PKCS#12 conversion
        reloadServices = [
          "caddy.service"
          "technitium-dns-server.service"
          "technitium-provision.service"
        ];
      };

      # step-ca cert for the admin UI vhost (Caddy). Owned by the dedicated cert
      # group so Caddy can read it without joining the service group.
      security.acme.certs."${tech.adminDomain}" = {
        domain = tech.adminDomain;
        listenHTTP = "127.0.0.1:${toString tech.adminAcmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = cfg.certGroup;
        reloadServices = [ "caddy.service" ];
      };

      # step-ca cert for the metrics vhost (Caddy) + Alloy client cert (Loki push).
      # Both Caddy and Alloy are members of the cert group.
      security.acme.certs."${dnsMetrics.domain}" = {
        domain = dnsMetrics.domain;
        listenHTTP = "127.0.0.1:${toString dnsMetrics.acmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = cfg.certGroup;
        reloadServices = [
          "caddy.service"
          "alloy.service"
        ];
      };

      # Port-80 HTTP-01 challenge serving for all three certs. Technitium does not
      # use port 80, so Caddy owns it. Each cert's `listenHTTP` loopback port is
      # proxied here under the ACME challenge path.
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

      services.caddy.virtualHosts."http://${tech.adminDomain}" = {
        extraConfig = ''
          reverse_proxy 127.0.0.1:${toString tech.adminAcmePort}
        '';
      };

      services.caddy.virtualHosts."http://${dnsMetrics.domain}" = {
        extraConfig = ''
          reverse_proxy 127.0.0.1:${toString dnsMetrics.acmePort}
        '';
      };
    };
}
