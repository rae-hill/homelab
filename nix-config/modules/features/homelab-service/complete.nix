# Role aggregators for the service-consolidation generators.
#
# options.nix (the catalog schema) must be imported by every host, both classes, so
# `homelab.catalog` exists everywhere. The generators are imported à la carte per host role:
#
#   augustus    -> homelab-service-oidc-host   (caddy + acme + firewall + oidc)
#   aedilis     -> homelab-service-dns-host     (caddy + acme + firewall + dns)
#   cicero      -> homelab-service-apphost      (caddy + acme + firewall)
#   praeconinus -> homelab-service-apphost      (caddy + acme + firewall; no dns/oidc)
#   mini        -> homelab-service-apphost      (darwin: Caddyfile backend only)
#
# lib.nix contributes config.constants.catalogLib at the flake-parts level (auto-applied by
# import-tree), so it is NOT referenced here.
#
# See docs/service-consolidation/catalog-and-generators.md §1.
{ inputs, ... }:
{
  # Schema only — imported by every host (nixos + darwin). Defines the option, no config.
  flake.modules.nixos.homelab-catalog = {
    imports = [ inputs.self.modules.nixos.homelab-catalog-options ];
  };
  flake.modules.darwin.homelab-catalog = {
    imports = [ inputs.self.modules.darwin.homelab-catalog-options ];
  };

  # An ordinary Linux app host: vhost + cert + firewall.
  flake.modules.nixos.homelab-service-apphost = {
    imports = with inputs.self.modules.nixos; [
      homelab-catalog
      homelab-service-caddy
      homelab-service-acme
      homelab-service-firewall
    ];
  };

  # aedilis additionally owns DNS; augustus additionally owns OIDC.
  flake.modules.nixos.homelab-service-dns-host = {
    imports = with inputs.self.modules.nixos; [
      homelab-service-apphost
      homelab-service-dns
    ];
  };
  flake.modules.nixos.homelab-service-oidc-host = {
    imports = with inputs.self.modules.nixos; [
      homelab-service-apphost
      homelab-service-oidc
    ];
  };

  # mini (darwin): Caddyfile backend + trust only. No acme/dns/oidc/firewall.
  flake.modules.darwin.homelab-service-apphost = {
    imports = with inputs.self.modules.darwin; [
      homelab-catalog
      homelab-service-caddy
    ];
  };
}
