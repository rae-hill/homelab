{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
in
{
  # Kanidm OIDC client registration for Technitium's admin-UI SSO.
  # This runs on augustus (the Kanidm host). aedilis consumes the issuer URL and
  # the client secret (as technitium_sso_client_secret in aedilis sops).
  flake.modules.nixos.technitium-kanidm =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.kanidm.provision.systems.oauth2."${tech.clientId}" = {
        # NOTE: confirm the exact redirect/callback path Technitium expects for its
        # OIDC sign-in flow against the running version (docs/aedilis-host-plan.md §7).
        originUrl = "${tech.adminUrl}:${builtins.toString tech.adminPort}/sso/callback";
        originLanding = "${tech.adminUrl}:${builtins.toString tech.adminPort}/";
        displayName = "Technitium DNS";

        basicSecretFile = config.sops.secrets.technitium_client_secret.path;

        scopeMaps."technitium.access" = [
          "openid"
          "profile"
          "email"
        ];

        # Expose group membership so Technitium's DNS_SERVER_SSO_GROUP_MAP can map
        # the "Administrators" remote group to its local Administrators group.
        claimMaps.groups = {
          joinType = "array";
          valuesByGroup = {
            "technitium.admins" = [ "Administrators" ];
          };
        };
      };
    };
}
