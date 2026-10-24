# homelab-ui — catalog entry (static frontend vhost on augustus).
#
# The canonical static `file_server` case: Caddy serves a built package root rather than
# reverse-proxying an app. One Caddy vhost (static) with a tempo-gated tracing span. No OIDC,
# no manual cert, no firewall opening, no runtime unit.
#
# Owns the `homelab` (frontend) origin. The sibling `homelab-api` origin + its OIDC client are
# owned by the homelab-api feature. See docs/service-consolidation/homelab-ui.md.
{ config, inputs, ... }:
let
  svc = config.constants.services.homelab;
  pkg = inputs.self.packages.x86_64-linux.homelab-ui; # SAME derivation caddy.nix referenced
in
{
  flake.modules.nixos.homelab-ui-catalog =
    { ... }:
    {
      homelab.catalog.homelab-ui = {
        # entry name "homelab-ui" so the tracing span reads `span homelab-ui`.
        subdomain = "homelab"; # fqdn homelab.plato-splunk.media == svc.frontendUrl
        host = "augustus";

        backend.static.root = pkg; # root * <store path> + Cache-Control header + file_server

        tls.cert.shared = { }; # shares Caddy's managed cert; no ACME cert / challenge vhost
        tracing.enable = true; # `tracing { span homelab-ui }` when the host runs Tempo
        access.scope.tailnet = { }; # reachable over tailscale0; 443 is a baseline opening
        dns.tailnet = { }; # emit homelab A/AAAA on aedilis (reproduces tailnetRewrites.homelab)

        # No oidc (static SPA). The caddy generator owns the vhost now.
        managedBy.caddy = true;
      };
    };
}
