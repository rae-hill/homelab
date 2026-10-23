# OIDC client generator (nixos, augustus only via the import matrix).
#
# Reads the WHOLE catalog (OIDC centralized on augustus); filters to managedBy.oidc AND
# oidc.enable. NO host == filter. Emits services.kanidm.provision.systems.oauth2.<clientId>,
# reproducing today's per-service blocks. callbackPath entries containing "://" are ABSOLUTE
# (used verbatim); relative ones are appended to the service url. scopeMaps/claimMaps pass
# through verbatim. See docs/service-consolidation/catalog-and-generators.md §3.7.
{ config, ... }@topLevel:
let
  catLib = topLevel.config.constants.catalogLib;
in
{
  flake.modules.nixos.homelab-service-oidc =
    { config, lib, ... }:
    let
      inherit (lib)
        filterAttrs
        mapAttrs'
        nameValuePair
        ;

      wanted = filterAttrs (_: e: e.managedBy.oidc && e.oidc.enable) config.homelab.catalog;

      mkClient =
        _name: e:
        let
          base = catLib.url e;
          o = e.oidc;
          callbacks = lib.toList o.callbackPath; # str or list -> list
          mkOrigin = p: if lib.hasInfix "://" p then p else "${base}${p}";
          originUrls = map mkOrigin callbacks;
        in
        nameValuePair o.clientId (
          {
            displayName = o.displayName;
            originUrl = if builtins.length originUrls == 1 then builtins.head originUrls else originUrls;
            originLanding = "${base}${o.landingPath}";
            scopeMaps = o.scopeMaps;
          }
          // lib.optionalAttrs (o.claimMaps != { }) { claimMaps = o.claimMaps; }
          // lib.optionalAttrs o.allowInsecureClientDisablePkce {
            allowInsecureClientDisablePkce = true;
          }
          // (
            if o.public then
              { public = true; }
            else
              { basicSecretFile = config.sops.secrets.${o.secretRef}.path; }
          )
        );
    in
    {
      services.kanidm.provision.systems.oauth2 = mapAttrs' mkClient wanted;
    };
}
