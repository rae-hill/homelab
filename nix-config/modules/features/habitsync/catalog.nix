# habitsync — catalog entry (vhost + OIDC public client; list originUrl w/ custom scheme).
{ config, ... }:
let
  svc = config.constants.services.habitsync; # subdomain "habitsync", port 6842, clientId "habitsync"
in
{
  flake.modules.nixos.habitsync-catalog =
    { ... }:
    {
      homelab.catalog.habitsync = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend = {
          kind = "reverseProxy";
          port = svc.port; # 6842 (source already used 127.0.0.1 — byte-identical)
        };
        tls.ca = null;
        access.scope = "tailnet";
        dns.enable = true;

        oidc = {
          enable = true;
          clientId = svc.clientId; # "habitsync"
          public = true;
          # Two callbacks: the relative web one (appended to url) and the ABSOLUTE custom-scheme
          # mobile one (used verbatim — contains "://").
          callbackPath = [
            "/auth-callback"
            "habitsync://auth-callback"
          ];
          landingPath = ""; # originLanding = url (NO trailing slash)
          displayName = "HabitSync";
          scopeMaps."habitsync.access" = [
            "openid"
            "profile"
            "email"
          ];
        };

        managedBy.caddy = true;
        managedBy.oidc = true;
      };
    };
}
