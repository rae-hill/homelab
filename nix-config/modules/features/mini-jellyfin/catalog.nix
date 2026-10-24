# mini-jellyfin — catalog entries (darwin Caddyfile backend).
#
# mini is nix-darwin: no services.caddy, no security.acme. The darwin caddy generator emits a
# Caddyfile site-blocks FRAGMENT (environment.etc."caddy_nix/catalog-sites.caddy") that the
# hand-written global Caddyfile imports. ACME is Caddy-native (global acme_ca); the generator
# passes certDir = null, so mTLS vhosts emit the cert-less `tls { client_auth … }` form and the
# plain vhost emits no explicit tls line. The bespoke bodies (metrics / rewrite / handle_path
# redir) flow through extraCaddyConfig.
#
# See docs/service-consolidation/mini.md.
{ config, ... }:
let
  rootCert = config.constants.ca.rootCert; # certs/alford-root.crt (same store path as today)
in
{
  flake.modules.darwin.mini-jellyfin-catalog =
    { ... }:
    {
      homelab.catalog = {
        # (1) Caddy self-metrics, mTLS. No upstream — just the `metrics` directive.
        mini-caddy-metrics = {
          subdomain = "mini-caddy-metrics";
          host = "mini";
          backend.none = { };
          tls = {
            gate.mtls.trustPoolFile = rootCert; # serverCert defaults to managed (darwin: Caddy ACME)
            cert.shared = { };
          };
          extraCaddyConfig = ''
            metrics
          '';
          dns = null; # mini-caddy-metrics A/AAAA stays in tailnetRewrites until the DNS cutover
          managedBy.caddy = true;
        };

        # (2) Jellyfin metrics scrape, mTLS + rewrite.
        mini-jellyfin-metrics = {
          subdomain = "mini-jellyfin-metrics";
          host = "mini";
          backend.reverseProxy.port = 8096; # 127.0.0.1:8096
          tls = {
            gate.mtls.trustPoolFile = rootCert;
            cert.shared = { };
          };
          extraCaddyConfig = ''
            rewrite / /metrics
          '';
          dns = null;
          managedBy.caddy = true;
        };

        # (3) Public Jellyfin, plain reverse-proxy + /metrics redirect.
        jellyfin = {
          subdomain = "jellyfin";
          host = "mini";
          backend.reverseProxy.port = 8096; # 127.0.0.1:8096 (renderer std; was localhost)
          tls.cert.shared = { }; # Caddy-native server cert; no gate
          extraCaddyConfig = ''
            handle_path /metrics {
              redir https://mini-jellyfin-metrics.plato-splunk.media
            }
          '';
          dns = null;
          managedBy.caddy = true;
        };
      };
    };
}
