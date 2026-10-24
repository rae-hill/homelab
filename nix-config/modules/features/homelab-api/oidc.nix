# homelab-api — OIDC slice (merged into the homelab-api catalog entry).
#
# Public client (PKCE). The callbacks/landing hang off the FRONTEND origin
# (https://homelab.<zone>), not the api origin — so originBase overrides the entry url. One
# callback is a verbatim absolute localhost:4321 dev URL. clientId stays "homelab" (the entry
# is named "homelab-api", but the Kanidm oauth2 key + discovery endpoint key off "homelab").
#
# landingPath = "" so originLanding == frontendUrl exactly (NO trailing slash) — matches today.
# See docs/service-consolidation/homelab-api.md §3.2.
{ config, ... }:
let
  svc = config.constants.services.homelab;
in
{
  flake.modules.nixos.homelab-api-oidc =
    { ... }:
    {
      homelab.catalog.homelab-api.oidc = {
        clientId = svc.clientId; # "homelab" (NOT the entry name "homelab-api")
        client.public = { }; # PKCE, no basicSecretFile
        displayName = "Homelab";

        # Callbacks/landing target the frontend origin, not the api url.
        originBase = svc.frontendUrl; # https://homelab.plato-splunk.media

        callbackPath = [
          "/oauth/callback" # appended to originBase -> https://homelab…/oauth/callback
          "http://localhost:4321/oauth/callback" # ABSOLUTE literal, used verbatim
        ];
        landingPath = ""; # originLanding == originBase (NO trailing slash)

        scopeMaps = {
          "homelab.admins" = [
            "openid"
            "profile"
            "email"
          ];
          "homelab.access" = [
            "openid"
            "profile"
            "email"
          ];
        };

        claimMaps.roles = {
          joinType = "array";
          valuesByGroup = {
            "homelab.admins" = [
              "Config_Wifi"
              "Config_Certs"
              "Config_DNS"
              "Status_Health"
              "Status_Self"
              "OAuth_ClaimCheck"
            ];
            "homelab.access" = [
              "Config_Wifi"
              "Config_Certs"
              "Config_DNS"
              "Status_Self"
              "OAuth_ClaimCheck"
            ];
          };
        };
      };
    };
}
