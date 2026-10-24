# cicero-observability — catalog entries (two mTLS metrics vhosts on cicero).
#
# cicero runs Caddy on :8443 (step-ca owns :443). Two mTLS-gated metrics vhosts, both with
# Caddy-managed server certs (useInternalCA) — so serverCert = "managed" (cert-less
# `tls { client_auth … }`). cicero-metrics ALSO owns a step-ca ACME cert, but that cert is an
# ALLOY CLIENT cert (consumed outbound to push to augustus' Loki), NOT the vhost server cert —
# hence tls.cert.own with reloadServices=[alloy.service], reloadCaddy=false, and the mTLS
# vhost still uses the managed server cert.
#
# The http://cicero-metrics challenge vhost is emitted by the acme generator (bare body).
# Host-level Caddy settings (https_port 8443, useInternalCA) stay in caddy-host.nix (§7.6).
#
# See docs/service-consolidation/cicero-observability.md.
{ config, ... }:
let
  c = config.constants;
  ciceroMetrics = c.services.cicero-metrics; # subdomain cicero-metrics, port 8443, acmePort 22479
  stepCa = c.ca; # metricsDomain ca-monitoring, metricsPort 8443, metricsPortInternal 43379
in
{
  flake.modules.nixos.cicero-observability-catalog =
    { ... }:
    {
      homelab.catalog = {
        # node_exporter metrics, mTLS. Also owns the ACME cert consumed by Alloy.
        cicero-metrics = {
          subdomain = ciceroMetrics.subdomain; # "cicero-metrics"
          host = "cicero";
          listenPort = ciceroMetrics.port; # 8443

          backend.reverseProxy.port = 9100; # 127.0.0.1:9100 node_exporter

          tls = {
            gate.mtls = {
              trustPoolFile = c.ca.rootCert;
              serverCert = "managed"; # Caddy-managed server cert (cert-less tls { client_auth })
            };
            # The ACME cert here is an ALLOY CLIENT cert, NOT the vhost server cert.
            cert.own = {
              ca = "internal";
              acmePort = ciceroMetrics.acmePort; # 22479
              certGroup = "cicero-observability";
              reloadServices = [ "alloy.service" ]; # reload Alloy (client-cert consumer), NOT caddy
              reloadCaddy = false;
              challenge = {
                via = "caddy80";
                body.bare = { }; # today's http://cicero-metrics vhost is a bare reverse_proxy
              };
            };
          };

          access.scope.tailnet = { };
          dns = null; # cicero-metrics A/AAAA stays in tailnetRewrites until the DNS cutover
          managedBy = {
            caddy = true;
            acme = true;
            firewall = true;
          };
        };

        # step-ca metrics, mTLS. No ACME cert of its own (Caddy-managed server cert only).
        ca-monitoring = {
          subdomain = "ca-monitoring";
          host = "cicero";
          listenPort = stepCa.metricsPort; # 8443

          backend.reverseProxy.port = stepCa.metricsPortInternal; # 127.0.0.1:43379

          tls = {
            cert.shared = { }; # no security.acme.certs entry
            gate.mtls = {
              trustPoolFile = c.ca.rootCert;
              serverCert = "managed";
            };
          };

          access.scope.tailnet = { };
          dns = null; # ca-monitoring A/AAAA stays in tailnetRewrites until the DNS cutover
          managedBy = {
            caddy = true;
            firewall = true;
          };
        };
      };
    };
}
