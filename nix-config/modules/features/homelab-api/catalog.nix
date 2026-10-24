# homelab-api — catalog entry (augustus FULL deployment: dual vhost + OIDC client).
#
# Dual vhost: the secure https://homelab-api + a plain-http sibling (insecureHttp), each with
# the same tempo-gated tracing span. Shares Caddy's managed cert. The OIDC client slice is in
# oidc.nix (merged into this same entry). Runtime (systemd-service.nix) + secret-provisioner
# are NOT catalog concerns and stay untouched.
#
# praeconinus runs a DIFFERENT restricted deployment (own vhost, no OIDC) — not this entry.
# See docs/service-consolidation/homelab-api.md.
{ config, ... }:
let
  svc = config.constants.services.homelab;
in
{
  flake.modules.nixos.homelab-api-catalog =
    { ... }:
    {
      homelab.catalog.homelab-api = {
        # entry name "homelab-api" so the tracing span reads `span homelab-api`.
        subdomain = "homelab-api"; # fqdn homelab-api.plato-splunk.media == svc.url
        host = "augustus";

        backend.reverseProxy.port = svc.port; # 35427 (already 127.0.0.1 today; byte-identical)

        tls = {
          cert.shared = { }; # shares Caddy's managed cert; no ACME cert / challenge vhost
          # gate defaults to none; app-handled OIDC is documentation-only (no Caddy auth).
        };
        insecureHttp = true; # ALSO emit http://homelab-api.plato-splunk.media with the SAME body
        tracing.enable = true; # `tracing { span homelab-api }` on BOTH vhosts when Tempo is on

        access.scope.tailnet = { }; # 443/80 are baseline openings
        dns.tailnet = { }; # emit homelab-api A/AAAA on aedilis (reproduces tailnetRewrites)

        managedBy.caddy = true;
        managedBy.oidc = true;
      };
    };
}
