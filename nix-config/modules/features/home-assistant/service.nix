{ config, ... }:
let
  c = config.constants;
  svc = c.services.home-assistant;
in
{
  flake.modules.nixos.home-assistant-service =
    {
      config,
      lib,
      pkgs,
      pkgs-unstable,
      ...
    }:
    {
      sops.templates."home-assistant-secrets.yaml" = {
        owner = "hass";
        content = ''
          home_assistant_lat: "${config.sops.placeholder.home_assistant_lat}"
          home_assistant_long: "${config.sops.placeholder.home_assistant_long}"
          oauth_client_secret: "${config.sops.placeholder.home_assistant_client_secret}"
        '';
        path = "${svc.configDir}/secrets.yaml";
      };

      services.home-assistant = {
        enable = true;

        package = pkgs-unstable.home-assistant;

        customComponents = with pkgs-unstable.home-assistant-custom-components; [
          auth_oidc
        ];

        extraComponents = [
          "default_config"
          "met"
          "esphome"
          "mobile_app"
          "ollama"
          "wyoming"
          "apple_tv"
          "homekit"
          "homekit_controller"
          "sonos"
          "hue"
          "ecovacs"
        ];

        config = {
          configDir = svc.configDir;

          name = "Home";
          latitude = "!secret home_assistant_lat";
          longitude = "!secret home_assistant_long";
          unit_system = "us_customary";
          time_zone = "US/Mountain";

          mobile_app = { };

          api = { };

          http = {
            server_port = svc.port;
            server_host = "127.0.0.1";
            use_x_forwarded_for = true;
            trusted_proxies = [
              "127.0.0.1"
            ];
          };

          auth_oidc = {
            client_id = svc.clientId;
            client_secret = "!secret oauth_client_secret";
            discovery_url = c.idm.mkOidcEndpoint svc.clientId;
            features = {
              automatic_person_creation = true;
            };
            id_token_signing_alg = "ES256";
            roles = {
              admin = "home-assistant.admins@${c.idm.domain}";
              user = "home-assistant.access@${c.idm.domain}";
            };
          };
        };
      };

      # Caddy reverse proxy now generated from the catalog (features/home-assistant/catalog.nix).

      services.failure-notifs.attachServices = [
        "home-assistant"
      ];
    };
}
