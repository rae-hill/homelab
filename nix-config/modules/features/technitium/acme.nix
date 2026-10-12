{ config, inputs, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
  dnsMetrics = c.services.dns-metrics;
in
{
  flake.modules.nixos.technitium-acme =
    {
      config,
      lib,
      ...
    }:
    {
      imports = [ inputs.self.modules.nixos.acme ];

      # Default to the internal step-ca (the metrics cert uses it); the public DNS
      # cert overrides `server` to Let's Encrypt per-cert below.
      services.homelab-acme.defaultCA = "internal";

      # Public cert for the DNS endpoint via Let's Encrypt (HTTP-01 on port 80).
      # `server` is overridden back to Let's Encrypt because the default is step-ca.
      # `email` is set per-cert to Rae.
      security.acme.certs."${tech.domain}" = {
        domain = tech.domain;
        email = "rae@plato-splunk.media";
        server = "https://acme-v02.api.letsencrypt.org/directory";
        # HTTP-01 challenge served via a loopback listener; Caddy's port-80 vhost
        # reverse-proxies the challenge to it (see technitium-caddy).
        listenHTTP = "127.0.0.1:${toString tech.acmePort}";
        group = "technitium";
        reloadServices = [
          "caddy.service"
          "technitium-dns-server.service"
        ];
      };

      # Internal step-ca client cert for the metrics endpoint:
      #   - Caddy mTLS server cert for the metrics vhost
      #   - Alloy client cert for pushing logs to augustus' Loki
      # Uses the step-ca HTTP-01 ACME provisioner (acmeDirectoryHttp), matching the
      # cicero-observability pattern.
      security.acme.certs."${dnsMetrics.domain}" = {
        domain = dnsMetrics.domain;
        listenHTTP = "127.0.0.1:${toString dnsMetrics.acmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = "technitium";
        reloadServices = [
          "caddy.service"
          "alloy.service"
        ];
      };
    };
}
