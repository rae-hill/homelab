# it-tools — catalog entry (networking contract).
#
# The reference migration (docs/service-consolidation/it-tools.md). Plain reverse-proxy, no
# OIDC, no manual cert (shares Caddy's managed cert), tailnet-scoped, DNS-enabled.
{ config, ... }:
let
  svc = config.constants.services.it-tools; # subdomain "dev-tools", port 47309
in
{
  flake.modules.nixos.it-tools-catalog =
    { ... }:
    {
      homelab.catalog.it-tools = {
        subdomain = svc.subdomain; # "dev-tools"
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 47309 (renderer emits 127.0.0.1 upstream)
        tls.cert.shared = { }; # shares Caddy's managed cert; no security.acme.certs entry
        access.scope.tailnet = { };
        dns.tailnet = { };

        # Migration opt-in: caddy generator owns the vhost now. DNS/firewall deferred to
        # their cross-cutting migration steps.
        managedBy.caddy = true;
      };
    };
}
