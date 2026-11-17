# home-assistant — catalog entry (vhost + OIDC basic client; non-/ landing + groups scope).
{ config, inputs, ... }:
let
  svc = config.constants.services.home-assistant; # subdomain "home-assistant", port 8123
in
{
  flake.modules.nixos.home-assistant-catalog =
    { config, ... }:
    {
      # kanidm-owned OIDC client secret, from the per-service sops file
      # (secrets/<host>/home-assistant.yaml); consumed via oidc.client.basic.secretRef.
      sops.secrets.home_assistant_client_secret = {
        sopsFile = inputs.self + "/nix-config/secrets/${config.networking.hostName}/home-assistant.yaml";
        owner = "kanidm";
      };

      homelab.catalog.home-assistant = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.reverseProxy.port = svc.port; # 8123
        tls.cert.shared = { };
        access.scope.public = { }; # augustus serves vhosts on the public :443 interface
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

        managedBy = {
          caddy = true;
          oidc = true;
          firewall = true;
          dns = true;
        };
      };
    };
}
