# Caddy vhost generator (darwin backend).
#
# nix-darwin has NO services.caddy and NO security.acme (verified against repos/nix-darwin).
# mini runs Caddy as a launchd daemon against a hand-written Caddyfile with Caddy-native ACME
# (global acme_ca). So this backend emits only a Caddyfile site-blocks FRAGMENT that mini's
# existing Caddyfile `import`s — no services.caddy, no security.acme. The mini-specific global
# block (acme_ca, storage, metrics, logging) stays hand-written.
#
# See docs/service-consolidation/catalog-and-generators.md §3.3 and §2.2a.
{ config, ... }@topLevel:
let
  catLib = topLevel.config.constants.catalogLib;
in
{
  flake.modules.darwin.homelab-service-caddy =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs (
        _: e: e.host == config.networking.hostName && e.managedBy.caddy
      ) config.homelab.catalog;

      siteBlock = name: e: ''
        https://${catLib.fqdn e}${lib.optionalString (e.listenPort != 443) ":${toString e.listenPort}"} {
          ${catLib.renderVhostBody {
            hostCfg = config;
            entry = e;
            inherit name;
            certDir = null;
          }}
        }
      '';

      fragment = lib.concatStringsSep "\n" (lib.mapAttrsToList siteBlock mine);
    in
    {
      environment.etc."caddy_nix/catalog-sites.caddy".text = fragment;
    };
}
