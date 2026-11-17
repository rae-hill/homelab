# Caddy vhost generator (nixos backend).
#
# Reads the whole catalog; filters to entries on THIS host with managedBy.caddy. Emits
# services.caddy.virtualHosts.<key>.extraConfig via the shared renderer (constants.catalogLib).
# See docs/service-consolidation/catalog-and-generators.md §3.2.
#
# NOTE: `config.constants` is a flake-parts option, so the shared renderer (catalogLib) is read
# from the OUTER (topLevel) config and closed over; per-host values (homelab.catalog,
# networking.hostName, security.acme.certs, services.tempo) come from the INNER nixos config.
{ config, ... }@topLevel:
let
  catLib = topLevel.config.constants.catalogLib;
in
{
  flake.modules.nixos.homelab-service-caddy =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs (
        _: e: e.host == config.networking.hostName && e.managedBy.caddy
      ) config.homelab.catalog;

      vhostKey =
        e:
        "https://${catLib.fqdn e}" + lib.optionalString (e.listenPort != 443) ":${toString e.listenPort}";

      insecureKey = e: "http://${catLib.fqdn e}";

      mkBody =
        name: e:
        let
          certDir =
            if catLib.tagOf e.tls.cert == "own" then
              config.security.acme.certs.${catLib.fqdn e}.directory
            else
              null;
        in
        catLib.renderVhostBody {
          hostCfg = config;
          entry = e;
          inherit name certDir;
        };

      vhostsFor =
        name: e:
        let
          body = mkBody name e;
        in
        lib.optionalAttrs (!e.clientCertOnly) {
          ${vhostKey e} = {
            extraConfig = body;
          };
        }
        // lib.optionalAttrs (!e.clientCertOnly && e.insecureHttp) {
          ${insecureKey e} = {
            extraConfig = body;
          };
        };
    in
    {
      services.caddy.virtualHosts = lib.mkMerge (lib.mapAttrsToList vhostsFor mine);
    };
}
