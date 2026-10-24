# planka — catalog entry (vhost + OIDC basic client with insecure-pkce + role claims).
{ config, ... }:
let
  svc = config.constants.services.planka; # subdomain "planka", port 1337, clientId "planka"
in
{
  flake.modules.nixos.planka-catalog =
    { ... }:
    {
      homelab.catalog.planka = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 1337
        tls.cert.shared = { };
        access.scope.public = { }; # augustus serves vhosts on the public :443 interface
        dns.tailnet = { };

        oidc = {
          clientId = svc.clientId; # "planka"
          client.basic.secretRef = "planka_client_secret";
          allowInsecureClientDisablePkce = true;
          callbackPath = "/oidc-callback";
          landingPath = "/";
          displayName = "Planka";
          scopeMaps."planka.access" = [
            "openid"
            "email"
            "profile"
          ];
          # role values match the container env in service.nix:
          #   admin / project_owner / board_user
          claimMaps.roles = {
            joinType = "array";
            valuesByGroup = {
              "planka.admins" = [ "admin" ];
              "planka.project_owner" = [ "project_owner" ];
              "planka.access" = [ "board_user" ];
            };
          };
        };

        managedBy = {
          caddy = true;
          oidc = true;
          firewall = true;
        };
      };
    };
}
