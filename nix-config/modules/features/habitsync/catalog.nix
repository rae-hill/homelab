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
        backend.reverseProxy.port = svc.port; # 6842 (source already used 127.0.0.1 — byte-identical)
        tls.cert.shared = { };
        access.scope.public = { }; # augustus serves vhosts on the public :443 interface
        dns.tailnet = { };

        oidc = {
          clientId = svc.clientId; # "habitsync"
          client.public = { };
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

        managedBy = {
          caddy = true;
          oidc = true;
          firewall = true;
        };
      };
    };
}
