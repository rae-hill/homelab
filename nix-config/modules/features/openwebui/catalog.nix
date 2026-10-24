# openwebui — catalog entry (vhost + OIDC basic client).
{ config, ... }:
let
  svc = config.constants.services.openwebui; # subdomain "openwebui", port 19553, clientId "openwebui"
in
{
  flake.modules.nixos.openwebui-catalog =
    { ... }:
    {
      homelab.catalog.openwebui = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 19553
        tls.cert.shared = { };
        access.scope.tailnet = { };
        dns.tailnet = { };

        oidc = {
          clientId = svc.clientId; # "openwebui"
          client.basic.secretRef = "openwebui_client_secret";
          callbackPath = "/oauth/oidc/callback";
          landingPath = "/";
          displayName = "Open WebUI";
          scopeMaps."openwebui.access" = [
            "openid"
            "email"
            "profile"
          ];
          claimMaps.roles = {
            joinType = "array";
            valuesByGroup = {
              "openwebui.admins" = [ "admin" ];
              "openwebui.access" = [ "user" ];
            };
          };
        };

        managedBy.caddy = true;
        managedBy.oidc = true;
      };
    };
}
