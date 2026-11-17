# openwebui — catalog entry (vhost + OIDC basic client).
{ config, inputs, ... }:
let
  svc = config.constants.services.openwebui; # subdomain "openwebui", port 19553, clientId "openwebui"
in
{
  flake.modules.nixos.openwebui-catalog =
    { config, ... }:
    {
      # kanidm-owned OIDC client secret, from the per-service sops file
      # (module-local secrets/<host>.yaml); consumed via oidc.client.basic.secretRef.
      sops.secrets.openwebui_client_secret = {
        sopsFile = ./secrets + "/${config.networking.hostName}.yaml";
        owner = "kanidm";
      };

      homelab.catalog.openwebui = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 19553
        tls.cert.shared = { };
        access.scope.public = { }; # augustus serves vhosts on the public :443 interface
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

        managedBy = {
          caddy = true;
          oidc = true;
          firewall = true;
          dns = true;
        };
      };
    };
}
