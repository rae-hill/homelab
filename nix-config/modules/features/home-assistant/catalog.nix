# home-assistant — catalog entry (vhost + OIDC basic client; non-/ landing + groups scope).
{ config, ... }:
let
  svc = config.constants.services.home-assistant; # subdomain "home-assistant", port 8123
in
{
  flake.modules.nixos.home-assistant-catalog =
    { ... }:
    {
      homelab.catalog.home-assistant = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 8123
        tls.cert.shared = { };
        access.scope.tailnet = { };
        dns.tailnet = { };

        oidc = {
          clientId = svc.clientId; # "home-assistant"
          client.basic.secretRef = "home_assistant_client_secret";
          callbackPath = "/auth/oidc/callback";
          landingPath = "/auth/oidc/welcome"; # NOT "/" — role mapping is app-side (no claimMaps)
          displayName = "Home Assistant";
          scopeMaps."home-assistant.access" = [
            "openid"
            "email"
            "groups"
            "profile"
          ];
        };

        managedBy.caddy = true;
        managedBy.oidc = true;
      };
    };
}
