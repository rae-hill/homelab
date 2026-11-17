# grafana — catalog entry (vhost + OIDC basic client).
{ config, inputs, ... }:
let
  svc = config.constants.services.grafana; # subdomain "grafana", port 3000, clientId "grafana"
in
{
  flake.modules.nixos.grafana-catalog =
    { config, ... }:
    {
      # kanidm-owned OIDC client secret, from the per-service sops file
      # (secrets/<host>/grafana.yaml); consumed via oidc.client.basic.secretRef
      # and the grafana-client-secret template in service.nix.
      sops.secrets.grafana_client_secret = {
        sopsFile = inputs.self + "/nix-config/secrets/${config.networking.hostName}/grafana.yaml";
        owner = "kanidm";
      };

      homelab.catalog.grafana = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 3000
        tls.cert.shared = { }; # shares Caddy's managed cert
        access.scope.public = { }; # augustus serves vhosts on the public :443 interface
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

        managedBy = {
          caddy = true;
          oidc = true;
          firewall = true;
          dns = true;
        };
      };
    };
}
