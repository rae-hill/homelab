# grafana — catalog entry (vhost + OIDC basic client).
{ config, ... }:
let
  svc = config.constants.services.grafana; # subdomain "grafana", port 3000, clientId "grafana"
in
{
  flake.modules.nixos.grafana-catalog =
    { ... }:
    {
      homelab.catalog.grafana = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 3000
        tls.cert.shared = { }; # shares Caddy's managed cert
        access.scope.tailnet = { };
        dns.tailnet = { };

        oidc = {
          clientId = svc.clientId; # "grafana"
          client.basic.secretRef = "grafana_client_secret";
          callbackPath = "/login/generic_oauth";
          landingPath = "/";
          displayName = "Grafana";
          scopeMaps."grafana.access" = [
            "openid"
            "email"
            "profile"
          ];
          claimMaps.roles = {
            joinType = "array";
            valuesByGroup = {
              "grafana.admins" = [ "admin" ];
              "grafana.access" = [ "editor" ];
            };
          };
        };

        managedBy.caddy = true;
        managedBy.oidc = true;
      };
    };
}
