# it-tools — feature aggregate. Preserves the `nixos.it-tools` import name hosts/augustus.nix
# already uses. Importing it realizes the runtime AND registers the catalog entry; the caddy
# generator (imported once per host via homelab-service-*) renders the vhost.
{ inputs, ... }:
{
  flake.modules.nixos.it-tools = {
    imports = with inputs.self.modules.nixos; [
      it-tools-catalog
      it-tools-service
    ];
  };
}
