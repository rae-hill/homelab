# prometheus — catalog entries.
#
# Two surfaces:
#   1. `prometheus`        — the mTLS + tracing SERVER vhost (like loki-push): client-cert gated,
#                            Caddy-managed server cert, reverse-proxy into the loopback prometheus.
#   2. `prometheus-client` — a CLIENT cert (no vhost): prometheus requests this cert and threads it
#                            into its scrape tls_config to reach mTLS-guarded remote targets. It owns
#                            the cert + its bare http challenge vhost + DNS, but serves NO https vhost
#                            (clientCertOnly). The cert reloads prometheus.service (NOT caddy).
#
# Everything else (scrapeConfigs, exporters, postgres monitoring wiring, the Technitium
# metrics-token oneshot/timer, failure-notifs) stays verbatim in service.nix.
#
# See docs/service-consolidation/prometheus.md.
{ config, ... }:
let
  c = config.constants;
  svc = c.services.prometheus;
  client = c.services.prometheus-client;
in
{
  flake.modules.nixos.prometheus-catalog =
    { ... }:
    {
      # 1. The mTLS + tracing server vhost.
      homelab.catalog.prometheus = {
        subdomain = svc.subdomain; # "prometheus"
        host = "augustus";

        backend.reverseProxy.port = svc.port; # 9090

        tls = {
          cert.shared = { }; # Caddy-managed server cert; no security.acme.certs entry
          gate.mtls.trustPoolFile = c.ca.rootCert; # client-cert gated (step-ca root)
        };
        tracing.enable = true; # `tracing { span prometheus }` when Tempo is on

        access.scope.tailnet = { };
        dns.tailnet = { };

        managedBy.caddy = true;
      };

      # 2. The client cert consumed outbound by the scrape tls_config — no https vhost.
      homelab.catalog.prometheus-client = {
        subdomain = client.subdomain; # "prometheus-client"
        host = "augustus";
        clientCertOnly = true; # owns the cert + challenge + DNS, but NO https vhost

        backend.none = { };
        tls.cert.own = {
          ca = "internal";
          acmePort = client.acmePort; # 22480
          certGroup = "prometheus";
          reloadServices = [ "prometheus.service" ]; # reload prometheus (NOT caddy) on renewal
          reloadCaddy = false; # no Caddy vhost names this cert
          challenge = {
            via = "caddy80";
            body.bare = { }; # today's http://prometheus-client vhost is a bare reverse_proxy
          };
        };
        access.scope.tailnet = { };
        dns.tailnet = { };

        managedBy.acme = true;
      };
    };
}
